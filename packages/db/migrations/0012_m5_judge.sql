-- Milestone 5. The judge score sits beside the deterministic score.
-- A false judge_passed blocks promotion. NULL stays allowed for rows
-- written before a judge ran. Customer tenders stay out of the suite.

ALTER TABLE eval_suite_versions
  ADD COLUMN rubric jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN eval_suite_versions.rubric IS
  'Rubric codes for this suite version. The judge scores against this list.';

ALTER TABLE eval_runs
  ADD COLUMN judge_score numeric(6, 4),
  ADD COLUMN judge_passed boolean,
  ADD COLUMN judge_rubric jsonb,
  ADD CONSTRAINT eval_runs_judge_score_chk
    CHECK (judge_score IS NULL OR (judge_score >= 0 AND judge_score <= 1));

COMMENT ON COLUMN eval_runs.judge_score IS
  'Second score from the rubric judge. It does not replace eval_runs.score.';

COMMENT ON COLUMN eval_runs.judge_passed IS
  'False blocks promotion. NULL means this row was recorded before the judge ran.';

CREATE OR REPLACE FUNCTION app.assert_version_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status = 'rolled_back'
    AND current_setting('app.rollback', true) IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION 'rollback goes through app.rollback_agent_version';
  END IF;
  IF NEW.status = 'published'
    AND TG_OP = 'UPDATE'
    AND OLD.status = 'superseded'
    AND current_user = 'orbexa_learning'
  THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'published'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
  THEN
    IF NEW.promotion_basis = 'initial_human' THEN
      IF EXISTS (
        SELECT 1 FROM agent_versions AS sibling
        WHERE sibling.agent_id = NEW.agent_id
          AND sibling.id <> NEW.id
          AND sibling.status IN ('published', 'superseded', 'rolled_back')
      ) THEN
        RAISE EXCEPTION 'initial_human is only valid for the first publication';
      END IF;
    ELSIF NEW.promotion_basis = 'eval_improved' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM agent_versions AS previous
        JOIN eval_runs AS new_run
          ON new_run.agent_version_id = NEW.id AND new_run.passed
        JOIN eval_runs AS old_run
          ON old_run.agent_version_id = previous.id
          AND old_run.passed
          AND old_run.suite_id = new_run.suite_id
        WHERE previous.id = NEW.previous_version_id
          AND previous.agent_id = NEW.agent_id
          AND new_run.score > old_run.score
          AND new_run.judge_passed IS DISTINCT FROM false
      ) THEN
        RAISE EXCEPTION 'promotion requires a passing eval that beats the previous version';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM version_approvals AS approval
        WHERE approval.agent_version_id = NEW.id
          AND approval.status = 'approved'
      ) THEN
        RAISE EXCEPTION 'creator approval required';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown promotion basis';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;;

