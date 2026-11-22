# Schema

The source of truth is `packages/db/migrations`. This page is the map. Apply with `pnpm --filter @orbexa/db migrate` against `DATABASE_URL`. That command was typechecked and not executed against a TCP server in this milestone. The same files were applied and tested on PGlite 0.5.17, which reports PostgreSQL 18.7.

## Identity

`users`, `orgs`, `org_memberships`, `policy_acceptances`. Platform roles only fit a platform org. Expert fits a creator org. Buyer roles fit a buyer org. Time zones are checked with `AT TIME ZONE`.

`expert_profiles` becomes `verified` only with an approved verification and a clear, unexpired `compliance_screenings` row. `jurisdiction_restrictions` is empty.

## Catalogue and service levels

`agents`, `agent_versions`, `listing_tiers`, `listings`, `eval_suites`, `eval_cases`, `eval_runs`. A version pins the route, the embedding model, the prompt hash, the tool hash, and an optional memory snapshot. Publishing rules are in ADR 0003 and ADR 0007.

## Commerce

`orders` snapshot the split, the tax behavior, the buyer country, the creator country, the locale, and the time zone. `fx_quotes` and `tax_quotes` are immutable provider snapshots. `invoices` must match an exclusive order. `payments`, `refunds`, `disputes`, `payout_accounts`, `payout_obligations`, `payouts`, `spend_limits`.

`ledger_transactions` plus `ledger_entries`. Posting requires equal debits and credits, one currency, one region. Lines cannot be updated.

`payout_obligations.order_id` has no foreign key. The obligation is the creator-cell copy of a buyer-cell order and has to survive two databases. Inside one cell, reconciliation is a test, not a constraint.

## Jobs and documents

`jobs`, `job_runs` (includes `workflow_id`), `job_steps`, `job_queue` (the outbox), `job_grants`, `approvals`, `job_budgets`.

`documents` kinds include `tender_source`, `supplier_info`, `evidence`, `bid_docx`, `bid_xlsx`. Storage keys start with `{tenant}/{region}/`.

`document_chunks` are immutable, carry a locator, and generate a `simple` tsvector. `chunk_embeddings` are 1536-dimensional and HNSW-indexed. `source_permissions`, `requirements`, `drafts`, `compliance_matrix_rows`, `draft_claims`, `claim_citations`.

## Memory

`memory_items`, `memory_provenance`, `memory_embeddings`, `memory_snapshots`, `consent_grants`, `lesson_candidates`. See ADR 0003.

## Agent operations

`llm_invocations`, `llm_cache`, `tool_calls`, `prompt_traces`, `retrieval_events`, `run_metrics`, `rate_limit_policies`. Invocations, tool calls, traces, retrieval events, and metrics are append-only. A deferred trigger rejects an invocation that pushes the job over its budget.

## Collaboration and privacy

`job_messages` are append-only and job-scoped. `job_ratings` are one per job, score 1 to 5. `privacy_requests`, `audit_log`, `idempotency_keys`, `retention_policies`.

## Roles

`orbexa_app`, `orbexa_worker`, and `orbexa_finance` are `NOLOGIN`. The app can write tenant data under RLS. The worker cannot read provenance, the ledger, or payments. Finance can read ledger rows only when `app.access` is `finance` for its own buyer, or `platform_finance` for the cell.

## Vertical packs

`verticals` is the category. `vertical_revisions` stores the intake JSON Schema, deliverable types, rubric, and workflow. Orders copy `vertical_code` from the listing. Document kinds other than `evidence` and `expert_credential` must be declared by that vertical. Tender writing is the seeded revision, not a check constraint. See ADR 0009.

## Milestone 4

`app.retrieve_chunks` keeps its signature. `app.lexical_scorer` is `ts_rank_cd` or `bm25`. `app.agent_version_metrics` aggregates `run_metrics` and `llm_invocations`. `app.fulfill_privacy_request` exports or deletes one org in this cell. `app.consume_rate_limit` enforces `rate_limit_policies`.

## Local cell

Migrations do not insert a local region. `migrate --seed-local` inserts `processing_regions('local','active')` and `cell_identity('local','local')`, and only if the host is loopback. The test seeds the same way inside PGlite.
