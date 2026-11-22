-- Buyer-cell work: jobs, immutable document chunks, and claims that can
-- cite only those chunks. Composite foreign keys keep a child row in the
-- same tenant as its parent even for a role that bypasses RLS.

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  order_id uuid NOT NULL UNIQUE REFERENCES orders (id),
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'waiting_for_expert', 'waiting_for_buyer',
    'accepted', 'cancelled', 'failed'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TRIGGER jobs_region
  BEFORE INSERT OR UPDATE OF home_region ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER jobs_touch
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  workflow_id text,
  status text NOT NULL CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

COMMENT ON COLUMN job_runs.workflow_id IS
  'Temporal workflow id. The database outbox starts the workflow. Temporal, not LangGraph, is the durability log.';

CREATE TRIGGER job_runs_region
  BEFORE INSERT OR UPDATE OF home_region ON job_runs
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE job_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (run_id, name),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id)
);

CREATE TRIGGER job_steps_region
  BEFORE INSERT OR UPDATE OF home_region ON job_steps
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  run_id uuid,
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'waiting_for_human', 'succeeded', 'failed', 'cancelled'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

COMMENT ON TABLE job_queue IS
  'Transactional outbox. A committed row is the signal to start or resume the Temporal workflow. It is not a second workflow engine.';

CREATE TRIGGER job_queue_region
  BEFORE INSERT OR UPDATE OF home_region ON job_queue
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE job_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  user_id uuid NOT NULL REFERENCES users (id),
  grant_role text NOT NULL CHECK (grant_role IN ('reviewer', 'observer')),
  granted_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER job_grants_region
  BEFORE INSERT OR UPDATE OF home_region ON job_grants
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expert_review', 'buyer_acceptance')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'changes_requested', 'rejected')),
  actor_user_id uuid REFERENCES users (id),
  comment text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER approvals_region
  BEFORE INSERT OR UPDATE OF home_region ON approvals
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE job_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  currency char(3) NOT NULL REFERENCES currencies (code),
  limit_minor bigint NOT NULL CHECK (limit_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, currency),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

COMMENT ON TABLE job_budgets IS
  'Per-job model-spend cap in one currency. Spent amount is the sum of llm_invocations, not a stored counter.';

CREATE TRIGGER job_budgets_region
  BEFORE INSERT OR UPDATE OF home_region ON job_budgets
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'tender_source', 'supplier_info', 'evidence', 'bid_docx', 'bid_xlsx', 'expert_credential'
  )),
  filename text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  encryption text NOT NULL DEFAULT 'sse-kms' CHECK (encryption = 'sse-kms'),
  malware_scan_status text NOT NULL DEFAULT 'pending' CHECK (
    malware_scan_status IN ('pending', 'clean', 'rejected', 'failed')
  ),
  chunker_version text,
  detected_language text,
  uploaded_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (storage_key LIKE tenant_id::text || '/' || home_region || '/%'),
  CHECK (detected_language IS NULL OR detected_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TRIGGER documents_region
  BEFORE INSERT OR UPDATE OF home_region ON documents
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  document_id uuid NOT NULL,
  job_id uuid NOT NULL,
  chunker_version text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  kind text NOT NULL CHECK (kind IN ('prose', 'table', 'heading')),
  body text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  locator_kind text NOT NULL CHECK (locator_kind IN ('page', 'paragraph', 'cell_range')),
  page integer,
  sheet text,
  cell_range text,
  paragraph_path text,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (document_id, chunker_version, chunk_index),
  FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (
    (locator_kind = 'page' AND page IS NOT NULL)
    OR (locator_kind = 'paragraph' AND paragraph_path IS NOT NULL)
    OR (locator_kind = 'cell_range' AND sheet IS NOT NULL AND cell_range IS NOT NULL)
  )
);

COMMENT ON TABLE document_chunks IS
  'Immutable citation targets. Re-chunking inserts new rows. Retrieval uses the document active chunker version. The simple text-search config is intentional: it does not stem one language away.';

CREATE INDEX document_chunks_job_idx ON document_chunks (tenant_id, job_id);
CREATE INDEX document_chunks_search_idx ON document_chunks USING gin (search_vector);

