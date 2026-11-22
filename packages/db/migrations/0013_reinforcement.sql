-- Reinforcement-learning capture. No trainer is started.
-- Preference rows cannot be marked training_used.
-- Founder authorisation is not granted to the application roles.

CREATE TABLE training_consents (
  org_id uuid PRIMARY KEY REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  granted boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES users (id),
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (granted = false OR (granted_by IS NOT NULL AND granted_at IS NOT NULL AND revoked_at IS NULL))
);

COMMENT ON TABLE training_consents IS
  'Per-org opt-in for a future training set. Default is false. This row does not start training.';

CREATE TRIGGER training_consents_region
  BEFORE INSERT OR UPDATE OF home_region ON training_consents
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER training_consents_touch
  BEFORE UPDATE ON training_consents
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE training_authorisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  authorised boolean NOT NULL DEFAULT false,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (note <> ''),
  CHECK (authorised = false OR revoked_at IS NULL)
);

COMMENT ON TABLE training_authorisations IS
  'Founder gate. Org consent is not enough. The application roles cannot insert this table.';

CREATE TRIGGER training_authorisations_region
  BEFORE INSERT OR UPDATE OF home_region ON training_authorisations
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'buyer_approve', 'buyer_edit', 'buyer_reject',
    'edit_distance', 'tender_win', 'tender_loss',
    'judge_score', 'expert_rating'
  )),
  reward numeric(6, 4),
  edit_distance integer,
  rubric_code text CHECK (rubric_code IS NULL OR rubric_code ~ '^[a-z0-9_]{1,64}$'),
  score numeric(6, 4),
  rating smallint,
  suspect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (reward IS NULL OR (reward >= -1 AND reward <= 1)),
  CHECK (edit_distance IS NULL OR edit_distance >= 0),
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CHECK (kind <> 'edit_distance' OR edit_distance IS NOT NULL),
  CHECK (kind <> 'expert_rating' OR rating IS NOT NULL),
  CHECK (kind NOT IN ('judge_score') OR (rubric_code IS NOT NULL AND score IS NOT NULL))
);

COMMENT ON TABLE feedback_events IS
  'Reward signals for one tenant job. Document text is not a column.';

CREATE TRIGGER feedback_events_region
  BEFORE INSERT OR UPDATE OF home_region ON feedback_events
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.flag_reward_hack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.kind = 'buyer_approve' AND EXISTS (
    SELECT 1 FROM feedback_events
    WHERE job_id = NEW.job_id
      AND tenant_id = NEW.tenant_id
      AND kind = 'buyer_reject'
  ) THEN
    NEW.suspect := true;
  END IF;
  IF NEW.kind = 'buyer_reject' AND EXISTS (
    SELECT 1 FROM feedback_events
    WHERE job_id = NEW.job_id
      AND tenant_id = NEW.tenant_id
      AND kind = 'buyer_approve'
  ) THEN
    NEW.suspect := true;
  END IF;
  IF NEW.kind = 'buyer_edit' AND COALESCE(NEW.edit_distance, 0) = 0 AND NEW.reward = 1 THEN
    NEW.suspect := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_events_reward_hack
  BEFORE INSERT ON feedback_events
  FOR EACH ROW EXECUTE FUNCTION app.flag_reward_hack();

CREATE TABLE preference_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  chosen_hash text NOT NULL CHECK (chosen_hash ~ '^[0-9a-f]{64}$'),
  rejected_hash text NOT NULL CHECK (rejected_hash ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN ('buyer', 'expert', 'judge')),
  training_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (training_used = false),
  CHECK (chosen_hash <> rejected_hash)
);

COMMENT ON TABLE preference_pairs IS
  'RLAIF or DPO hashes for a later proposal. training_used cannot become true in this milestone.';

CREATE TRIGGER preference_pairs_region
  BEFORE INSERT OR UPDATE OF home_region ON preference_pairs
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE policy_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  code text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'offline_passed', 'rejected', 'active')),
  offline_score numeric(6, 4),
  baseline_score numeric(6, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (offline_score IS NULL OR (offline_score >= 0 AND offline_score <= 1)),
  CHECK (baseline_score IS NULL OR (baseline_score >= 0 AND baseline_score <= 1))
);

COMMENT ON TABLE policy_candidates IS
  'A policy stays proposed until an offline score beats the baseline. Activation is a function, not an update from the app.';

