-- Model calls, tool calls, prompt objects, retrieval audit, and run metrics.
-- Prompt and tool bodies live in the tenant's object store. These rows are
-- the index. They are append-only. Cache identity includes the tenant.

CREATE TABLE llm_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  route_id uuid NOT NULL REFERENCES model_routes (id),
  requested_model text NOT NULL,
  served_model text NOT NULL,
  fallback_used boolean NOT NULL DEFAULT false,
  cache_hit boolean NOT NULL DEFAULT false,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_currency char(3) NOT NULL REFERENCES currencies (code),
  cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id)
);

CREATE TRIGGER llm_invocations_region
  BEFORE INSERT OR UPDATE OF home_region ON llm_invocations
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER llm_invocations_append_only
  BEFORE UPDATE OR DELETE ON llm_invocations
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE OR REPLACE FUNCTION app.assert_job_budget()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  spent bigint;
  cap bigint;
BEGIN
  SELECT limit_minor INTO cap
  FROM job_budgets
  WHERE job_id = NEW.job_id AND currency = NEW.cost_currency;
  IF cap IS NULL THEN
    RAISE EXCEPTION 'job % has no budget in %', NEW.job_id, NEW.cost_currency;
  END IF;
  SELECT COALESCE(sum(cost_minor), 0) INTO spent
  FROM llm_invocations
  WHERE job_id = NEW.job_id AND cost_currency = NEW.cost_currency;
  IF spent > cap THEN
    RAISE EXCEPTION 'job % exceeded its % budget', NEW.job_id, NEW.cost_currency;
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER insert so the new row is included in the sum. A failed statement rolls back.
CREATE CONSTRAINT TRIGGER llm_invocations_budget
  AFTER INSERT ON llm_invocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.assert_job_budget();

CREATE TABLE llm_cache (
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  model text NOT NULL,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  response_storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, model, prompt_hash),
  CHECK (response_storage_key LIKE tenant_id::text || '/' || home_region || '/%'),
  CHECK (expires_at > created_at)
);

COMMENT ON TABLE llm_cache IS
  'Primary key includes tenant_id. Two buyers with the same prompt hash do not share a cache row.';

CREATE TRIGGER llm_cache_region
  BEFORE INSERT OR UPDATE OF home_region ON llm_cache
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  invocation_id uuid NOT NULL REFERENCES llm_invocations (id),
  tool_code text NOT NULL REFERENCES tool_catalog (code),
  args_hash text NOT NULL CHECK (args_hash ~ '^[0-9a-f]{64}$'),
  args_storage_key text NOT NULL,
  result_hash text CHECK (result_hash IS NULL OR result_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id),
  CHECK (args_storage_key LIKE tenant_id::text || '/' || home_region || '/%')
);

CREATE TRIGGER tool_calls_region
  BEFORE INSERT OR UPDATE OF home_region ON tool_calls
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER tool_calls_append_only
  BEFORE UPDATE OR DELETE ON tool_calls
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TABLE prompt_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  invocation_id uuid NOT NULL REFERENCES llm_invocations (id),
  storage_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  instruction_hierarchy text NOT NULL DEFAULT 'system>developer>user>untrusted_document',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id),
  CHECK (storage_key LIKE tenant_id::text || '/' || home_region || '/%')
);

COMMENT ON TABLE prompt_traces IS
  'Index of the prompt object. The object lives in the tenant prefix under SSE-KMS. Trace exporters must not copy it.';

CREATE TRIGGER prompt_traces_region
  BEFORE INSERT OR UPDATE OF home_region ON prompt_traces
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER prompt_traces_append_only
  BEFORE UPDATE OR DELETE ON prompt_traces
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TABLE retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  scope text NOT NULL,
  embedding_model_id uuid REFERENCES embedding_models (id),
  query_hash text NOT NULL CHECK (query_hash ~ '^[0-9a-f]{64}$'),
  result_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id)
);

CREATE TRIGGER retrieval_events_region
  BEFORE INSERT OR UPDATE OF home_region ON retrieval_events
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER retrieval_events_append_only
  BEFORE UPDATE OR DELETE ON retrieval_events
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TABLE run_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  kind text NOT NULL CHECK (kind IN ('final')),
  grounded_claim_rate numeric(6, 4) CHECK (
    grounded_claim_rate IS NULL OR (grounded_claim_rate >= 0 AND grounded_claim_rate <= 1)
  ),
  cost_currency char(3) REFERENCES currencies (code),
  cost_minor bigint CHECK (cost_minor IS NULL OR cost_minor >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id)
);

CREATE TRIGGER run_metrics_region
  BEFORE INSERT OR UPDATE OF home_region ON run_metrics
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER run_metrics_append_only
  BEFORE UPDATE OR DELETE ON run_metrics
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TABLE rate_limit_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  requests_per_minute integer NOT NULL CHECK (requests_per_minute > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TRIGGER rate_limit_policies_region
  BEFORE INSERT OR UPDATE OF home_region ON rate_limit_policies
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs (id),
  user_id uuid REFERENCES users (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  kind text NOT NULL CHECK (kind IN ('access', 'delete', 'export', 'correct', 'restrict')),
  status text NOT NULL CHECK (status IN ('received', 'in_progress', 'completed', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (org_id IS NOT NULL OR user_id IS NOT NULL),
  CHECK (due_at > requested_at)
);

CREATE TRIGGER privacy_requests_region
  BEFORE INSERT OR UPDATE OF home_region ON privacy_requests
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text,
  tenant_id uuid,
  home_region text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, occurred_at);