CREATE OR REPLACE FUNCTION app.publish_learned_version(
  p_version uuid,
  p_candidate uuid,
  p_actor uuid,
  p_content_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  draft agent_versions%ROWTYPE;
  cand lesson_candidates%ROWTYPE;
  approval version_approvals%ROWTYPE;
  creator uuid;
  snap uuid;
  provenance uuid;
  memory_id uuid;
  body_hash text;
  embedding vector(1536);
  cell text;
  consent_expires timestamptz;
BEGIN
  SELECT * INTO draft FROM agent_versions WHERE id = p_version FOR UPDATE;
  IF draft.id IS NULL OR draft.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft version can be published by the learning loop';
  END IF;
  IF draft.promotion_basis IS DISTINCT FROM 'eval_improved' OR draft.previous_version_id IS NULL THEN
    RAISE EXCEPTION 'promotion requires a passing eval that beats the previous version';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM eval_runs AS new_run
    JOIN eval_runs AS old_run
      ON old_run.agent_version_id = draft.previous_version_id
     AND old_run.suite_id = new_run.suite_id
     AND old_run.passed
    WHERE new_run.agent_version_id = draft.id
      AND new_run.passed
      AND new_run.score > old_run.score
      AND new_run.judge_passed IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'promotion requires a passing eval that beats the previous version';
  END IF;
  SELECT * INTO cand FROM lesson_candidates WHERE id = p_candidate;
  IF cand.id IS NULL
    OR cand.status NOT IN ('proposed', 'approved')
    OR cand.scrub_status IS DISTINCT FROM 'clear'
    OR cand.permission_class IS DISTINCT FROM 'same_region_abstracted'
    OR cand.consent_grant_id IS NULL
    OR app.lesson_restriction(cand.proposed_text, cand.tenant_id) IS NOT NULL
  THEN
    RAISE EXCEPTION 'no consent row means no promotion';
  END IF;
  SELECT * INTO approval
  FROM version_approvals
  WHERE agent_version_id = draft.id
    AND candidate_id = cand.id
    AND status = 'approved'
    AND actor_user_id = p_actor;
  IF approval.id IS NULL OR approval.scrubbed_text IS DISTINCT FROM cand.proposed_text THEN
    RAISE EXCEPTION 'creator approval required';
  END IF;
  SELECT agent.creator_org_id INTO creator FROM agents AS agent WHERE agent.id = draft.agent_id;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = creator AND user_id = p_actor
  ) THEN
    RAISE EXCEPTION 'creator approval required';
  END IF;

  IF p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'content hash is not sha256';
  END IF;
  body_hash := p_content_hash;
  SELECT region INTO cell FROM cell_identity;
  SELECT expires_at INTO consent_expires FROM consent_grants WHERE id = cand.consent_grant_id;

  INSERT INTO memory_provenance (
    tenant_id, home_region, source_type, source_job_id, source_candidate_id, content_hash
  ) VALUES (
    cand.tenant_id, cand.home_region, 'lesson_candidate', cand.source_job_id, cand.id, body_hash
  ) RETURNING id INTO provenance;

  INSERT INTO memory_items (
    logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
    consent_grant_id, consent_expires_at, provenance_id, agent_id, scrubbed,
    pii_scan_status, confidentiality_scan_status, ip_status, transferable, status,
    body, content_hash
  ) VALUES (
    gen_random_uuid(), 1, creator, NULL, cell, 'approved_reusable', 'consent',
    cand.consent_grant_id, consent_expires, provenance, draft.agent_id, true,
    'clear', 'clear', 'clear', true, 'active', cand.proposed_text, body_hash
  ) RETURNING id INTO memory_id;

  SELECT ('[' || string_agg('0.0200', ',') || ']')::vector(1536)
  INTO embedding
  FROM generate_series(1, 1536);

  INSERT INTO memory_embeddings (
    memory_item_id, tenant_id, home_region, scope, model_id, embedding
  ) VALUES (
    memory_id, NULL, cell, 'approved_reusable', draft.embedding_model_id, embedding
  );

  INSERT INTO memory_snapshots (agent_id) VALUES (draft.agent_id) RETURNING id INTO snap;

  INSERT INTO memory_snapshot_items (snapshot_id, memory_item_id)
  SELECT snap, item.id
  FROM memory_items AS item
  WHERE item.scope = 'creator_expertise'
    AND item.agent_id = draft.agent_id
    AND item.status = 'active'
    AND item.deleted_at IS NULL
  UNION
  SELECT snap, memory_id
  UNION
  SELECT snap, pinned.memory_item_id
  FROM agent_versions AS published
  JOIN memory_snapshot_items AS pinned
    ON pinned.snapshot_id = published.memory_snapshot_id
  WHERE published.agent_id = draft.agent_id
    AND published.status = 'published'
    AND published.id <> draft.id;

  UPDATE agent_versions
  SET memory_snapshot_id = snap,
      status = 'published',
      published_at = now()
  WHERE id = draft.id;
  UPDATE lesson_candidates
  SET status = 'approved',
      reviewer_user_id = p_actor,
      decided_at = now()
  WHERE id = cand.id;
  INSERT INTO audit_log (
    actor_user_id, actor_role, tenant_id, home_region, action, resource_type, resource_id, metadata
  ) VALUES (
    p_actor, 'expert', creator, cell, 'lesson_published', 'agent_version', draft.id,
    jsonb_build_object('memory_snapshot_id', snap)
  );
  RETURN snap;
END;
$$;
