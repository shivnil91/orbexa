-- Row-level security, grants, retrieval functions, and promotion rules.
-- retrieve_* is SECURITY INVOKER: RLS still applies to the caller.
-- A forgotten WHERE in a normal query is not enough to cross a tenant.
-- Composite foreign keys are the guarantee that still holds for a superuser.

ALTER TABLE memory_items
  ADD CONSTRAINT memory_items_job_fk
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id);

ALTER TABLE memory_items
  ADD CONSTRAINT memory_items_run_fk
  FOREIGN KEY (run_id, tenant_id) REFERENCES job_runs (id, tenant_id);

CREATE OR REPLACE FUNCTION app.can_read_job(p_job uuid, p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
  SELECT p_tenant IS NOT NULL
    AND p_tenant = app.current_tenant()
    AND p_job IS NOT NULL
    AND p_job = app.current_job()
    AND (
      app.access_mode() = 'org'
      OR EXISTS (
        SELECT 1
        FROM job_grants AS grant_row
        WHERE grant_row.job_id = p_job
          AND grant_row.tenant_id = p_tenant
          AND grant_row.user_id = app.current_user_id()
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      )
    )
$$;

CREATE OR REPLACE FUNCTION app.job_uses_agent(p_job uuid, p_tenant uuid, p_agent uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jobs AS job
    JOIN agent_versions AS version ON version.id = job.agent_version_id
    WHERE job.id = p_job
      AND job.tenant_id = p_tenant
      AND version.agent_id = p_agent
  )
$$;

CREATE OR REPLACE FUNCTION app.version_visible(p_version uuid, p_tenant uuid, p_job uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agent_versions AS version
    JOIN agents AS agent ON agent.id = version.agent_id
    WHERE version.id = p_version
      AND (
        agent.creator_org_id = p_tenant
        OR version.status = 'published'
        OR (
          p_job IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM jobs AS job
            WHERE job.id = p_job
              AND job.tenant_id = p_tenant
              AND job.agent_version_id = version.id
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app.assert_expert_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status = 'verified' THEN
    IF NOT EXISTS (
      SELECT 1 FROM compliance_screenings AS screening
      WHERE screening.subject_type = 'user'
        AND screening.subject_id = NEW.user_id
        AND screening.purpose = 'expert_verification'
        AND screening.status = 'clear'
        AND screening.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'verified expert requires a clear unexpired screening';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM expert_verifications AS verification
      WHERE verification.expert_user_id = NEW.user_id
        AND verification.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'verified expert requires an approved verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.assert_payout_allowed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  payee_country char(2);
BEGIN
  IF NEW.status NOT IN ('processing', 'paid') THEN
    RETURN NEW;
  END IF;
  SELECT country_code INTO payee_country FROM orgs WHERE id = NEW.payee_org_id;
  IF EXISTS (
    SELECT 1 FROM jurisdiction_restrictions AS restriction
    WHERE restriction.active
      AND restriction.kind IN ('sanctions', 'payout_refused')
      AND restriction.country_code = payee_country
  ) THEN
    RAISE EXCEPTION 'payout country is restricted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance_screenings AS screening
    WHERE screening.subject_type = 'org'
      AND screening.subject_id = NEW.payee_org_id
      AND screening.purpose = 'payout'
      AND screening.status = 'clear'
      AND screening.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'payout requires a clear unexpired screening';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.assert_listing_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM agent_versions AS version
    JOIN agents AS agent ON agent.id = version.agent_id
    WHERE version.id = NEW.agent_version_id
      AND version.status = 'published'
      AND agent.creator_org_id = NEW.creator_org_id
  ) THEN
    RAISE EXCEPTION 'listing requires the creator''s published agent version';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM expert_profiles
    WHERE org_id = NEW.creator_org_id AND status = 'verified'
  ) THEN
    RAISE EXCEPTION 'listing requires a verified expert';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_publish
  BEFORE INSERT OR UPDATE OF status ON listings
  FOR EACH ROW EXECUTE FUNCTION app.assert_listing_publish();

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

CREATE TRIGGER agent_versions_status
  BEFORE INSERT OR UPDATE OF status ON agent_versions
  FOR EACH ROW EXECUTE FUNCTION app.assert_version_status();

CREATE OR REPLACE FUNCTION app.supersede_published_sibling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status = 'published' THEN
    UPDATE agent_versions
    SET status = 'superseded'
    WHERE agent_id = NEW.agent_id
      AND id <> NEW.id
      AND status = 'published';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_versions_supersede
  AFTER INSERT OR UPDATE OF status ON agent_versions
  FOR EACH ROW EXECUTE FUNCTION app.supersede_published_sibling();

CREATE OR REPLACE FUNCTION app.rollback_agent_version(p_version uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  prev uuid;
BEGIN
  PERFORM set_config('app.rollback', '1', true);
  SELECT previous_version_id INTO prev
  FROM agent_versions
  WHERE id = p_version AND status = 'published';
  IF prev IS NULL THEN
    RAISE EXCEPTION 'only the published version with a parent can roll back one step';
  END IF;
  UPDATE agent_versions SET status = 'rolled_back' WHERE id = p_version;
  UPDATE agent_versions
  SET status = 'published'
  WHERE id = prev AND status = 'superseded';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent is not the superseded version';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.retrieve_chunks(
  p_tenant uuid,
  p_job uuid,
  p_model uuid,
  p_query_embedding vector(1536),
  p_query_text text,
  p_limit integer
)
RETURNS TABLE (
  chunk_id uuid,
  score double precision,
  lexical_rank integer,
  semantic_rank integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'limit out of range';
  END IF;
  IF p_tenant IS DISTINCT FROM app.current_tenant() OR p_job IS DISTINCT FROM app.current_job() THEN
    RAISE EXCEPTION 'tenant or job mismatch';
  END IF;
  IF NOT app.can_read_job(p_job, p_tenant) THEN
    RAISE EXCEPTION 'job is not visible';
  END IF;
  RETURN QUERY
  WITH semantic AS (
    SELECT chunks.id AS id,
           row_number() OVER (ORDER BY embeddings.embedding <=> p_query_embedding) AS rnk
    FROM document_chunks AS chunks
    JOIN chunk_embeddings AS embeddings ON embeddings.chunk_id = chunks.id
    WHERE chunks.tenant_id = p_tenant
      AND chunks.job_id = p_job
      AND chunks.deleted_at IS NULL
      AND chunks.active
      AND embeddings.model_id = p_model
  ),
  lexical AS (
    SELECT chunks.id AS id,
           row_number() OVER (
             ORDER BY ts_rank_cd(chunks.search_vector, plainto_tsquery('simple', p_query_text)) DESC
           ) AS rnk
    FROM document_chunks AS chunks
    WHERE chunks.tenant_id = p_tenant
      AND chunks.job_id = p_job
      AND chunks.deleted_at IS NULL
      AND chunks.active
      AND chunks.search_vector @@ plainto_tsquery('simple', p_query_text)
  ),
  fused AS (
    SELECT
      COALESCE(semantic.id, lexical.id) AS id,
      semantic.rnk AS semantic_rank,
      lexical.rnk AS lexical_rank,
      (
        COALESCE(1.0 / (60 + semantic.rnk), 0)
        + COALESCE(1.0 / (60 + lexical.rnk), 0)
      )::double precision AS score
    FROM semantic
    FULL OUTER JOIN lexical ON lexical.id = semantic.id
  )
  SELECT fused.id, fused.score, fused.lexical_rank::integer, fused.semantic_rank::integer
  FROM fused
  WHERE fused.id IS NOT NULL
  ORDER BY fused.score DESC, fused.id
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION app.retrieve_chunks IS
  'Hybrid candidate retrieval. Lexical rank is ts_rank_cd over the simple config, the stand-in for BM25. Reranking happens outside SQL. The function is invoker-rights and repeats the tenant and job predicates.';

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
  ORDER BY embeddings.embedding <=> p_query_embedding
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION app.retrieve_memory IS
  'Invoker-rights memory search. Working memory is not retrievable here and is not embedded. RLS supplies the tenant boundary; this function adds scope, job, agent, and consent.';

-- Policies. Enable RLS before grants so a new privilege cannot see through a missing policy.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
  USING (
    id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM org_memberships AS membership
      WHERE membership.user_id = users.id
        AND membership.org_id = app.current_tenant()
    )
  );

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
CREATE POLICY orgs_isolation ON orgs
  USING (
    id = app.current_tenant()
    OR (kind = 'creator' AND status = 'active')
  );

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY org_memberships_isolation ON org_memberships
  USING (org_id = app.current_tenant())
  WITH CHECK (org_id = app.current_tenant());

ALTER TABLE job_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY job_grants_isolation ON job_grants
  USING (
    tenant_id = app.current_tenant()
    AND (app.access_mode() = 'org' OR user_id = app.current_user_id())
  )
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_isolation ON jobs
  USING (
    tenant_id = app.current_tenant()
    AND (
      app.access_mode() = 'org'
      OR EXISTS (
        SELECT 1 FROM job_grants AS grant_row
        WHERE grant_row.job_id = jobs.id
          AND grant_row.tenant_id = jobs.tenant_id
          AND grant_row.user_id = app.current_user_id()
          AND grant_row.revoked_at IS NULL
      )
    )
  )
  WITH CHECK (tenant_id = app.current_tenant() AND app.access_mode() = 'org');

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY job_runs_isolation ON job_runs
  USING (app.can_read_job(job_id, tenant_id) OR (
    tenant_id = app.current_tenant() AND app.access_mode() = 'org' AND job_id IN (
      SELECT id FROM jobs
    )
  ))
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON documents
  USING (
    tenant_id = app.current_tenant()
    AND (job_id IS NULL OR app.can_read_job(job_id, tenant_id))
  )
  WITH CHECK (
    tenant_id = app.current_tenant()
    AND (job_id IS NULL OR app.can_read_job(job_id, tenant_id))
  );

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY document_chunks_isolation ON document_chunks
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY chunk_embeddings_isolation ON chunk_embeddings
  USING (
    tenant_id = app.current_tenant()
    AND EXISTS (
      SELECT 1 FROM document_chunks AS chunks
      WHERE chunks.id = chunk_embeddings.chunk_id
        AND chunks.tenant_id = chunk_embeddings.tenant_id
    )
  )
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE source_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY source_permissions_isolation ON source_permissions
  USING (tenant_id = app.current_tenant() AND app.access_mode() IN ('org', 'grant'))
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY requirements_isolation ON requirements
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY drafts_isolation ON drafts
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE compliance_matrix_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_matrix_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_matrix_rows_isolation ON compliance_matrix_rows
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE draft_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_claims_isolation ON draft_claims
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE claim_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_citations FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_citations_isolation ON claim_citations
  USING (
    tenant_id = app.current_tenant()
    AND EXISTS (
      SELECT 1 FROM draft_claims AS claim
      WHERE claim.id = claim_citations.claim_id
        AND claim.tenant_id = claim_citations.tenant_id
    )
  )
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_isolation ON orders
  USING (buyer_org_id = app.current_tenant() AND app.access_mode() = 'org')
  WITH CHECK (buyer_org_id = app.current_tenant() AND app.access_mode() = 'org');

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_isolation ON invoices
  USING (buyer_org_id = app.current_tenant() AND app.access_mode() IN ('org', 'finance'))
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_isolation ON payments
  USING (buyer_org_id = app.current_tenant() AND app.access_mode() IN ('org', 'finance'))
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY refunds_isolation ON refunds
  USING (buyer_org_id = app.current_tenant() AND app.access_mode() = 'finance')
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE ROW LEVEL SECURITY;
CREATE POLICY disputes_isolation ON disputes
  USING (buyer_org_id = app.current_tenant() AND app.access_mode() = 'finance')
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE spend_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE spend_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY spend_limits_isolation ON spend_limits
  USING (buyer_org_id = app.current_tenant())
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE tax_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_quotes_isolation ON tax_quotes
  USING (buyer_org_id = app.current_tenant())
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_transactions_isolation ON ledger_transactions
  USING (
    (app.access_mode() = 'finance' AND buyer_org_id = app.current_tenant())
    OR app.access_mode() = 'platform_finance'
  );

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_isolation ON ledger_entries
  USING (
    (app.access_mode() = 'finance' AND buyer_org_id = app.current_tenant())
    OR app.access_mode() = 'platform_finance'
  );

ALTER TABLE payout_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY payout_obligations_isolation ON payout_obligations
  USING (
    app.access_mode() = 'finance'
    AND payee_org_id = app.current_tenant()
  )
  WITH CHECK (payee_org_id = app.current_tenant());

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY payouts_isolation ON payouts
  USING (app.access_mode() = 'finance' AND payee_org_id = app.current_tenant())
  WITH CHECK (payee_org_id = app.current_tenant());

ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY payout_accounts_isolation ON payout_accounts
  USING (org_id = app.current_tenant())
  WITH CHECK (org_id = app.current_tenant());

ALTER TABLE memory_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_provenance FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_provenance_isolation ON memory_provenance
  USING (tenant_id = app.current_tenant() AND app.access_mode() = 'org')
  WITH CHECK (tenant_id = app.current_tenant() AND app.access_mode() = 'org');

ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items FORCE ROW LEVEL SECURITY;
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
      )
    )
  );

