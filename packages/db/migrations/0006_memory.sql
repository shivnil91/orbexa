-- Four memory layers. Provenance for a buyer-derived lesson stays on
-- memory_provenance, which the worker cannot read. The retrievable lesson
-- row has no buyer tenant id.

CREATE TABLE consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  subject_type text NOT NULL CHECK (subject_type IN (
    'same_region_abstracted_lesson', 'cross_border_abstracted_lesson'
  )),
  granted boolean NOT NULL,
  lawful_basis text NOT NULL CHECK (lawful_basis = 'consent'),
  granted_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER consent_grants_region
  BEFORE INSERT OR UPDATE OF home_region ON consent_grants
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE lesson_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  source_job_id uuid NOT NULL,
  proposed_text text NOT NULL,
  redaction_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('proposed', 'rejected', 'approved', 'revoked')),
  consent_grant_id uuid,
  reviewer_user_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (source_job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER lesson_candidates_region
  BEFORE INSERT OR UPDATE OF home_region ON lesson_candidates
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE memory_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  source_type text NOT NULL CHECK (source_type IN (
    'model_scratch', 'buyer_document', 'run_derivation', 'creator_authored', 'lesson_candidate'
  )),
  source_document_id uuid,
  source_chunk_id uuid,
  source_job_id uuid,
  source_candidate_id uuid,
  locator text,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type <> 'lesson_candidate' OR source_candidate_id IS NOT NULL),
  CHECK (source_type <> 'buyer_document' OR source_document_id IS NOT NULL),
  CHECK (
    source_type <> 'creator_authored'
    OR (source_document_id IS NULL AND source_job_id IS NULL AND source_candidate_id IS NULL)
  )
);

COMMENT ON TABLE memory_provenance IS
  'Source identity for a memory item. Buyer-derived rows stay here and are not granted to the worker. Retrieval of lessons must not join this table.';

CREATE TRIGGER memory_provenance_region
  BEFORE INSERT OR UPDATE OF home_region ON memory_provenance
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  owner_org_id uuid NOT NULL REFERENCES orgs (id),
  tenant_id uuid REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  scope text NOT NULL CHECK (scope IN (
    'execution', 'buyer_private', 'creator_expertise', 'approved_reusable'
  )),
  authority text NOT NULL CHECK (authority IN ('contract', 'owner', 'consent')),
  consent_grant_id uuid,
  consent_expires_at timestamptz,
  consent_revoked_at timestamptz,
  provenance_id uuid NOT NULL REFERENCES memory_provenance (id),
  agent_id uuid REFERENCES agents (id),
  job_id uuid,
  run_id uuid,
  retain_until timestamptz,
  scrubbed boolean NOT NULL DEFAULT false,
  pii_scan_status text NOT NULL DEFAULT 'not_required' CHECK (
    pii_scan_status IN ('not_required', 'clear', 'blocked')
  ),
  confidentiality_scan_status text NOT NULL DEFAULT 'not_required' CHECK (
    confidentiality_scan_status IN ('not_required', 'clear', 'blocked')
  ),
  ip_status text NOT NULL DEFAULT 'not_required' CHECK (
    ip_status IN ('not_required', 'clear', 'blocked')
  ),
  transferable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'revoked')),
  body text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logical_id, version),
  CHECK (
    (
      scope = 'execution'
      AND tenant_id IS NOT NULL
      AND owner_org_id = tenant_id
      AND job_id IS NOT NULL
      AND run_id IS NOT NULL
      AND retain_until IS NOT NULL
      AND authority = 'contract'
      AND consent_grant_id IS NULL
      AND NOT transferable
      AND NOT scrubbed
    )
    OR (
      scope = 'buyer_private'
      AND tenant_id IS NOT NULL
      AND owner_org_id = tenant_id
      AND run_id IS NULL
      AND authority = 'contract'
      AND consent_grant_id IS NULL
      AND NOT transferable
      AND (
        (job_id IS NOT NULL AND retain_until IS NOT NULL)
        OR (job_id IS NULL AND retain_until IS NULL)
      )
    )
    OR (
      scope = 'creator_expertise'
      AND tenant_id IS NOT NULL
      AND owner_org_id = tenant_id
      AND agent_id IS NOT NULL
      AND job_id IS NULL
      AND run_id IS NULL
      AND retain_until IS NULL
      AND authority = 'owner'
      AND consent_grant_id IS NULL
      AND NOT transferable
    )
    OR (
      scope = 'approved_reusable'
      AND tenant_id IS NULL
      AND agent_id IS NOT NULL
      AND job_id IS NULL
      AND run_id IS NULL
      AND retain_until IS NULL
      AND authority = 'consent'
      AND consent_grant_id IS NOT NULL
      AND transferable
      AND scrubbed
      AND pii_scan_status = 'clear'
      AND confidentiality_scan_status = 'clear'
      AND ip_status = 'clear'
    )
  )
);