CREATE TRIGGER document_chunks_region
  BEFORE INSERT OR UPDATE OF home_region ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.chunks_are_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body
    OR NEW.page IS DISTINCT FROM OLD.page
    OR NEW.sheet IS DISTINCT FROM OLD.sheet
    OR NEW.cell_range IS DISTINCT FROM OLD.cell_range
    OR NEW.paragraph_path IS DISTINCT FROM OLD.paragraph_path
    OR NEW.locator_kind IS DISTINCT FROM OLD.locator_kind
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.chunk_index IS DISTINCT FROM OLD.chunk_index
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
  THEN
    RAISE EXCEPTION 'document chunks are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_chunks_immutable
  BEFORE UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION app.chunks_are_immutable();

CREATE TABLE chunk_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  model_id uuid NOT NULL REFERENCES embedding_models (id),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, model_id),
  FOREIGN KEY (chunk_id, tenant_id) REFERENCES document_chunks (id, tenant_id)
);

CREATE INDEX chunk_embeddings_hnsw
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TRIGGER chunk_embeddings_region
  BEFORE INSERT OR UPDATE OF home_region ON chunk_embeddings
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE source_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  document_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('owner_authored', 'licensed', 'public', 'unknown')),
  may_quote boolean NOT NULL,
  may_paraphrase boolean NOT NULL,
  evidence_note text,
  granted_by uuid REFERENCES users (id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id),
  CHECK (permission <> 'unknown' OR (may_quote = false AND may_paraphrase = false))
);

CREATE TRIGGER source_permissions_region
  BEFORE INSERT OR UPDATE OF home_region ON source_permissions
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  document_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mandatory', 'evaluation_criterion', 'desirable')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id),
  FOREIGN KEY (chunk_id, tenant_id) REFERENCES document_chunks (id, tenant_id)
);

CREATE TRIGGER requirements_region
  BEFORE INSERT OR UPDATE OF home_region ON requirements
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  parent_draft_id uuid,
  kind text NOT NULL CHECK (kind IN ('section', 'full_bid')),
  locale text NOT NULL,
  storage_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (job_id, kind, version),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  CHECK (storage_key LIKE tenant_id::text || '/' || home_region || '/%'),
  CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TRIGGER drafts_region
  BEFORE INSERT OR UPDATE OF home_region ON drafts
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE compliance_matrix_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  response_status text NOT NULL CHECK (
    response_status IN ('compliant', 'partial', 'non_compliant', 'not_addressed')
  ),
  draft_id uuid,
  unsupported boolean NOT NULL DEFAULT false,
  missing_evidence boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (requirement_id, tenant_id) REFERENCES requirements (id, tenant_id),
  FOREIGN KEY (draft_id, tenant_id) REFERENCES drafts (id, tenant_id)
);

CREATE TRIGGER compliance_matrix_rows_region
  BEFORE INSERT OR UPDATE OF home_region ON compliance_matrix_rows
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER compliance_matrix_rows_touch
  BEFORE UPDATE ON compliance_matrix_rows
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE draft_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  draft_id uuid NOT NULL,
  job_id uuid NOT NULL,
  body text NOT NULL,
  support_status text NOT NULL CHECK (
    support_status IN ('supported', 'unsupported', 'missing_evidence')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (draft_id, tenant_id) REFERENCES drafts (id, tenant_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER draft_claims_region
  BEFORE INSERT OR UPDATE OF home_region ON draft_claims
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE claim_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  claim_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  quote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (claim_id, tenant_id) REFERENCES draft_claims (id, tenant_id),
  FOREIGN KEY (chunk_id, tenant_id) REFERENCES document_chunks (id, tenant_id)
);

CREATE TRIGGER claim_citations_region
  BEFORE INSERT OR UPDATE OF home_region ON claim_citations
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER claim_citations_append_only
  BEFORE UPDATE OR DELETE ON claim_citations
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE OR REPLACE FUNCTION app.assert_citation_same_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  claim_job uuid;
  chunk_job uuid;
BEGIN
  SELECT job_id INTO claim_job FROM draft_claims WHERE id = NEW.claim_id;
  SELECT job_id INTO chunk_job FROM document_chunks WHERE id = NEW.chunk_id;
  IF claim_job IS DISTINCT FROM chunk_job THEN
    RAISE EXCEPTION 'a citation must point at a chunk from the same job';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER claim_citations_same_job
  BEFORE INSERT ON claim_citations
  FOR EACH ROW EXECUTE FUNCTION app.assert_citation_same_job();

CREATE OR REPLACE FUNCTION app.assert_supported_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.support_status = 'supported' AND NOT EXISTS (
    SELECT 1 FROM claim_citations WHERE claim_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a supported claim requires a citation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER draft_claims_supported
  AFTER INSERT OR UPDATE ON draft_claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.assert_supported_claim();