CREATE POLICY memory_items_write ON memory_items
  FOR INSERT
  WITH CHECK (
    (
      scope = 'execution'
      AND tenant_id = app.current_tenant()
      AND owner_org_id = tenant_id
      AND app.can_read_job(job_id, tenant_id)
    )
    OR (
      scope = 'buyer_private'
      AND tenant_id = app.current_tenant()
      AND owner_org_id = tenant_id
      AND (
        (job_id IS NULL AND app.access_mode() = 'org')
        OR app.can_read_job(job_id, tenant_id)
      )
    )
    OR (
      scope = 'creator_expertise'
      AND tenant_id = app.current_tenant()
      AND owner_org_id = tenant_id
    )
    OR (
      scope = 'approved_reusable'
      AND tenant_id IS NULL
      AND owner_org_id = app.current_tenant()
      AND authority = 'consent'
    )
  );

CREATE POLICY memory_items_update ON memory_items
  FOR UPDATE
  USING (tenant_id = app.current_tenant() OR owner_org_id = app.current_tenant())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM app.current_tenant() OR owner_org_id = app.current_tenant());

ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_embeddings_isolation ON memory_embeddings
  USING (
    EXISTS (
      SELECT 1 FROM memory_items AS item
      WHERE item.id = memory_embeddings.memory_item_id
    )
  )
  WITH CHECK (
    scope <> 'approved_reusable' AND tenant_id = app.current_tenant()
    OR scope = 'approved_reusable' AND tenant_id IS NULL
  );

