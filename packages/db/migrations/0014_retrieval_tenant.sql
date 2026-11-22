-- Repeat the tenant predicate inside retrieval. Row-level security does not
-- apply to a superuser, and the worker connection may be the migration owner.
-- The function stays invoker-rights. It still does not return document text.

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
  IF app.current_tenant() IS NULL THEN
    RAISE EXCEPTION 'tenant mismatch';
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
      (p_scope = 'approved_reusable' AND items.tenant_id IS NULL)
      OR items.tenant_id = app.current_tenant()
    )
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

COMMENT ON FUNCTION app.retrieve_memory IS
  'Invoker-rights memory search. The tenant predicate is in the function, so a connection that bypasses row-level security still cannot read another tenant. Working memory is not retrievable here.';
