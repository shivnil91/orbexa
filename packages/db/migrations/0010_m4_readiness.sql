-- Milestone 4. Retrieval can swap the lexical scorer without changing
-- app.retrieve_chunks's signature. Privacy export and delete run in this
-- cell only. Rate-limit events back the per-org policy. The dashboard view
-- reads run_metrics and llm_invocations.

CREATE OR REPLACE FUNCTION app.tokenize(p_text text)
RETURNS TABLE (lexeme text)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT token AS lexeme
  FROM regexp_split_to_table(lower(coalesce(p_text, '')), '[^[:alnum:]]+') AS token
  WHERE token <> '';
$$;

COMMENT ON FUNCTION app.tokenize IS
  'Lowercase alphanumeric tokens for the in-database BM25 scorer. ParadeDB is not in the pgvector image, so BM25 lives here.';

-- Okapi BM25 over the active chunks of one job. k1 = 1.2, b = 0.75.
-- IDF uses ln(1 + (N - df + 0.5) / (df + 0.5)), which stays non-negative.
CREATE OR REPLACE FUNCTION app.bm25_job_score(
  p_chunk uuid,
  p_query text,
  p_tenant uuid,
  p_job uuid
)
RETURNS double precision
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  WITH docs AS (
    SELECT id, body,
           (SELECT count(*) FROM app.tokenize(document_chunks.body))::double precision AS len
    FROM document_chunks
    WHERE tenant_id = p_tenant
      AND job_id = p_job
      AND deleted_at IS NULL
      AND active
  ),
  stats AS (
    SELECT count(*)::double precision AS n_docs,
           COALESCE(avg(len), 0)::double precision AS avg_len
    FROM docs
  ),
  query_terms AS (
    SELECT DISTINCT lexeme FROM app.tokenize(p_query)
  ),
  doc_tf AS (
    SELECT lexeme, count(*)::double precision AS tf
    FROM app.tokenize((SELECT body FROM document_chunks WHERE id = p_chunk))
    GROUP BY lexeme
  ),
  df AS (
    SELECT query_terms.lexeme, count(DISTINCT docs.id)::double precision AS df
    FROM query_terms
    JOIN docs ON EXISTS (
      SELECT 1
      FROM app.tokenize(docs.body) AS token
      WHERE token.lexeme = query_terms.lexeme
    )
    GROUP BY query_terms.lexeme
  ),
  target AS (
    SELECT len FROM docs WHERE id = p_chunk
  )
  SELECT COALESCE(sum(
    ln(1.0 + (stats.n_docs - df.df + 0.5) / (df.df + 0.5))
    * (doc_tf.tf * 2.2)
    / (doc_tf.tf + 1.2 * (1.0 - 0.75 + 0.75 * target.len / stats.avg_len))
  ), 0)::double precision
  FROM query_terms
  JOIN doc_tf ON doc_tf.lexeme = query_terms.lexeme
  JOIN df ON df.lexeme = query_terms.lexeme
  CROSS JOIN stats
  CROSS JOIN target
  WHERE stats.n_docs > 0 AND stats.avg_len > 0 AND doc_tf.tf > 0;
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
DECLARE
  scorer text;