ALTER TABLE consent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_grants_isolation ON consent_grants
  USING (buyer_org_id = app.current_tenant())
  WITH CHECK (buyer_org_id = app.current_tenant());

ALTER TABLE lesson_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_candidates_isolation ON lesson_candidates
  USING (tenant_id = app.current_tenant() AND app.can_read_job(source_job_id, tenant_id))
  WITH CHECK (tenant_id = app.current_tenant() AND app.can_read_job(source_job_id, tenant_id));

ALTER TABLE llm_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_invocations FORCE ROW LEVEL SECURITY;
CREATE POLICY llm_invocations_isolation ON llm_invocations
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE llm_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY llm_cache_isolation ON llm_cache
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY tool_calls_isolation ON tool_calls
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE prompt_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_traces FORCE ROW LEVEL SECURITY;
CREATE POLICY prompt_traces_isolation ON prompt_traces
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE retrieval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_events FORCE ROW LEVEL SECURITY;
CREATE POLICY retrieval_events_isolation ON retrieval_events
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE run_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY run_metrics_isolation ON run_metrics
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE job_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY job_budgets_isolation ON job_budgets
  USING (tenant_id = app.current_tenant() AND app.access_mode() IN ('org', 'finance'))
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY approvals_isolation ON approvals
  USING (app.can_read_job(job_id, tenant_id) OR (
    tenant_id = app.current_tenant() AND app.access_mode() = 'org'
  ))
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY job_queue_isolation ON job_queue
  USING (tenant_id = app.current_tenant() AND app.access_mode() = 'org')
  WITH CHECK (tenant_id = app.current_tenant() AND app.access_mode() = 'org');

