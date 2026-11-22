-- Milestone 3 learning loop. Customer tenders are not eval cases.
-- Approved lessons carry no buyer id. Provenance stays on memory_provenance,
-- which the worker cannot read. Promotion of a later version still requires
-- a higher passing eval; this migration adds the creator approval gate for
-- the learning-loop publish path and the scrub that blocks buyer data.

CREATE TABLE eval_suite_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL REFERENCES eval_suites (id),
  version integer NOT NULL CHECK (version > 0),
  fixture_kind text NOT NULL CHECK (fixture_kind IN ('synthetic', 'licensed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suite_id, version)
);

COMMENT ON TABLE eval_suite_versions IS
  'A golden suite version. fixture_kind is synthetic or licensed. Customer tenders are not inserted here.';

ALTER TABLE eval_cases
  ADD COLUMN suite_version_id uuid REFERENCES eval_suite_versions (id),
  ADD COLUMN expectation jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE eval_runs
  ADD COLUMN suite_version_id uuid REFERENCES eval_suite_versions (id);

ALTER TABLE lesson_candidates
  ADD COLUMN permission_class text NOT NULL DEFAULT 'no_reuse',
  ADD COLUMN scrub_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN rejection_reason text,
  ADD COLUMN source_permission text;

ALTER TABLE lesson_candidates
  ADD CONSTRAINT lesson_candidates_permission_chk
    CHECK (permission_class IN (
      'no_reuse', 'same_region_abstracted', 'cross_border_abstracted'
    )),
  ADD CONSTRAINT lesson_candidates_scrub_chk
    CHECK (scrub_status IN ('pending', 'clear', 'rejected')),
  ADD CONSTRAINT lesson_candidates_source_chk
    CHECK (
      source_permission IS NULL
      OR source_permission IN ('owner_authored', 'licensed', 'public', 'unknown')
    ),
  ADD CONSTRAINT lesson_candidates_rejected_chk
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  ADD CONSTRAINT lesson_candidates_approved_chk
    CHECK (
      status <> 'approved'
      OR (
        scrub_status = 'clear'
        AND permission_class <> 'no_reuse'
        AND consent_grant_id IS NOT NULL
      )
    );

CREATE TABLE version_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_org_id uuid NOT NULL REFERENCES orgs (id),
  agent_version_id uuid NOT NULL UNIQUE REFERENCES agent_versions (id),
  candidate_id uuid NOT NULL REFERENCES lesson_candidates (id),
  scrubbed_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE version_approvals IS
  'Creator gate for a learned version. The scrubbed lesson text is stored here so the creator can read it. The buyer tenant id is not stored here.';

CREATE TABLE learning_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  candidate_id uuid,
  action text NOT NULL CHECK (action IN (
    'metrics_recorded', 'feedback_recorded', 'candidate_proposed', 'candidate_rejected',
    'eval_scored', 'creator_approved', 'version_published', 'version_rolled_back'
  )),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id)
);

COMMENT ON TABLE learning_evidence IS
  'Append-only record of the post-job loop. detail is codes and counts, not document text and not a rating comment.';

CREATE TRIGGER learning_evidence_region
  BEFORE INSERT OR UPDATE OF home_region ON learning_evidence
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER learning_evidence_append_only
  BEFORE UPDATE OR DELETE ON learning_evidence
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE OR REPLACE FUNCTION app.copies_buyer_document(p_text text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM document_chunks AS chunk
    JOIN orgs AS org ON org.id = chunk.tenant_id
    WHERE org.kind = 'buyer'
      AND chunk.deleted_at IS NULL
      AND length(chunk.body) >= 24
      AND position(lower(chunk.body) IN lower(p_text)) > 0
  )
$$;