COMMENT ON TABLE memory_items IS
  'Working and job context are buyer-tenant and job-scoped. Creator expertise is the creator org. Approved lessons have no buyer tenant id; consent and provenance are separate.';

CREATE INDEX memory_items_consent_idx ON memory_items (consent_grant_id);
CREATE INDEX memory_items_scope_idx ON memory_items (scope, agent_id) WHERE deleted_at IS NULL;

CREATE TRIGGER memory_items_region
  BEFORE INSERT OR UPDATE OF home_region ON memory_items
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE memory_snapshot_items (
  snapshot_id uuid NOT NULL REFERENCES memory_snapshots (id),
  memory_item_id uuid NOT NULL REFERENCES memory_items (id),
  PRIMARY KEY (snapshot_id, memory_item_id)
);

CREATE TABLE memory_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id uuid NOT NULL REFERENCES memory_items (id),
  tenant_id uuid,
  home_region text NOT NULL REFERENCES processing_regions (id),
  scope text NOT NULL CHECK (scope IN ('buyer_private', 'creator_expertise', 'approved_reusable')),
  model_id uuid NOT NULL REFERENCES embedding_models (id),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memory_item_id, model_id)
);

COMMENT ON TABLE memory_embeddings IS
  'No embeddings for execution memory, and no HNSW index on buyer-private rows. Creator expertise and approved reusable intelligence can use the partial index because those rows are not buyer documents.';

CREATE INDEX memory_embeddings_public_hnsw
  ON memory_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE scope IN ('creator_expertise', 'approved_reusable');

CREATE TRIGGER memory_embeddings_region
  BEFORE INSERT OR UPDATE OF home_region ON memory_embeddings
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.assert_memory_embedding_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  item memory_items%ROWTYPE;
BEGIN
  SELECT * INTO item FROM memory_items WHERE id = NEW.memory_item_id;
  IF item.scope = 'execution' THEN
    RAISE EXCEPTION 'execution memory is not embedded';
  END IF;
  IF item.scope IS DISTINCT FROM NEW.scope OR item.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'embedding scope must match the memory item';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_embeddings_scope
  BEFORE INSERT OR UPDATE ON memory_embeddings
  FOR EACH ROW EXECUTE FUNCTION app.assert_memory_embedding_scope();

CREATE OR REPLACE FUNCTION app.revoke_lessons_with_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE memory_items
    SET consent_revoked_at = NEW.revoked_at,
        status = 'revoked'
    WHERE consent_grant_id = NEW.id
      AND scope = 'approved_reusable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_grants_revoke_lessons
  AFTER UPDATE OF revoked_at ON consent_grants
  FOR EACH ROW EXECUTE FUNCTION app.revoke_lessons_with_consent();

CREATE OR REPLACE FUNCTION app.purge_expired_memory()
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  affected integer;
BEGIN
  PERFORM set_config('app.purge', '1', true);
  UPDATE memory_items
  SET body = '[purged]',
      deleted_at = COALESCE(deleted_at, now())
  WHERE scope IN ('execution', 'buyer_private')
    AND retain_until IS NOT NULL
    AND retain_until < now()
    AND deleted_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION app.memory_body_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.purge', true) = '1' AND NEW.body = '[purged]' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'memory body is immutable outside purge';
END;
$$;

CREATE TRIGGER memory_items_body
  BEFORE UPDATE ON memory_items
  FOR EACH ROW EXECUTE FUNCTION app.memory_body_guard();
