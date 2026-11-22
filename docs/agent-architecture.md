# Agent architecture

This is the design for the tender agent. Milestone 1 ships the schema, the retrieval functions, the eval gate, and a LangGraph skeleton with no model call. Milestone 2 runs Rahul's hospital-bed job on top of it. Milestone 3 turns the learning loop on. Milestone 4 adds the dashboards and the release tests.

## Pipeline

The activity graph is fixed:

1. **Extract.** Requirements and evaluation criteria, each pointing at a chunk locator (page, paragraph path, or sheet cell range).
2. **Matrix.** One row per requirement: compliant, partial, non-compliant, or not addressed. Missing supplier evidence is a first-class flag.
3. **Draft.** Prose that may only rely on chunks whose `source_permissions` allow quote or paraphrase.
4. **Ground.** Every claim is `supported` with a citation, `unsupported`, or `missing_evidence`. The agent does not invent certifications, capacities, specifications, or evidence. A hospital tender that asks for a regulatory certificate the supplier pack does not contain stays `missing_evidence`.

Document text is wrapped in `<untrusted_document>` and is not allowed to add a node or skip grounding. `workers/ai/tests/test_pipeline.py` feeds a hostile string and asserts the stage list is unchanged. The instruction order is system, then developer, then the user, then the fenced document.

Tools on the tender version are `read_chunk`, `write_artifact`, and `flag_claim`. All three are in `tool_catalog` with `side_effect = false` because they only touch the current job through our API. A side-effect tool cannot be attached. There is no shell and no HTTP tool.

## Memory

See ADR 0003. Operationally:

- **Execution** is scratch for one run. It is purged. It is not embedded and it cannot be cited.
- **Buyer-private** is Rahul's tenders and supplier library. Job-scoped rows are invisible to his other jobs. Nothing in this domain is visible to another buyer. The tests cover both.
- **Creator expertise** is Moishin's method, versioned, readable in a creator session, not in Rahul's session.
- **Approved reusable intelligence** is a scrubbed lesson. It requires consent, a clear PII scan, a clear confidentiality scan, and a clear IP status. Revoking the consent marks the lesson revoked. The worker cannot see which buyer it came from.

The buyer session reads chunks and buyer-private memory. The creator session reads creator expertise. The activity may place creator text into the buyer prompt trace. That trace is buyer data in the buyer prefix. It is not written back as buyer-private memory of another tenant.

## Retrieval and citations

`app.retrieve_chunks(tenant, job, model, embedding, text, limit)`:

- Rejects a tenant or job that does not match the session.
- Ranks by cosine distance on the pinned embedding model.
- Ranks by `ts_rank_cd` over the `simple` text search configuration.
- Fuses the two with reciprocal rank fusion, constant 60.
- Returns candidates. A reranker, when one is contracted, reorders those candidates outside SQL. Milestone 2 may ship without a reranker and still cite the fused list.

Chunking, when the parser lands in task 14:

- PDF: reading-order blocks, page number on every chunk, tables as `kind = table` with a cell range.
- DOCX: headings form `paragraph_path`. Tables are not split away from their header.
- XLSX: one chunk per sheet region, locator `sheet` plus `cell_range`. Formulas are not evaluated.
- Prose chunks may overlap. Table chunks do not, so a citation is not duplicated.
- A new chunker version inserts rows. It does not edit old ones. `documents.chunker_version` selects the active set.

Embeddings: `embedding_models.dims` is 1536 for the first column. Another dimension is a new table, not an `ALTER` of buyer data. Re-embedding writes new `chunk_embeddings` rows for the pinned model on a new agent version, after an eval, with rollback returning to the previous model id.

## Learning loop

After a terminal job, Milestone 3 may:

1. Record `run_metrics` (grounded-claim rate, latency, cost).
2. Collect the buyer's rating and revision count.
3. Propose `lesson_candidates` from the run.
4. Classify each candidate against `source_permissions` and the buyer's consent. Default is no reuse.
5. Drop anything that still contains buyer identifiers, prices, or certificate numbers.
6. Add the survivor to a versioned eval set only if it is synthetic or licensed. Customer tenders are not golden cases.
7. Reject the candidate if the eval does not improve.
8. Ask the creator to approve.
9. Publish a new agent version pinned to a memory snapshot.
10. Keep the previous version one rollback away.

There is no fine-tuning API in this design. The OpenAI pricing page fetched on 2026-11-22 says fine-tuning is closed to new users in any case. We would not use it for buyer text even if it were open.

## Model gateway

An in-process gateway, not a fourth network service:

- Routes through `model_routes.primary_model`, then `fallback_model` on a provider error.
- Cache key includes `tenant_id`. The test inserts the same prompt hash for two buyers and shows each session one row.
- Refuses the call when the sum of `llm_invocations.cost_minor` would pass `job_budgets`.
- Writes an append-only invocation row: model requested, model served, tokens, cost, latency, prompt hash.
- Rate limits come from `rate_limit_policies` per org.

No provider key exists. Prod refuses a live call until one is provisioned in the worker secret. Local tests use the skeleton, which does not call a network.

## Safety and observability

- Human gates: expert review for two of the three service levels, creator approval before a version after the first, consent before a reusable lesson.
- Uploads sit at `malware_scan_status = pending` until a scanner marks them `clean`. GuardDuty malware protection for S3 is the intended scanner. It is not enabled, because AWS is not connected.
- Audit rows and ledger lines are append-only.
- Traces use OpenTelemetry. Dashboards are Milestone 4. The query surface is `run_metrics` plus `llm_invocations`, grouped by `agent_version_id`.
- Quality signals to track once jobs exist: grounded-claim rate, latency, inference cost per job, revision rate, repeat purchases, and creator earnings. None of those have production numbers. The schema can store the first three. Repeat purchases and earnings are queries on `orders` and `payout_obligations`.

## What is in this milestone

| In the repository now | Later |
| --- | --- |
| Four scopes, RLS, provenance grants, cache key | UI for memory |
| Hybrid SQL retrieval, citation constraint | PDF/DOCX/XLSX parser, reranker, BM25 |
| Eval gate and one-step rollback | Golden hospital-bed suite |
| LangGraph skeleton and untrusted-text test | Temporal workflow and live model calls |
| Budget trigger, prompt object keys | Gateway implementation and dashboards |
| Lesson and consent tables | The post-job promotion job |