ALTER TABLE job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY job_steps_isolation ON job_steps
  USING (
    EXISTS (
      SELECT 1 FROM job_runs AS run
      WHERE run.id = job_steps.run_id
        AND run.tenant_id = job_steps.tenant_id
        AND (
          app.can_read_job(run.job_id, run.tenant_id)
          OR (run.tenant_id = app.current_tenant() AND app.access_mode() = 'org')
        )
    )
  )
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE compliance_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_screenings FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_screenings_isolation ON compliance_screenings
  USING (
    (subject_type = 'user' AND subject_id = app.current_user_id())
    OR (subject_type = 'org' AND subject_id = app.current_tenant())
    OR app.access_mode() = 'platform_finance'
  )
  WITH CHECK (
    app.access_mode() = 'platform_finance'
    OR (subject_type = 'org' AND subject_id = app.current_tenant())
  );

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_requests_isolation ON privacy_requests
  USING (
    org_id = app.current_tenant()
    OR user_id = app.current_user_id()
  )
  WITH CHECK (
    org_id = app.current_tenant()
    OR user_id = app.current_user_id()
  );

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON audit_log
  FOR SELECT
  USING (tenant_id = app.current_tenant() AND app.access_mode() IN ('org', 'finance', 'platform_finance'));
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
CREATE POLICY agents_isolation ON agents
  USING (
    creator_org_id = app.current_tenant()
    OR status = 'published'
    OR app.job_uses_agent(app.current_job(), app.current_tenant(), id)
  );

ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_versions_isolation ON agent_versions
  USING (app.version_visible(id, app.current_tenant(), app.current_job()));

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings FORCE ROW LEVEL SECURITY;
CREATE POLICY listings_isolation ON listings
  USING (status = 'published' OR creator_org_id = app.current_tenant());