BEGIN
  scorer := COALESCE(NULLIF(current_setting('app.lexical_scorer', true), ''), 'ts_rank_cd');
  IF scorer NOT IN ('ts_rank_cd', 'bm25') THEN
    RAISE EXCEPTION 'unknown lexical scorer %', scorer;
  END IF;
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
  lexical_scored AS (
    SELECT chunks.id AS id,
           CASE
             WHEN scorer = 'bm25' THEN app.bm25_job_score(chunks.id, p_query_text, p_tenant, p_job)
             ELSE ts_rank_cd(chunks.search_vector, plainto_tsquery('simple', p_query_text))
           END AS lex_score
    FROM document_chunks AS chunks
    WHERE chunks.tenant_id = p_tenant
      AND chunks.job_id = p_job
      AND chunks.deleted_at IS NULL
      AND chunks.active
      AND (
        CASE
          WHEN scorer = 'bm25' THEN app.bm25_job_score(chunks.id, p_query_text, p_tenant, p_job) > 0
          ELSE chunks.search_vector @@ plainto_tsquery('simple', p_query_text)
        END
      )
  ),
  lexical AS (
    SELECT lexical_scored.id AS id,
           row_number() OVER (ORDER BY lexical_scored.lex_score DESC, lexical_scored.id) AS rnk
    FROM lexical_scored
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
  'Hybrid candidate retrieval. The signature is unchanged. app.lexical_scorer selects ts_rank_cd (default) or bm25. A reranker, when applied, reorders candidates outside SQL.';

CREATE TABLE rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rate_limit_events_window_idx ON rate_limit_events (org_id, occurred_at DESC);

CREATE TRIGGER rate_limit_events_region
  BEFORE INSERT OR UPDATE OF home_region ON rate_limit_events
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_events_isolation ON rate_limit_events
  USING (org_id = app.current_tenant())
  WITH CHECK (org_id = app.current_tenant());

-- No active policy means this function does not count. A policy stops the
-- next call once the last minute already holds requests_per_minute events.
CREATE OR REPLACE FUNCTION app.consume_rate_limit(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  cap integer;
  used integer;
  cell text;
BEGIN
  SELECT requests_per_minute INTO cap
  FROM rate_limit_policies
  WHERE org_id = p_org AND active;
  IF cap IS NULL THEN
    RETURN 0;
  END IF;
  SELECT count(*)::integer INTO used
  FROM rate_limit_events
  WHERE org_id = p_org
    AND occurred_at > now() - interval '1 minute';
  IF used >= cap THEN
    RAISE EXCEPTION 'org % exceeded its rate limit', p_org;
  END IF;
  SELECT region INTO cell FROM cell_identity;
  INSERT INTO rate_limit_events (org_id, home_region) VALUES (p_org, cell);
  RETURN used + 1;
END;
$$;

CREATE OR REPLACE VIEW app.agent_version_metrics
WITH (security_invoker = true) AS
WITH metrics AS (
  SELECT agent_version_id,
         cost_currency,
         avg(grounded_claim_rate)::double precision AS grounded_claim_rate,
         avg(latency_ms)::double precision AS latency_ms,
         avg(cost_minor)::double precision AS cost_per_job_minor,
         count(DISTINCT job_id)::integer AS job_count
  FROM run_metrics
  WHERE kind = 'final'
  GROUP BY agent_version_id, cost_currency
),
revisions AS (
  SELECT per_job.agent_version_id,
         avg(CASE WHEN per_job.draft_count > 1 THEN 1.0 ELSE 0.0 END)::double precision AS revision_rate
  FROM (
    SELECT jobs.id, jobs.agent_version_id, count(drafts.id)::integer AS draft_count
    FROM jobs
    JOIN run_metrics
      ON run_metrics.job_id = jobs.id
     AND run_metrics.kind = 'final'
    LEFT JOIN drafts ON drafts.job_id = jobs.id
    GROUP BY jobs.id, jobs.agent_version_id
  ) AS per_job
  GROUP BY per_job.agent_version_id
),
invocation_cost AS (
  SELECT jobs.agent_version_id,
         spent.cost_currency,
         avg(spent.total_minor)::double precision AS invocation_cost_minor
  FROM (
    SELECT job_id, cost_currency, sum(cost_minor)::double precision AS total_minor
    FROM llm_invocations
    GROUP BY job_id, cost_currency
  ) AS spent
  JOIN jobs ON jobs.id = spent.job_id
  GROUP BY jobs.agent_version_id, spent.cost_currency
)
SELECT metrics.agent_version_id,
       metrics.cost_currency,
       metrics.grounded_claim_rate,
       metrics.latency_ms,
       metrics.cost_per_job_minor,
       invocation_cost.invocation_cost_minor,
       revisions.revision_rate,
       metrics.job_count
FROM metrics
LEFT JOIN revisions ON revisions.agent_version_id = metrics.agent_version_id
LEFT JOIN invocation_cost
  ON invocation_cost.agent_version_id = metrics.agent_version_id
 AND invocation_cost.cost_currency IS NOT DISTINCT FROM metrics.cost_currency;

COMMENT ON VIEW app.agent_version_metrics IS
  'Dashboard aggregates by agent version and currency. Grounded-claim rate, latency, and cost per job come from run_metrics. Invocation cost is the mean per-job sum of llm_invocations. Revision rate is the share of those jobs with more than one draft.';

-- Privacy redaction is the only update allowed on otherwise immutable text.
-- Amounts, ids, and account codes on the ledger stay put.

CREATE OR REPLACE FUNCTION app.chunks_are_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF current_setting('app.privacy_redact', true) = '1'
     AND NEW.body = '[redacted]'
     AND NEW.page IS NOT DISTINCT FROM OLD.page
     AND NEW.sheet IS NOT DISTINCT FROM OLD.sheet
     AND NEW.cell_range IS NOT DISTINCT FROM OLD.cell_range
     AND NEW.paragraph_path IS NOT DISTINCT FROM OLD.paragraph_path
     AND NEW.locator_kind IS NOT DISTINCT FROM OLD.locator_kind
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.chunk_index IS NOT DISTINCT FROM OLD.chunk_index
     AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id
  THEN
    RETURN NEW;
  END IF;
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
  IF current_setting('app.privacy_redact', true) = '1' AND NEW.body = '[redacted]' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'memory body is immutable outside purge';
END;
$$;

CREATE OR REPLACE FUNCTION app.ledger_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_entries is append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.privacy_redact', true) = '1'
     AND NEW.memo = '[redacted]'
     AND NEW.amount_minor IS NOT DISTINCT FROM OLD.amount_minor
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.account_code IS NOT DISTINCT FROM OLD.account_code
     AND NEW.direction IS NOT DISTINCT FROM OLD.direction
     AND NEW.transaction_id IS NOT DISTINCT FROM OLD.transaction_id
     AND NEW.buyer_org_id IS NOT DISTINCT FROM OLD.buyer_org_id
     AND NEW.home_region IS NOT DISTINCT FROM OLD.home_region
     AND NEW.counterparty_org_id IS NOT DISTINCT FROM OLD.counterparty_org_id
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger_entries is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.ledger_entries_guard();

CREATE OR REPLACE FUNCTION app.claim_citations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'claim_citations is append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.privacy_redact', true) = '1'
     AND NEW.quote = '[redacted]'
     AND NEW.claim_id IS NOT DISTINCT FROM OLD.claim_id
     AND NEW.chunk_id IS NOT DISTINCT FROM OLD.chunk_id
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.home_region IS NOT DISTINCT FROM OLD.home_region
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'claim_citations is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER claim_citations_append_only ON claim_citations;
CREATE TRIGGER claim_citations_append_only
  BEFORE UPDATE OR DELETE ON claim_citations
  FOR EACH ROW EXECUTE FUNCTION app.claim_citations_guard();

CREATE OR REPLACE FUNCTION app.job_messages_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_messages is append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.privacy_redact', true) = '1'
     AND NEW.body = '[redacted]'
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id
     AND NEW.author_user_id IS NOT DISTINCT FROM OLD.author_user_id
     AND NEW.home_region IS NOT DISTINCT FROM OLD.home_region
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'job_messages is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER job_messages_append_only ON job_messages;
CREATE TRIGGER job_messages_append_only
  BEFORE UPDATE OR DELETE ON job_messages
  FOR EACH ROW EXECUTE FUNCTION app.job_messages_guard();

CREATE OR REPLACE FUNCTION app.export_org(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'org is required';
  END IF;
  SELECT jsonb_build_object(
    'org_id', p_org,
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'filename', documents.filename,
        'storage_key', documents.storage_key,
        'chunks', COALESCE((
          SELECT jsonb_agg(chunks.body ORDER BY chunks.chunk_index)
          FROM document_chunks AS chunks
          WHERE chunks.document_id = documents.id
        ), '[]'::jsonb)
      ))
      FROM documents
      WHERE documents.tenant_id = p_org
    ), '[]'::jsonb),
    'memory', COALESCE((
      SELECT jsonb_agg(body ORDER BY created_at)
      FROM memory_items
      WHERE tenant_id = p_org OR provenance_id IN (
        SELECT id FROM memory_provenance WHERE tenant_id = p_org
      )
    ), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'charge_amount_minor', charge_amount_minor,
        'currency', charge_currency
      ))
      FROM orders
      WHERE buyer_org_id = p_org
    ), '[]'::jsonb),
    'ledger', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'amount_minor', entries.amount_minor,
        'currency', entries.currency,
        'account_code', entries.account_code,
        'memo', entries.memo
      ))
      FROM ledger_entries AS entries
      WHERE entries.buyer_org_id = p_org
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION app.redact_org(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  keys jsonb;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'org is required';
  END IF;
  PERFORM set_config('app.privacy_redact', '1', true);
  SELECT COALESCE(jsonb_agg(DISTINCT storage_key), '[]'::jsonb) INTO keys
  FROM (
    SELECT storage_key FROM documents WHERE tenant_id = p_org
    UNION
    SELECT storage_key FROM drafts WHERE tenant_id = p_org
    UNION
    SELECT response_storage_key FROM llm_cache WHERE tenant_id = p_org
    UNION
    SELECT storage_key FROM prompt_traces WHERE tenant_id = p_org
    UNION
    SELECT args_storage_key FROM tool_calls WHERE tenant_id = p_org
  ) AS collected;

  UPDATE document_chunks
  SET body = '[redacted]',
      active = false,
      deleted_at = COALESCE(deleted_at, now())
  WHERE tenant_id = p_org
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE documents
  SET filename = 'redacted.bin',
      byte_size = 10,
      sha256 = '017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d'
  WHERE tenant_id = p_org;

  UPDATE memory_items
  SET body = '[redacted]',
      deleted_at = COALESCE(deleted_at, now())
  WHERE tenant_id = p_org
    AND scope IN ('execution', 'buyer_private')
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE memory_items
  SET body = '[redacted]',
      status = 'revoked',
      consent_revoked_at = COALESCE(consent_revoked_at, now()),
      deleted_at = COALESCE(deleted_at, now())
  WHERE scope = 'approved_reusable'
    AND provenance_id IN (SELECT id FROM memory_provenance WHERE tenant_id = p_org)
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE lesson_candidates
  SET proposed_text = '[redacted]',
      status = 'revoked',
      decided_at = COALESCE(decided_at, now())
  WHERE tenant_id = p_org
    AND proposed_text IS DISTINCT FROM '[redacted]';

  UPDATE requirements
  SET body = '[redacted]'
  WHERE tenant_id = p_org
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE draft_claims
  SET body = '[redacted]'
  WHERE tenant_id = p_org
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE claim_citations
  SET quote = '[redacted]'
  WHERE tenant_id = p_org
    AND quote IS DISTINCT FROM '[redacted]';

  UPDATE job_messages
  SET body = '[redacted]'
  WHERE tenant_id = p_org
    AND body IS DISTINCT FROM '[redacted]';

  UPDATE job_ratings
  SET comment = '[redacted]'
  WHERE tenant_id = p_org
    AND comment IS DISTINCT FROM '[redacted]';

  UPDATE ledger_entries
  SET memo = '[redacted]'
  WHERE buyer_org_id = p_org
    AND memo IS NOT NULL
    AND memo IS DISTINCT FROM '[redacted]';

  RETURN keys;
END;
$$;

CREATE OR REPLACE FUNCTION app.fulfill_privacy_request(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  req privacy_requests%ROWTYPE;
  exported jsonb;
BEGIN
  SELECT * INTO req FROM privacy_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy request not found';
  END IF;
  IF req.org_id IS NULL THEN
    RAISE EXCEPTION 'privacy request needs an org';
  END IF;
  IF req.status = 'completed' THEN
    RAISE EXCEPTION 'privacy request is already completed';
  END IF;
  IF app.current_tenant() IS NOT NULL AND app.current_tenant() IS DISTINCT FROM req.org_id THEN
    RAISE EXCEPTION 'privacy request is outside the session tenant';
  END IF;
  IF req.kind = 'export' THEN
    exported := app.export_org(req.org_id);
  ELSIF req.kind = 'delete' THEN
    PERFORM app.redact_org(req.org_id);
    exported := app.export_org(req.org_id);
  ELSE
    RAISE EXCEPTION 'privacy kind % is not processed by this cell drill', req.kind;
  END IF;
  UPDATE privacy_requests
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_request;
  INSERT INTO audit_log (actor_role, tenant_id, home_region, action, resource_type, resource_id, metadata)
  VALUES (
    'privacy',
    req.org_id,
    req.home_region,
    'privacy_' || req.kind,
    'privacy_requests',
    req.id,
    jsonb_build_object('kind', req.kind)
  );
  RETURN exported;
END;
$$;

COMMENT ON FUNCTION app.fulfill_privacy_request IS
  'Export or delete for one org in this cell. Delete redacts buyer-private text and leaves ledger amounts. It does not reach another cell. access, correct, and restrict are recorded and not processed here.';

REVOKE ALL ON FUNCTION app.export_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.redact_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fulfill_privacy_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.export_org(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.redact_org(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.fulfill_privacy_request(uuid) TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.consume_rate_limit(uuid) TO orbexa_app, orbexa_worker;
GRANT SELECT, INSERT ON rate_limit_events TO orbexa_app, orbexa_worker;
GRANT SELECT ON app.agent_version_metrics TO orbexa_app, orbexa_finance;