CREATE TRIGGER policy_candidates_region
  BEFORE INSERT OR UPDATE OF home_region ON policy_candidates
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.guard_policy_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF OLD.status IS DISTINCT FROM 'offline_passed' AND OLD.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'offline evaluation is required before a policy change';
    END IF;
    IF NEW.offline_score IS NULL
      OR NEW.baseline_score IS NULL
      OR NEW.offline_score < NEW.baseline_score
    THEN
      RAISE EXCEPTION 'offline evaluation is required before a policy change';
    END IF;
    IF EXISTS (
      SELECT 1 FROM bandit_arms
      WHERE tenant_id = NEW.tenant_id AND status = 'halted'
    ) THEN
      RAISE EXCEPTION 'reward drift halted this policy';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_candidates_status
  BEFORE UPDATE OF status ON policy_candidates
  FOR EACH ROW EXECUTE FUNCTION app.guard_policy_status();

CREATE OR REPLACE FUNCTION app.guard_policy_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'proposed' THEN
    RAISE EXCEPTION 'a policy starts as proposed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_candidates_insert
  BEFORE INSERT ON policy_candidates
  FOR EACH ROW EXECUTE FUNCTION app.guard_policy_insert();

CREATE TABLE bandit_arms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  kind text NOT NULL CHECK (kind IN ('prompt', 'model', 'strategy')),
  arm_code text NOT NULL CHECK (arm_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  pulls integer NOT NULL DEFAULT 0 CHECK (pulls >= 0),
  reward_sum numeric(8, 4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow', 'active', 'halted')),
  offline_score numeric(6, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, arm_code)
);

COMMENT ON TABLE bandit_arms IS
  'Tenant-scoped prompt, model, or strategy arms. Shadow until activated. Halted arms are not selected.';

CREATE TRIGGER bandit_arms_region
  BEFORE INSERT OR UPDATE OF home_region ON bandit_arms
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.guard_bandit_arm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'shadow' THEN
    RAISE EXCEPTION 'new bandit arms start in shadow';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'halted' AND NEW.status IS DISTINCT FROM 'halted' THEN
    RAISE EXCEPTION 'a halted bandit arm stays halted';
  END IF;
  IF NEW.status = 'active' AND NEW.offline_score IS NULL THEN
    RAISE EXCEPTION 'offline evaluation is required before a bandit arm is active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bandit_arms_guard
  BEFORE INSERT OR UPDATE ON bandit_arms
  FOR EACH ROW EXECUTE FUNCTION app.guard_bandit_arm();

CREATE TABLE bandit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  arm_id uuid NOT NULL REFERENCES bandit_arms (id),
  propensity numeric(6, 4) NOT NULL CHECK (propensity > 0 AND propensity <= 1),
  reward numeric(6, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (reward IS NULL OR (reward >= -1 AND reward <= 1))
);

CREATE TRIGGER bandit_decisions_region
  BEFORE INSERT OR UPDATE OF home_region ON bandit_decisions
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.grant_founder_authorisation(p_org uuid, p_note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  created uuid;
  region text;
BEGIN
  IF current_user IN ('orbexa_app', 'orbexa_worker', 'orbexa_finance') THEN
    RAISE EXCEPTION 'founder authorisation is not granted to the application';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
    RAISE EXCEPTION 'founder authorisation needs a note';
  END IF;
  SELECT home_region INTO region FROM orgs WHERE id = p_org;
  IF region IS NULL THEN
    RAISE EXCEPTION 'org not found';
  END IF;
  INSERT INTO training_authorisations (org_id, home_region, authorised, note)
  VALUES (p_org, region, true, p_note)
  RETURNING id INTO created;
  RETURN created;
END;
$$;

COMMENT ON FUNCTION app.grant_founder_authorisation IS
  'Records a founder gate. Application roles cannot call it. It does not train a model.';

REVOKE ALL ON FUNCTION app.grant_founder_authorisation(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.consider_preference_export(p_pair uuid)
RETURNS TABLE (chosen_hash text, rejected_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  pair preference_pairs%ROWTYPE;
BEGIN
  SELECT * INTO pair FROM preference_pairs WHERE id = p_pair;
  IF pair.id IS NULL THEN
    RAISE EXCEPTION 'preference pair not found';
  END IF;
  IF pair.tenant_id IS DISTINCT FROM app.current_tenant() THEN
    RAISE EXCEPTION 'preference pair is not in this tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM training_consents AS consent
    WHERE consent.org_id = pair.tenant_id
      AND consent.granted
      AND consent.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'training consent is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM training_authorisations AS auth
    WHERE auth.org_id = pair.tenant_id
      AND auth.authorised
      AND auth.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'founder authorisation is required';
  END IF;
  -- Hashes only. training_used stays false. No trainer is invoked.
  RETURN QUERY SELECT pair.chosen_hash, pair.rejected_hash;
END;
$$;

COMMENT ON FUNCTION app.consider_preference_export IS
  'Returns hashes when consent and founder authorisation both exist. It does not fine-tune.';

CREATE OR REPLACE FUNCTION app.record_offline_result(p_id uuid, p_offline numeric, p_baseline numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  candidate policy_candidates%ROWTYPE;
BEGIN
  IF p_offline IS NULL OR p_baseline IS NULL
    OR p_offline < 0 OR p_offline > 1
    OR p_baseline < 0 OR p_baseline > 1
    OR p_offline < p_baseline
  THEN
    RAISE EXCEPTION 'offline evaluation is required before a policy change';
  END IF;
  SELECT * INTO candidate FROM policy_candidates WHERE id = p_id;
  IF candidate.id IS NULL THEN
    RAISE EXCEPTION 'policy not found';
  END IF;
  IF candidate.tenant_id IS DISTINCT FROM app.current_tenant() THEN
    RAISE EXCEPTION 'policy is not in this tenant';
  END IF;
  IF candidate.status IS DISTINCT FROM 'proposed' AND candidate.status IS DISTINCT FROM 'offline_passed' THEN
    RAISE EXCEPTION 'offline evaluation is required before a policy change';
  END IF;
  UPDATE policy_candidates
  SET status = 'offline_passed',
      offline_score = p_offline,
      baseline_score = p_baseline
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION app.record_offline_result IS
  'Records an offline score for this tenant. It does not activate the policy and it does not train.';

REVOKE ALL ON FUNCTION app.record_offline_result(uuid, numeric, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.activate_policy(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  candidate policy_candidates%ROWTYPE;
BEGIN
  SELECT * INTO candidate FROM policy_candidates WHERE id = p_id;
  IF candidate.id IS NULL THEN
    RAISE EXCEPTION 'policy not found';
  END IF;
  IF candidate.tenant_id IS DISTINCT FROM app.current_tenant() THEN
    RAISE EXCEPTION 'policy is not in this tenant';
  END IF;
  IF candidate.status IS DISTINCT FROM 'offline_passed'
    OR candidate.offline_score IS NULL
    OR candidate.baseline_score IS NULL
    OR candidate.offline_score < candidate.baseline_score
  THEN
    RAISE EXCEPTION 'offline evaluation is required before a policy change';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bandit_arms
    WHERE tenant_id = candidate.tenant_id AND status = 'halted'
  ) THEN
    RAISE EXCEPTION 'reward drift halted this policy';
  END IF;
  UPDATE policy_candidates SET status = 'active' WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.select_bandit_arm(p_tenant uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF current_setting('app.bandit', true) IS DISTINCT FROM '1' THEN
    RETURN NULL;
  END IF;
  IF p_tenant IS DISTINCT FROM app.current_tenant() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;
  IF p_kind NOT IN ('prompt', 'model', 'strategy') THEN
    RAISE EXCEPTION 'unknown bandit kind';
  END IF;
  RETURN (
    SELECT arm_code
    FROM bandit_arms
    WHERE tenant_id = p_tenant
      AND kind = p_kind
      AND status = 'active'
    ORDER BY reward_sum / GREATEST(pulls, 1) DESC, arm_code
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION app.select_bandit_arm IS
  'Null unless app.bandit is 1 and an active arm exists. Halted and shadow arms are skipped.';

ALTER TABLE training_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY training_consents_isolation ON training_consents
  USING (org_id = app.current_tenant())
  WITH CHECK (org_id = app.current_tenant());

ALTER TABLE training_authorisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_authorisations FORCE ROW LEVEL SECURITY;
CREATE POLICY training_authorisations_isolation ON training_authorisations
  USING (org_id = app.current_tenant());

ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_events FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_events_isolation ON feedback_events
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE preference_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_pairs FORCE ROW LEVEL SECURITY;
CREATE POLICY preference_pairs_isolation ON preference_pairs
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE policy_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_candidates_isolation ON policy_candidates
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE bandit_arms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bandit_arms FORCE ROW LEVEL SECURITY;
CREATE POLICY bandit_arms_isolation ON bandit_arms
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE bandit_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bandit_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY bandit_decisions_isolation ON bandit_decisions
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

GRANT SELECT, INSERT, UPDATE ON training_consents TO orbexa_app;
GRANT SELECT ON training_authorisations TO orbexa_app;
GRANT SELECT, INSERT ON feedback_events, preference_pairs, bandit_decisions TO orbexa_app, orbexa_worker;
GRANT SELECT, INSERT, UPDATE ON bandit_arms TO orbexa_app;
GRANT SELECT, INSERT ON policy_candidates TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.consider_preference_export(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.record_offline_result(uuid, numeric, numeric) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.activate_policy(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.select_bandit_arm(uuid, text) TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.grant_founder_authorisation(uuid, text) TO orbexa_app;

REVOKE ALL ON FUNCTION app.consider_preference_export(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.activate_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.select_bandit_arm(uuid, text) FROM PUBLIC;