ALTER TABLE rate_limit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_policies_isolation ON rate_limit_policies
  USING (org_id = app.current_tenant())
  WITH CHECK (org_id = app.current_tenant());

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT SELECT ON
  processing_regions, cell_identity, currencies, verticals, embedding_models,
  model_routes, tool_catalog, retention_policies, fx_quotes
  TO orbexa_app, orbexa_worker, orbexa_finance;

GRANT SELECT, INSERT, UPDATE ON
  users, orgs, org_memberships, policy_acceptances, expert_profiles, expert_verifications,
  agents, agent_versions, agent_version_tools, memory_snapshots, memory_snapshot_items,
  listings, listing_tiers, jobs, job_runs, job_steps, job_queue, job_grants, approvals,
  documents, document_chunks, chunk_embeddings, source_permissions, requirements, drafts,
  compliance_matrix_rows, draft_claims, claim_citations, memory_items, memory_embeddings,
  consent_grants, lesson_candidates, orders, tax_quotes, tax_lines, invoices, payments,
  payout_accounts, payout_obligations, spend_limits, job_budgets, privacy_requests,
  rate_limit_policies, eval_suites, eval_cases
  TO orbexa_app;

GRANT SELECT ON eval_runs, memory_provenance TO orbexa_app;
GRANT INSERT ON eval_runs, memory_provenance TO orbexa_app;

GRANT SELECT, INSERT ON
  llm_invocations, llm_cache, tool_calls, prompt_traces, retrieval_events, run_metrics,
  audit_log, idempotency_keys, compliance_screenings, refunds, disputes, payouts,
  ledger_transactions
  TO orbexa_app;
GRANT SELECT ON ledger_entries TO orbexa_app;
GRANT INSERT ON ledger_entries TO orbexa_app;

GRANT SELECT, INSERT, UPDATE ON
  jobs, job_runs, job_steps, job_queue, requirements, compliance_matrix_rows, drafts,
  draft_claims, claim_citations, document_chunks, documents, memory_items, memory_embeddings,
  source_permissions, run_metrics
  TO orbexa_worker;
GRANT SELECT ON
  agents, agent_versions, listings, listing_tiers, embedding_models, model_routes,
  tool_catalog, job_budgets, chunk_embeddings
  TO orbexa_worker;
GRANT SELECT, INSERT ON chunk_embeddings, llm_invocations, llm_cache, tool_calls,
  prompt_traces, retrieval_events, audit_log
  TO orbexa_worker;

GRANT SELECT ON
  ledger_transactions, ledger_entries, invoices, payments, refunds, disputes, payouts,
  payout_obligations, orders
  TO orbexa_finance;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.retrieve_chunks(uuid, uuid, uuid, vector, text, integer)
  TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.retrieve_memory(text, uuid, uuid, vector, integer)
  TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.rollback_agent_version(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.purge_expired_memory() TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.can_read_job(uuid, uuid) TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.job_uses_agent(uuid, uuid, uuid) TO orbexa_app, orbexa_worker;
GRANT EXECUTE ON FUNCTION app.version_visible(uuid, uuid, uuid) TO orbexa_app, orbexa_worker;
REVOKE ALL ON FUNCTION app.job_uses_agent(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.version_visible(uuid, uuid, uuid) FROM PUBLIC;