CREATE OR REPLACE FUNCTION app.lesson_restriction(p_text text, p_buyer uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  lowered text := lower(COALESCE(p_text, ''));
  org_name text;
  person_name text;
BEGIN
  IF app.copies_buyer_document(p_text) THEN
    RETURN 'buyer_document';
  END IF;
  IF p_buyer IS NULL THEN
    SELECT org.legal_name INTO org_name
    FROM orgs AS org
    WHERE org.kind = 'buyer'
      AND length(org.legal_name) >= 4
      AND position(lower(org.legal_name) IN lowered) > 0
    LIMIT 1;
  ELSE
    SELECT org.legal_name INTO org_name
    FROM orgs AS org
    WHERE org.id = p_buyer
      AND length(org.legal_name) >= 4
      AND position(lower(org.legal_name) IN lowered) > 0;
  END IF;
  IF org_name IS NOT NULL THEN
    RETURN 'buyer_name';
  END IF;
  SELECT users.display_name INTO person_name
  FROM org_memberships AS membership
  JOIN users ON users.id = membership.user_id
  JOIN orgs AS org ON org.id = membership.org_id
  WHERE org.kind = 'buyer'
    AND (p_buyer IS NULL OR membership.org_id = p_buyer)
    AND length(users.display_name) >= 4
    AND position(lower(users.display_name) IN lowered) > 0
  LIMIT 1;
  IF person_name IS NOT NULL THEN
    RETURN 'buyer_name';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM org_memberships AS membership
    JOIN users ON users.id = membership.user_id
    JOIN orgs AS org ON org.id = membership.org_id
    WHERE org.kind = 'buyer'
      AND (p_buyer IS NULL OR membership.org_id = p_buyer)
      AND position(lower(users.email) IN lowered) > 0
  ) THEN
    RETURN 'buyer_name';
  END IF;
  IF p_text ~* '\$\s*\d'
    OR p_text ~* '\m(USD|EUR|GBP|NZD|AUD|FJD|JPY)\s*\d'
    OR p_text ~* '\m\d[\d,]*(?:\.\d+)?\s*(USD|EUR|GBP|NZD|AUD|FJD|JPY)\M'
    OR p_text ~* '\mprices?\M'
  THEN
    RETURN 'price';
  END IF;
  IF p_text ~* '\mCERT[- ][A-Z0-9]{3,}\M'
    OR p_text ~* '\mCERT\d{3,}\M'
    OR p_text ~ '\m[A-Z]{2,6}-\d{4,}\M'
    OR p_text ~* 'certificate\s*(number|no\.?|#)\s*[A-Z0-9-]+'
  THEN
    RETURN 'certificate_number';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.classify_lesson(
  p_buyer uuid,
  p_job uuid,
  p_text text,
  OUT permission_class text,
  OUT source_permission text,
  OUT consent_grant_id uuid,
  OUT restriction text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  subject text;
BEGIN
  restriction := app.lesson_restriction(p_text, p_buyer);
  permission_class := 'no_reuse';
  source_permission := 'unknown';
  consent_grant_id := NULL;
  IF NOT EXISTS (
    SELECT 1
    FROM source_permissions AS permission
    JOIN documents AS document ON document.id = permission.document_id
    WHERE document.job_id = p_job
      AND document.tenant_id = p_buyer
  ) OR EXISTS (
    SELECT 1
    FROM source_permissions AS permission
    JOIN documents AS document ON document.id = permission.document_id
    WHERE document.job_id = p_job
      AND document.tenant_id = p_buyer
      AND permission.permission = 'unknown'
  ) THEN
    source_permission := 'unknown';
  ELSE
    SELECT CASE
      WHEN bool_or(permission.permission = 'owner_authored') THEN 'owner_authored'
      WHEN bool_or(permission.permission = 'licensed') THEN 'licensed'
      ELSE 'public'
    END
    INTO source_permission
    FROM source_permissions AS permission
    JOIN documents AS document ON document.id = permission.document_id
    WHERE document.job_id = p_job
      AND document.tenant_id = p_buyer;
  END IF;
  IF restriction IS NOT NULL OR source_permission = 'unknown' THEN
    RETURN;
  END IF;
  SELECT grant_row.id, grant_row.subject_type
  INTO consent_grant_id, subject
  FROM consent_grants AS grant_row
  WHERE grant_row.buyer_org_id = p_buyer
    AND grant_row.granted
    AND grant_row.revoked_at IS NULL
    AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
  ORDER BY CASE grant_row.subject_type
    WHEN 'same_region_abstracted_lesson' THEN 0
    ELSE 1
  END
  LIMIT 1;
  IF consent_grant_id IS NULL THEN
    RETURN;
  END IF;
  IF subject = 'same_region_abstracted_lesson' THEN
    permission_class := 'same_region_abstracted';
  ELSE
    permission_class := 'cross_border_abstracted';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.review_lesson_candidate(p_job uuid, p_text text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  job_row jobs%ROWTYPE;
  class record;
  reason text;
  new_id uuid;
  next_status text;
BEGIN
  SELECT * INTO job_row FROM jobs WHERE id = p_job;
  IF job_row.id IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;
  IF job_row.status <> 'accepted' THEN
    RAISE EXCEPTION 'lessons are proposed only after a terminal job';
  END IF;
  SELECT * INTO class FROM app.classify_lesson(job_row.tenant_id, p_job, p_text);
  reason := class.restriction;
  IF p_text IS NULL OR length(btrim(p_text)) < 20 OR length(p_text) > 800 THEN
    reason := COALESCE(reason, 'unusable');
  END IF;
  next_status := CASE WHEN reason IS NULL THEN 'proposed' ELSE 'rejected' END;
  INSERT INTO lesson_candidates (
    tenant_id, home_region, source_job_id, proposed_text, redaction_report,
    status, consent_grant_id, permission_class, scrub_status, rejection_reason,
    source_permission, decided_at
  ) VALUES (
    job_row.tenant_id,
    job_row.home_region,
    p_job,
    p_text,
    jsonb_build_object(
      'permission_class', CASE WHEN reason IS NULL THEN class.permission_class ELSE 'no_reuse' END,
      'restriction', reason
    ),
    next_status,
    CASE WHEN reason IS NULL AND class.permission_class <> 'no_reuse' THEN class.consent_grant_id ELSE NULL END,
    CASE WHEN reason IS NULL THEN class.permission_class ELSE 'no_reuse' END,
    CASE WHEN reason IS NULL THEN 'clear' ELSE 'rejected' END,
    reason,
    class.source_permission,
    CASE WHEN reason IS NULL THEN NULL ELSE now() END
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.assert_lesson_promotable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF NEW.scrub_status IS DISTINCT FROM 'clear'
    OR NEW.permission_class <> 'same_region_abstracted'
    OR NEW.consent_grant_id IS NULL
    OR app.lesson_restriction(NEW.proposed_text, NEW.tenant_id) IS NOT NULL
  THEN
    RAISE EXCEPTION 'no consent row means no promotion';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM consent_grants AS grant_row
    WHERE grant_row.id = NEW.consent_grant_id
      AND grant_row.buyer_org_id = NEW.tenant_id
      AND grant_row.granted
      AND grant_row.revoked_at IS NULL
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      AND grant_row.subject_type = 'same_region_abstracted_lesson'
  ) THEN
    RAISE EXCEPTION 'no consent row means no promotion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lesson_candidates_promotable
  BEFORE INSERT OR UPDATE OF status, proposed_text ON lesson_candidates
  FOR EACH ROW EXECUTE FUNCTION app.assert_lesson_promotable();

CREATE OR REPLACE FUNCTION app.guard_memory_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  restriction text;
BEGIN
  IF NEW.scope = 'creator_expertise' AND app.copies_buyer_document(NEW.body) THEN
    restriction := 'buyer_document';
  ELSIF NEW.scope = 'approved_reusable' THEN
    restriction := app.lesson_restriction(NEW.body, NULL);
  END IF;
  IF restriction IS NOT NULL THEN
    RAISE EXCEPTION 'memory item failed the content check: %', restriction;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_items_content
  BEFORE INSERT OR UPDATE OF body, scope ON memory_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_memory_content();

CREATE OR REPLACE FUNCTION app.assert_eval_fixture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  kind text;
  haystack text;
BEGIN
  SELECT fixture_kind INTO kind FROM eval_suite_versions WHERE id = NEW.suite_version_id;
  IF kind IS NULL THEN
    RAISE EXCEPTION 'eval cases belong to a versioned synthetic or licensed suite';
  END IF;
  IF NEW.fixture_storage_key NOT LIKE 'fixtures/%'
    OR (kind = 'synthetic' AND position('/synthetic/' IN NEW.fixture_storage_key) = 0)
    OR (kind = 'licensed' AND position('/licensed/' IN NEW.fixture_storage_key) = 0)
  THEN
    RAISE EXCEPTION 'customer tenders are not golden cases';
  END IF;
  haystack := lower(NEW.fixture_storage_key || ' ' || NEW.expectation::text);
  IF EXISTS (
    SELECT 1
    FROM document_chunks AS chunk
    JOIN orgs AS org ON org.id = chunk.tenant_id
    WHERE org.kind = 'buyer'
      AND chunk.deleted_at IS NULL
      AND length(chunk.body) >= 24
      AND position(lower(chunk.body) IN haystack) > 0
  ) THEN
    RAISE EXCEPTION 'customer tenders are not golden cases';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eval_cases_fixture
  BEFORE INSERT OR UPDATE ON eval_cases
  FOR EACH ROW EXECUTE FUNCTION app.assert_eval_fixture();

CREATE OR REPLACE FUNCTION app.assert_approval_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  restriction text;
BEGIN
  restriction := app.lesson_restriction(NEW.scrubbed_text, NULL);
  IF restriction IS NOT NULL THEN
    RAISE EXCEPTION 'approval text failed the restriction scan: %', restriction;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER version_approvals_text
  BEFORE INSERT OR UPDATE OF scrubbed_text ON version_approvals
  FOR EACH ROW EXECUTE FUNCTION app.assert_approval_text();

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
  IF NEW.status = 'published' AND current_setting('app.rollback', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.learning_publish', true) = '1'
    AND NEW.status = 'published'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
    AND NOT EXISTS (
      SELECT 1
      FROM version_approvals AS approval
      WHERE approval.agent_version_id = NEW.id
        AND approval.status = 'approved'
    )
  THEN
    RAISE EXCEPTION 'creator approval required';
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
      ) THEN
        RAISE EXCEPTION 'promotion requires a passing eval that beats the previous version';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown promotion basis';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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

  PERFORM set_config('app.learning_publish', '1', true);
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

COMMENT ON FUNCTION app.publish_learned_version IS
  'Publishes a learned draft after a higher eval and a creator approval. The reusable row has no buyer tenant id. Cross-border lessons are refused while the cell is single-region.';

CREATE OR REPLACE FUNCTION app.reembed_fixture(p_from uuid, p_to uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  copied integer := 0;
  inserted integer;
BEGIN
  IF p_from = p_to THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM embedding_models WHERE id = p_to AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'embedding model is not active';
  END IF;
  INSERT INTO chunk_embeddings (chunk_id, tenant_id, home_region, model_id, embedding)
  SELECT chunk_id, tenant_id, home_region, p_to, embedding
  FROM chunk_embeddings
  WHERE model_id = p_from
  ON CONFLICT (chunk_id, model_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  copied := copied + inserted;
  INSERT INTO memory_embeddings (memory_item_id, tenant_id, home_region, scope, model_id, embedding)
  SELECT memory_item_id, tenant_id, home_region, scope, p_to, embedding
  FROM memory_embeddings
  WHERE model_id = p_from
  ON CONFLICT (memory_item_id, model_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN copied + inserted;
END;
$$;

COMMENT ON FUNCTION app.reembed_fixture IS
  'Copies stored vectors onto a new embedding model id. It does not call a model provider. Old chunk rows and citations stay in place.';

CREATE OR REPLACE FUNCTION app.retrieve_memory(
  p_scope text,
  p_agent uuid,
  p_model uuid,
  p_query_embedding vector(1536),
  p_limit integer
)
RETURNS TABLE (memory_item_id uuid, score double precision)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF p_scope NOT IN ('creator_expertise', 'approved_reusable', 'buyer_private') THEN
    RAISE EXCEPTION 'scope cannot be retrieved this way';
  END IF;
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'limit out of range';
  END IF;
  RETURN QUERY
  SELECT items.id,
         (1 - (embeddings.embedding <=> p_query_embedding))::double precision AS score
  FROM memory_items AS items
  JOIN memory_embeddings AS embeddings ON embeddings.memory_item_id = items.id
  WHERE items.scope = p_scope
    AND items.deleted_at IS NULL
    AND items.status = 'active'
    AND (
      p_scope <> 'buyer_private'
      OR items.job_id IS NULL
      OR items.job_id = app.current_job()
    )
    AND (p_scope = 'buyer_private' OR items.agent_id = p_agent)
    AND embeddings.model_id = p_model
    AND (items.consent_revoked_at IS NULL)
    AND (items.consent_expires_at IS NULL OR items.consent_expires_at > now())
    AND (
      p_scope <> 'approved_reusable'
      OR EXISTS (
        SELECT 1
        FROM agent_versions AS version
        JOIN memory_snapshot_items AS pinned
          ON pinned.snapshot_id = version.memory_snapshot_id
         AND pinned.memory_item_id = items.id
        WHERE version.agent_id = items.agent_id
          AND version.status = 'published'
      )
    )
  ORDER BY embeddings.embedding <=> p_query_embedding
  LIMIT p_limit;
END;
$$;

DROP POLICY memory_items_read ON memory_items;
CREATE POLICY memory_items_read ON memory_items
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (
        scope = 'execution'
        AND tenant_id = app.current_tenant()
        AND job_id = app.current_job()
        AND run_id = app.current_run()
        AND app.can_read_job(job_id, tenant_id)
      )
      OR (
        scope = 'buyer_private'
        AND tenant_id = app.current_tenant()
        AND (
          (job_id IS NULL AND app.access_mode() = 'org')
          OR app.can_read_job(job_id, tenant_id)
        )
      )
      OR (
        scope = 'creator_expertise'
        AND tenant_id = app.current_tenant()
        AND status = 'active'
      )
      OR (
        scope = 'approved_reusable'
        AND tenant_id IS NULL
        AND status = 'active'
        AND consent_revoked_at IS NULL
        AND (consent_expires_at IS NULL OR consent_expires_at > now())
        AND agent_id = app.current_agent()
        AND (
          owner_org_id = app.current_tenant()
          OR app.job_uses_agent(app.current_job(), app.current_tenant(), memory_items.agent_id)
        )
        AND EXISTS (
          SELECT 1
          FROM agent_versions AS version
          JOIN memory_snapshot_items AS pinned
            ON pinned.snapshot_id = version.memory_snapshot_id
           AND pinned.memory_item_id = memory_items.id
          WHERE version.agent_id = memory_items.agent_id
            AND version.status = 'published'
        )
      )
    )
  );

ALTER TABLE learning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_evidence_isolation ON learning_evidence
  USING (tenant_id = app.current_tenant() AND app.can_read_job(job_id, tenant_id))
  WITH CHECK (tenant_id = app.current_tenant() AND app.can_read_job(job_id, tenant_id));

ALTER TABLE version_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY version_approvals_isolation ON version_approvals
  USING (creator_org_id = app.current_tenant())
  WITH CHECK (creator_org_id = app.current_tenant());

GRANT SELECT, INSERT ON learning_evidence, eval_suite_versions TO orbexa_app;
GRANT SELECT, INSERT, UPDATE ON version_approvals TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.review_lesson_candidate(uuid, text) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.publish_learned_version(uuid, uuid, uuid, text) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.reembed_fixture(uuid, uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.lesson_restriction(text, uuid) TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.classify_lesson(uuid, uuid, text) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.copies_buyer_document(text) TO orbexa_app, orbexa_worker;
REVOKE ALL ON FUNCTION app.publish_learned_version(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_lesson_candidate(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.lesson_restriction(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.copies_buyer_document(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.classify_lesson(uuid, uuid, text) FROM PUBLIC;
