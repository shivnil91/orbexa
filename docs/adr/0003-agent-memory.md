# ADR 0003: Four memory domains

- Status: Proposed
- Date: 2026-11-22

## Context

The agent has to remember how Moishin writes tenders, what Rahul uploaded, and what the current run has drafted. Those are different owners. A single embedding index would make a missed `WHERE` clause a cross-buyer leak.

## Decision

`memory_items.scope` is one of:

| Scope | Owner | Tenant column | Lifetime |
| --- | --- | --- | --- |
| `execution` | Buyer org | Buyer org, plus `job_id` and `run_id` | `retain_until`, then purge |
| `buyer_private` | Buyer org | Buyer org. `job_id` set means this job only. Null means the buyer's own library. | Job rows expire. Library rows stay until deletion. |
| `creator_expertise` | Creator org | Creator org. Versioned by `logical_id` and `version`. | Until the creator deletes it. |
| `approved_reusable` | Creator org | **Null.** No source buyer id on the row. | Until consent is revoked. |

Every row has `owner_org_id`, `authority` (`contract`, `owner`, or `consent`), and `provenance_id`. Consent id is required only for `approved_reusable`. Provenance for a buyer-derived lesson lives in `memory_provenance`. The worker role has no `SELECT` on that table. The integration test asserts the permission error.

Retrieval:

- `app.retrieve_chunks` is `SECURITY INVOKER`. It raises if the tenant or job does not match the session, then filters again in SQL. Row-level security still applies, so a query that forgets the predicate returns only the session's chunks. The test covers both.
- `app.retrieve_memory` refuses `execution`. Job-scoped buyer memory is returned only for the current job. Tenant-level buyer memory is returned for that tenant's jobs.
- Citations point at `document_chunks` through `(chunk_id, tenant_id)`. A claim in tenant A cannot cite tenant B's chunk. The test inserts that row as superuser and it fails.
- A `supported` claim without a citation fails a deferred constraint.
- HNSW covers chunk embeddings and the creator/approved subset of memory embeddings. Execution rows cannot be embedded. Buyer-private memory has no ANN index.
- Lexical rank uses `to_tsvector('simple', ...)`. `simple` does not stem one language away. BM25 replaces that expression later.
- Reranking is outside SQL. The function returns candidates.
- `llm_cache` primary key is `(tenant_id, model, prompt_hash)`.

An agent version pins `embedding_model_id`. A new model is a new version plus a re-embed, not an in-place rewrite. Chunks are immutable. Re-chunking inserts new rows. Old citations keep their chunk ids.

Promotion of version 2 or later requires a passing eval on the same suite with a strictly higher score. Version 1 may be `initial_human`. `app.rollback_agent_version` restores only the previous version. The test covers both.

## Alternatives

One `scope` column without a provenance split was requested as "every item carries tenant". Putting the source buyer id on the reusable row would make the lesson a re-identification channel. The tenant lives on the provenance row, which the retriever cannot read. That is the implementation of the rule.

Storing buyer documents only as vectors in a shared index was rejected. The partial HNSW list and the tests are the control.

## Consequences

Cross-buyer leakage through retrieval has to defeat row-level security, the function's tenant check, and the composite foreign key. Application roles are not superuser and not `BYPASSRLS`. The test checks that too. A superuser still bypasses row-level security. Production roles must not be superuser.
