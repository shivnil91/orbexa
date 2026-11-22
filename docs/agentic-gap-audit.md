# Agentic platform gap audit

Audit of `main` on 2026-11-22. This document only records what is in the tree. A table, a design sentence, or a test insert is not treated as a running capability. Where `docs/agent-architecture.md` describes a gateway or a tracer that the worker does not call, the code is the finding.

Statuses:

- **present** — the behaviour runs in application code and a test exercises it.
- **partial** — a schema, a narrower substitute, or a design exists, and the checklist item is not met end to end.
- **missing** — no implementation was found.

Effort uses the scale in `docs/backlog.md`. S is one module. M crosses two components. L crosses the transaction path or a security boundary. These are not calendar estimates.

No application code was changed for this audit.

## Summary

| Checklist item | Status | What the tree actually has |
| --- | --- | --- |
| Agent eval harness | partial | Keyword scorer and a SQL promotion gate. Golden case files named by the manifest are not on disk. No LLM-as-judge. CI runs the existing unit and integration tests. |
| Tracing and observability | partial | Append-only `llm_invocations`, `prompt_traces`, `retrieval_events`, `run_metrics`. The worker and API do not write them. No OpenTelemetry, LangSmith, or Langfuse SDK. The dashboard is a fixture. |
| Guardrails | partial | Document fence, fixed stage graph, foreign-tenant UUID check, SQL tool catalog, citation constraint, lesson-text restriction. No per-call tool allow-list in the worker. No output schema check. No PII redaction of model output. |
| Agent handoff | partial | Human approve signal and `approvals` / `version_approvals` rows. No typed inter-agent contract and no supervisor. |
| MCP and A2A | missing | No MCP client or server. No agent-to-agent protocol. |
| Model routing, fallback, caching, prompt caching | partial | `model_routes.fallback_model` and tenant-scoped `llm_cache` are tables. The gateway does not read them. No vendor prompt-cache fields. |
| Structured outputs | partial | OpenAI `json_object` and a JSON parse. Intake forms use a JSON Schema subset. Model JSON is not checked against a schema. |
| Durable execution and retries | present | Temporal `TenderJob`, five attempts, file-backed idempotent activities, worker-kill resume test. The server in that path is the time-skipping test server. |
| Memory | partial | Four scopes, RLS, `app.retrieve_chunks`, `app.retrieve_memory`, and the learning loop in SQL and `packages/db`. The worker retriever is an in-memory BM25 demo and does not call Postgres. |
| Expert certification and sandbox | partial | Listing publish requires a verified expert and a published version. Later versions require a higher eval score and creator approval. `release_review.py` records that no certification is claimed. No sandbox runner. |
| Cost controls | partial | `job_budgets` trigger, `app.consume_rate_limit`, and in-process `RunBudget`. `spend_limits` has RLS and no enforcement function. The live gateway does not record cost. |
| Security | partial | Split Secrets Manager ARNs, RLS, live-Stripe refusal, local seed host guard, audit and pip-audit in CI. Terraform is unapplied. No Cognito. Malware scanner is not deployed. |
| Expert SDK | partial | In-repo vertical pack (`VerticalDefinition`, intake validator, LangGraph stage list). No published SDK package. |
| Marketplace UI/UX | missing | `/en` is a scaffold and `/en/dashboard` is a fixture. No onboarding, listing, intake, live run, deliverable review, or checkout. `Intl` money and time formatting is tested. |

## 1. Agent eval harness

**Status: partial**

Present:

- `fixtures/hospital-beds/eval/v1.json` names a synthetic suite `hospital-beds-golden` with three cases (`missing-certificate`, `cite-width`, `hostile-stage-order`) and a `storageKey` under `fixtures/hospital-beds/eval/synthetic/v1/`.
- `packages/db/src/learning.ts` `loadGoldenSuite` reads that manifest. `scoreLessons` scores lesson text with string rules (`missing_evidence`, "do not cite measurements", "skip grounding"). It does not open the case files and it does not call a model.
- `eval_suites`, `eval_cases`, and `eval_runs` are in `packages/db/migrations/0003_catalog.sql`. `app.assert_eval_fixture` in `packages/db/migrations/0010_learning.sql` rejects a fixture path that is not `fixtures/.../synthetic/` or `fixtures/.../licensed/`, and rejects a fixture whose text contains a buyer chunk of at least 24 characters.
- `app.assert_version_status` in the same migration refuses `eval_improved` unless the new `eval_runs` row passed and its score is strictly higher than the previous version on the same suite. `eval_improved` also requires a `version_approvals` row with `status = 'approved'`. `app.rollback_agent_version` restores one parent.
- `.github/workflows/ci.yml` runs `pnpm test`, `pnpm --filter @orbexa/db test:pg16`, ruff, mypy, and pytest. Those suites include `packages/db/src/learning.test.ts`, `learning.integration.test.ts`, and `workers/ai/tests/test_m4.py`.

Not present:

- The three JSON files named by `v1.json` are not in the tree. `fixtures/hospital-beds/` contains the manifest, a README, and four tender documents.
- No LLM-as-judge, no judge prompt, and no rubric scorer. `VerticalDefinition.rubric` in `workers/ai/src/orbexa_ai/verticals/tender_pack.py` is the tuple `("grounded_claim", "missing_evidence")`. Nothing reads it to score a model completion.
- CI has no eval job that fails the build when a golden score drops. Pytest and the database tests are the regression net.

`workers/ai/src/orbexa_ai/retrieval.py` `measure_golden_suite` scores three hard-coded retrieval cases (hit@1 for `ts_rank_cd`, BM25, and phrase rerank). The docstring says it is not a certification. That function is not the agent-output harness.

**Recommended approach.** Land the three synthetic case files the manifest already names, and make `scoreLessons` read their expectations from those files. Add a CI step that runs that suite and the retrieval measurement and fails on a lower score. Add an LLM-as-judge only as a second, stored rubric pass, after the deterministic score, and keep customer tenders out of the suite via the existing `assert_eval_fixture` rule. Effort: M for the fixture files and CI gate, M for the judge.

## 2. Tracing and observability

**Status: partial**

Present in schema:

- `packages/db/migrations/0007_agent_ops.sql` defines append-only `llm_invocations` (`input_tokens`, `output_tokens`, `cost_minor`, `latency_ms`, `prompt_hash`, `fallback_used`, `cache_hit`), `tool_calls`, `prompt_traces` (instruction hierarchy default `system>developer>user>untrusted_document`), `retrieval_events`, and `run_metrics`.
- `app.agent_version_metrics` in `packages/db/migrations/0010_m4_readiness.sql` aggregates grounded-claim rate, latency, cost per job, mean invocation cost, and revision rate from `run_metrics` and `llm_invocations`.
- `packages/db/src/learning.ts` `closeJobLearning` sums `llm_invocations.cost_minor` and `latency_ms` when a job is already `accepted`. Callers in tests insert the invocation rows first.

Not present at runtime:

- Search of `workers/` and `services/api/src` finds no `INSERT` into `llm_invocations`, `tool_calls`, `prompt_traces`, or `retrieval_events`. The only inserts are in `packages/db/src/learning.integration.test.ts` and `packages/db/src/schema.integration.test.ts`.
- No import of OpenTelemetry, LangSmith, or Langfuse in Python or TypeScript. `docs/agent-architecture.md` says "Traces use OpenTelemetry." `docs/deployment-plan.md` says "OpenTelemetry from the app comes with the gateway work." `docs/adr/0005-residency-privacy-i18n.md` allows spans to carry model name, token counts, latency, tenant id, and agent version, and forbids prompt text and document text. No exporter implements that.
- `workers/ai/src/orbexa_ai/cli.py` sets Temporal `TelemetryConfig` to forward SDK logs to stderr. That is not a trace of a model step.
- `apps/web/src/lib/dashboard.ts` `FIXTURE_DASHBOARD` is a hard-coded `metricsByAgentVersion` result. `docs/m4-runbooks.md` says the `/en/dashboard` page renders a fixture and says so.

`LiveHttpGateway._parse_completion` in `workers/ai/src/orbexa_ai/providers.py` reads the message text and ignores any `usage` object, so a live call would not record tokens even if one were made.

**Recommended approach.** Emit one span per Temporal activity and one span per `complete()` call from the gateway, with the attributes ADR 0005 already allows, and write the same numbers to `llm_invocations` in the same step. Point `/en/dashboard` at `app.agent_version_metrics` after those rows exist. Do not add a second trace vendor until that write path exists. Effort: M, and it depends on the gateway work in section 6.

## 3. Guardrails

**Status: partial**

| Control | Evidence | Limit |
| --- | --- | --- |
| Instruction fence | `workers/ai/src/orbexa_ai/safety.py` `wrap_untrusted_document` strips a closing fence tag and wraps the body. `providers.py` `_instruction` tells the model not to follow instructions inside the document. | The fence is a string. There is no classifier and no second model check. |
| Graph does not follow the document | `workers/ai/src/orbexa_ai/verticals/runner.py` compiles the declared stage tuple. `run_vertical` returns that list. `workers/ai/tests/test_pipeline.py` is the hostile-string test named in `docs/agent-architecture.md`. | The graph has no tool node. A model that is later given tools is outside this test. |
| Foreign tenant id in a draft | `workers/ai/src/orbexa_ai/injection.py` `assert_draft_has_no_foreign_tenant` rejects a UUID in the draft JSON other than the job tenant. `INJECTION_DOCUMENTS` is the fixture set. | The check is a UUID regex. It does not catch names, prices, or instructions that do not contain a UUID. |
| Tool catalog | `packages/db/migrations/0001_foundations.sql` seeds `read_chunk`, `write_artifact`, `flag_claim`, all `side_effect = false`. `app.reject_side_effect_tools` in `0003_catalog.sql` blocks attaching a side-effect tool. | The worker never reads `agent_version_tools` or writes `tool_calls`. `gateway.complete` is a direct call. |
| Claim shape | `safety.py` `claim_is_admissible` requires `supported` claims to have a citation. ADR 0003 states a deferred constraint rejects a supported claim with no citation. | Admissibility is not applied to `LiveHttpGateway` output. The parser only checks that the body is a JSON object. |
| PII and confidentiality | `memory_items` requires `pii_scan_status = 'clear'` for `approved_reusable` (`0006_memory.sql`). `app.lesson_restriction` in `0010_learning.sql` returns `buyer_document`, `buyer_name`, `price`, or `certificate_number` from substring and regex checks. `app.redact_org` in `0010_m4_readiness.sql` overwrites stored text with `[redacted]` for a privacy delete. | Nothing scans model output before it is shown. `pii_scan_status` is a column the insert path must set. There is no redaction function on a draft. |

`docs/threat-model.md` states the injection work "does not make the model incapable of being confused" and is not a penetration test. `workers/ai/src/orbexa_ai/release_review.py` sets `performed: False` and `certification_claimed: False`.

**Recommended approach.** When the worker grows a tool loop, resolve the allowed set from `agent_version_tools` for that version and reject any other code before execution. Validate each stage's JSON against a schema that includes `claim_is_admissible`. Run `lesson_restriction`-style checks, plus a dedicated PII pass, on draft text before delivery. Keep the UUID check. Effort: M.

## 4. Agent handoff

**Status: partial**

Present:

- `workers/ai/src/orbexa_ai/tender_workflow.py` waits on `workflow.wait_condition` unless `service_level` is `autonomous`, and sets `approved` from the `approve` signal. Retry policy is `maximum_attempts=5`.
- `approvals` in `packages/db/migrations/0005_jobs_documents.sql` allows `expert_review` and `buyer_acceptance`. `services/api/src/slice.ts` inserts an `expert_review` row, marks it approved, then inserts `buyer_acceptance`. ADR 0007 says Expert Verified and Expert Led require that review row.
- `version_approvals` and the creator-approval check inside `app.assert_version_status` (`0010_learning.sql`) gate a learned version.
- `docs/m4-runbooks.md` uses `pageHuman: true` from ledger reconciliation as the handoff to a person. There is no pager integration.

Not present:

- No typed handoff message between agents. Activity payloads in `tender_workflow.py` are `dict[str, str]`. Results are untyped dicts.
- No supervisor and no sub-agent. `TenderJob` is one workflow with four activities. `workers/ai/src/orbexa_ai/temporal_gate.py` `TenderGate` is a separate signal proof, not a parent of `TenderJob`.
- `workers/ai/src/orbexa_ai/workflow.py` is an in-process memoizing runner. `job.py` still uses it. `ENGINEERING_STATUS.md` says the API slice and the CLI use `TenderJob`. `slice.ts` `runWorker` spawns `python -m orbexa_ai.cli`, which starts `TenderJob` on `WorkflowEnvironment.start_time_skipping` and, for a non-autonomous level, signals `approve` itself (`cli.py`). The slice therefore does not leave a human waiting.

**Recommended approach.** Keep the single workflow until a second specialist exists. If one does, define a handoff record (source agent version, target agent version, artifact ids, tenant, job) and have a parent workflow wait on it. Do not signal `approve` from the CLI once a real reviewer is in the path. Effort: S to stop auto-approval on the demo path; L for a typed supervisor.

## 5. MCP and A2A

**Status: missing**

No application source, migration, or doc names an MCP server, an MCP client, or an agent-to-agent protocol. Tool use is the three catalog codes in section 3. The worker does not dispatch them.

**Recommended approach.** Add an MCP client only for tools that already exist in `tool_catalog`, with the same side-effect trigger. Do not add an A2A endpoint before the handoff record in section 4 exists. A public MCP server that can read buyer documents would bypass RLS unless it calls `app.retrieve_chunks` with the session GUCs. Effort: L for a read-only MCP client bound to the catalog. A2A is L and should wait.

## 6. Model routing, fallback, caching, and prompt caching

**Status: partial**

Present:

- `model_routes` (`primary_model`, nullable `fallback_model`) in `0001_foundations.sql`. The comment says the columns are model ids, "not a promise that a vendor is contracted."
- `llm_cache` primary key `(tenant_id, model, prompt_hash)` in `0007_agent_ops.sql`. ADR 0003 and the integration test insert the same prompt hash for two tenants and show each session one row.
- `workers/ai/src/orbexa_ai/gateway.py` `gateway_from_env` returns `FixtureGateway` by default, `BlockedLiveGateway` for xAI, and `LiveHttpGateway` for Anthropic or OpenAI when the matching key is set. `startup.py` `refuse_live_stripe_keys` runs first.
- `LiveHttpGateway` takes an optional `RunBudget` and calls `budget.charge()` before HTTP. The default `gateway_from_env` does not pass a budget.
- Activities in `workers/ai/src/orbexa_ai/tender_activities.py` skip work when `ingest.json`, `extract.json`, and the other step files already exist. That cache is a local file for Temporal retries, not a prompt cache.

Not present:

- No read of `model_routes` in Python or the API. `slice.ts` inserts `primary_model = 'fixture'` and stores the id on the agent version. The worker ignores it.
- No fallback. `fallback_used` exists only as a column. A non-2xx response in `LiveHttpGateway.complete` raises `ProviderError`.
- No read or write of `llm_cache` from the gateway.
- Anthropic and OpenAI request bodies in `providers.py` have no `cache_control`, no prompt-cache key, and no cached-token field.

`docs/agent-architecture.md` describes routing, tenant cache, budget refusal, and an invocation row as the gateway. The "What is in this milestone" table in that file still lists "Gateway implementation" under Later. The later column matches the worker.

**Recommended approach.** One gateway function: load `model_routes` for the version, look up `llm_cache` by `(tenant_id, model, prompt_hash)`, call the primary model, on `ProviderError` call `fallback_model` once, then insert `llm_invocations` with tokens, cost, latency, `fallback_used`, and `cache_hit`. Vendor prompt caching is a header on that same request after a provider contract exists. Until then the default remains `FixtureGateway`. Effort: L for the gateway, S for vendor cache headers once a provider is contracted.

## 7. Structured outputs

**Status: partial**

- `LlmGateway.complete` is typed as `dict[str, object]` (`gateway.py`).
- OpenAI requests set `response_format: {type: json_object}` (`providers.py`). Anthropic requests do not. The parser `json.loads` the text and rejects a non-object. It does not check keys.
- `workers/ai/src/orbexa_ai/verticals/intake.py` `validate_intake` checks a JSON Schema subset (object, properties, required, additionalProperties, string, number, integer, boolean, enum, minLength). ADR 0009 says the same subset is enforced in SQL, the API, and the worker. That validates the buyer's intake form, not the model's draft.
- `workers/ai/src/orbexa_ai/verticals/tender_fixture.py` returns fixed dicts from `FixtureGateway`. Those shapes are not checked by a schema in the gateway.

**Recommended approach.** Give each stage a JSON Schema, ask the provider for that schema where the API supports it, and run the same subset validator on the parsed object before the activity writes its file. Reject a `supported` claim that fails `claim_is_admissible`. Effort: S.

## 8. Durable execution and retries

**Status: present**

- ADR 0002: Temporal owns retries, timers, and the human wait. LangGraph stays inside an activity. SQS is the scaling queue. The repository does not contain a self-hosted Temporal cluster.
- `TenderJob` (`tender_workflow.py`) runs extract, matrix, draft, an optional approve wait, and deliver. Each activity uses `RetryPolicy(maximum_attempts=5)`.
- `tender_activities.py` writes the activity result under `store_dir` before returning. A retry reads that file and does not recompute. `workers/ai/tests/test_temporal_resume.py` kills the worker after extract is written and checks the extract counter stays at 1.
- `job_queue` in `0005_jobs_documents.sql` is documented as the transactional outbox that signals Temporal. `infra/modules/cell/main.tf` declares an SQS queue and a dead-letter queue with `maxReceiveCount = 5`.

Limits, which do not remove the workflow from the tree:

- `cli.py` starts `WorkflowEnvironment.start_time_skipping`. `ENGINEERING_STATUS.md` says this is the Temporal Python SDK test server, not Temporal Cloud, and that a crash of that server process is not what the kill test covers.
- No application file publishes `job_queue` or calls SQS. The queues exist only in Terraform, which `README.md` says has not been applied. ECS `desired_count` is 0.
- `workflow.py` remains for `job.py` and `tests/test_milestone2.py`.

**Recommended approach.** Leave the activity file cache and the retry policy. Add the outbox relay from `job_queue` to SQS and a worker that starts `TenderJob` on a real Temporal frontend. Do not add a second workflow engine. Effort: L.

## 9. Memory

**Status: partial**

Present in Postgres and `packages/db`:

- `memory_items.scope` is `execution`, `buyer_private`, `creator_expertise`, or `approved_reusable` (`0006_memory.sql`), with the owner, tenant, job, and consent checks in ADR 0003.
- `app.retrieve_chunks` (`0010_m4_readiness.sql`, replacing the earlier definition) is `SECURITY INVOKER`, rejects a tenant or job that does not match the session, and fuses vector rank with `ts_rank_cd` or in-database BM25 (`app.lexical_scorer`). `app.retrieve_memory` refuses `execution`.
- Cross-tenant tests live in `packages/db/src/schema.integration.test.ts` and `packages/db/src/learning.integration.test.ts`.
- The learning loop in `packages/db/src/learning.ts` proposes a lesson only after the job status is `accepted`, and `app.publish_learned_version` requires a clear scrub, a consent grant, and `lesson_restriction` returning null.

Not present in the worker:

- `workers/ai/src/orbexa_ai/retrieval.py` scores an in-memory list. It does not connect to Postgres and does not call `app.retrieve_chunks`.
- No worker reference to `memory_items` or `retrieve_memory`. The tender job reads fixture files from disk (`tender_activities.py` `MEDIA`).

Short-term memory for a run is the activity JSON files plus the `execution` scope, which the worker does not write. Long-term memory and per-tenant isolation are enforced for SQL sessions. Retrieval quality in the worker is hit@1 on three synthetic pairs, not a measurement of `app.retrieve_chunks` against the hospital-bed documents.

**Recommended approach.** Call `app.retrieve_chunks` and `app.retrieve_memory` from the extract and draft activities under the job's tenant GUC. Keep the in-memory BM25 function only as a unit of the ranking math. Record `retrieval_events` for each call. Effort: L.

## 10. Expert certification and sandbox

**Status: partial**

Present:

- `app.assert_expert_verified` in `packages/db/migrations/0002_identity.sql` refuses `expert_profiles.status = 'verified'` without a clear unexpired `expert_verification` screening and an approved `expert_verifications` row.
- `app.assert_listing_publish` in `0008_enforcement.sql` refuses a published listing unless the agent version is `published` and belongs to that creator, and the creator's expert profile is `verified`.
- Version promotion after the first requires `eval_improved`, a higher score, and creator approval (section 1).
- `release_review.py` records `certification_claimed: False`, `performed: False`, and no named reviewer. ADR 0008 says a fixture run is not a third-party report.

Not present:

- No sandbox process that runs an agent version against the golden suite in a tenant with no buyer documents before `listings.status` can become `published`.
- The first publication basis `initial_human` does not require an `eval_runs` row.
- `docs/backlog.md` lists public marketplace search as later. Listing discovery in the slice is an SQL insert (`ENGINEERING_STATUS.md`).

**Recommended approach.** Require a recorded eval run, in a sandbox org that `assert_eval_fixture` would accept, before the first publish as well as later ones. Keep `certification_claimed` false until a named reviewer exists. Do not treat the SQL expert-identity gate as an agent sandbox. Effort: L.

## 11. Cost controls

**Status: partial**

- `job_budgets` (`0005_jobs_documents.sql`) and deferred trigger `app.assert_job_budget` (`0007_agent_ops.sql`) reject an `llm_invocations` insert whose running sum exceeds the job cap, and reject an insert when the job has no budget in that currency. This fires only when a row is inserted. The worker does not insert one.
- `app.consume_rate_limit` (`0010_m4_readiness.sql`) counts `rate_limit_events` for an active `rate_limit_policies` row and raises when the last minute is full. No policy means the function returns 0. The worker does not call it.
- `workers/ai/src/orbexa_ai/limits.py` `RunBudget.charge` raises `BudgetExceeded` or `RateLimitExceeded` in memory. Tests cover it. `gateway_from_env` does not attach a `RunBudget`.
- `spend_limits` (`0004_commerce.sql`) stores `per_order`, `per_day`, and `per_month` caps and has RLS (`0008_enforcement.sql`). No function or trigger reads the table when an order or an invocation is written.
- `docs/m4-runbooks.md` states the budget and rate-limit checks are unit and database tests, not a load test.

**Recommended approach.** Charge `RunBudget` and `app.consume_rate_limit` inside `complete()` before HTTP, and insert `llm_invocations` so the SQL cap sees the same spend. Add a check of `spend_limits` on order capture for the buyer org. Effort: M for the model path once section 6 exists, M for `spend_limits`.

## 12. Security

**Status: partial**

Secrets:

- `infra/modules/cell/main.tf` defines `orbexa/${cell}/api/runtime` and `orbexa/${cell}/worker/runtime`. The API role may `secretsmanager:GetSecretValue` on the API secret only. The worker role may read only the worker secret. `docs/deployment-plan.md` states production secrets are not in git.
- `workers/ai/src/orbexa_ai/startup.py` and `LiveHttpGateway` refuse a value containing `sk_live_` or `rk_live_`. `README.md` says model and Stripe keys stay empty locally. `packages/db/src/local-guard.ts` `assertLocalDatabaseHost` refuses a non-local seed host.
- CI runs `pnpm audit --audit-level=high` and `pip-audit`. Actions in `.github/workflows/ci.yml` are pinned by commit SHA. `docs/threat-model.md` says CI pull requests get no cloud role. The production GitHub environment "does not exist yet."

Least privilege:

- Private tables use `FORCE ROW LEVEL SECURITY`. ADR 0003 says application roles are not superuser and not `BYPASSRLS`. The worker role in Terraform may receive and delete from the work queue, decrypt with the data key, and may not send to the queue. The API role may send and may `s3:GetObject` / `s3:PutObject`. The worker role has no S3 statement.
- Task security group egress is TCP 443 to the internet and TCP 5432 to the database security group (`main.tf`). The ALB security group egress is all protocols to `0.0.0.0/0`.
- The ECS container definition sets no `user`. `docs/threat-model.md` says the worker "is non-root in the task definition we will ship" and that the skeleton image is a placeholder. `desired_count` is 0. Terraform has not been applied.
- `job_grants` allows `reviewer` or `observer` on one job. Org membership is not file access (`docs/threat-model.md`).

Other residuals named in the tree, not repeated as if they were fixed:

- No Cognito. The slice inserts users (`ENGINEERING_STATUS.md`).
- Uploads start at `malware_scan_status = pending`. The scanner is not deployed (`docs/threat-model.md`).
- The penetration test was not performed (`release_review.py`, ADR 0008).

**Recommended approach.** Keep the secret split and the live-key refusal. Set a non-root `user` on the task definition before `desired_count` leaves 0. Put Cognito in front of session GUCs before any tenant other than the local slice exists. Deploy the malware scanner before a chunk can be created from an upload that is not `clean`. Effort: M for the task user and secret wiring review, L for Cognito plus the scanner.

## 13. Developer experience

**Status: partial**

- `workers/ai/src/orbexa_ai/verticals/tender_pack.py` defines `VerticalDefinition` (`code`, `workflow`, `rubric`).
- `runner.py` compiles that stage list with LangGraph. Document text cannot add a stage.
- `intake.py` validates the intake schema subset.
- ADR 0009: a new category is a `vertical_revisions` row. Custom extraction still needs a Python pack. `TenderJob` is the only Temporal workflow class. Other verticals use the in-process runner. Adding a tool is still a migration.
- `pnpm-workspace.yaml` lists `apps/*`, `services/*`, and `packages/*`. There is no `sdk` package, no expert-facing CLI, and no plugin manifest. `orbexa_ai.cli` runs one tender job on the test server.

**Recommended approach.** Extract a small package that exports `VerticalDefinition`, `compile_workflow`, `validate_intake`, and a local fixture runner, with a test that a data-only vertical (the grant-writing case in `workers/ai/tests/test_verticals.py`) runs without tender imports. Publish it only after the golden suite for that package is in CI. Effort: L.

## 14. Marketplace UI/UX

**Status: missing** as a launchable marketplace. Two primitives are partial: locale formatting, and a fixture metrics page.

This section uses the public product surfaces of Upwork, Fiverr Pro, Toptal, the GPT Store, Relevance AI, Lindy, Loopio, and Responsive as the launch bar. It is not a crawl of those sites. Nothing below is claimed for Orbexa unless a file in this tree implements it.

`apps/web` is Next.js 16 and React 19 (`apps/web/package.json`). The routes are `/` redirected to `/en` (`apps/web/next.config.ts`), `/[locale]` (`apps/web/src/app/[locale]/page.tsx`), `/[locale]/dashboard` (`apps/web/src/app/[locale]/dashboard/page.tsx`), and a locale not-found (`apps/web/src/app/[locale]/not-found.tsx`). The API router exposes `GET /health` and, in local or dev, `POST /v1/demo/hospital-beds` (`services/api/src/routes.ts`). There is no listing, intake, job, or checkout route for a page to call. `docs/first-response.md` records that search, messaging, ratings, and an admin console were rejected for Milestone 1. `docs/backlog.md` still lists public marketplace search and admin moderation as later.

| Surface | Status | Evidence | Launch bar this does not meet |
| --- | --- | --- | --- |
| Design system and brand | partial | Tailwind 4 and two color tokens in `apps/web/src/app/globals.css`. `layout.tsx` loads Geist and Geist Mono (`subsets: ["latin"]`) and metadata title "Orbexa" with description "Foundation scaffold". `body` sets `font-family: Arial, Helvetica, sans-serif`, so the loaded faces are not the text face. `favicon.ico` is the only image. No component module, no logo component, no token file beyond `--background` and `--foreground`. | Upwork, Fiverr, and Toptal ship a named brand, a type ramp, and reusable listing, price, and badge components. This tree has a scaffold page that says so in the first paragraph of `page.tsx`. |
| Buyer and expert onboarding | missing | `page.tsx` says "Buyers and experts do not register here yet." No form, no Cognito screen, no route under `apps/web/src`. `ENGINEERING_STATUS.md` says the slice inserts users. | Both sides of Upwork and Fiverr register, verify, and land in a role-specific home. Toptal's expert path is an application. None of that exists here. |
| Discovery and listing | missing | No search, filter, or listing page. The only in-app link is the text "Agent version dashboard". Listing rows are an SQL insert (`ENGINEERING_STATUS.md`). | Fiverr and the GPT Store are browse-first. Upwork is search-first. Loopio and Responsive open a project list. Orbexa has no list. |
| Job intake | missing | The intake JSON Schema subset is enforced in `workers/ai/src/orbexa_ai/verticals/intake.py` and in SQL (ADR 0009). The web app has no form and no upload control. The demo is `POST /v1/demo/hospital-beds`. | A Loopio or Responsive project starts by uploading the RFP and attaching the answer library. A Fiverr order starts with a package and requirements form. |
| Live run | missing | No streaming response, no progress UI, no citation view, no review queue. `TenderJob` can wait on an approve signal (`tender_workflow.py`). `cli.py` sends that signal itself for non-autonomous levels, and `slice.ts` calls the CLI. | Lindy and Relevance show a run log. Loopio and Responsive show a review workflow. A buyer of this product cannot watch extract, matrix, draft, or the expert gate. |
| Deliverable review and edit | missing | The worker writes DOCX and XLSX (`tender_activities.py`, `slice.ts`). No page renders or edits them. | Loopio and Responsive export a reviewed answer set. Upwork and Fiverr deliver files into the order. The hospital-bed files stay in the object store and the test. |
| Payments and checkout | missing | No checkout page. `page.tsx` prints `formatMoney` under the heading "Sample formatting, not a price". Payments in the API are `FakePaymentProvider` or a Stripe stub (`ENGINEERING_STATUS.md`). Live Stripe is refused (`startup.py`). | Upwork and Fiverr Pro take payment in the order flow, with the package price and the fee visible before pay. |
| Dashboards | partial | `/en/dashboard` renders `FIXTURE_DASHBOARD`: grounded-claim rate, latency, cost per job, revision rate. The page says the figures are not a live cell. There is no buyer job list and no expert earnings view. `GET /fr/dashboard` is a 404 (`ENGINEERING_STATUS.md`, `locale.ts` allows only `en`). | Upwork and Fiverr separate client spend from seller earnings. An operator dashboard of one fixture agent version is not either home. |
| Accessibility (WCAG 2.2 AA) | partial | The two pages use `main`, `header`, `section`, `article`, one `h1`, and `h2`. The dashboard link is an `<a>` with `underline`. No `aria-*`, no skip link, no form label, no focus style in `globals.css`, no `axe` or pa11y script. `layout.tsx` sets `<html lang="en">` for every locale. ESLint includes `eslint-config-next/core-web-vitals` (`apps/web/eslint.config.mjs`). That preset is a lint rule set, not a WCAG audit. | A launch marketplace is keyboard-operable, named in the page language, and checked. These pages are short semantic HTML and have not been audited. |
| Performance (Core Web Vitals) | missing | No `web-vitals` client, no Lighthouse budget, no measured LCP, INP, or CLS in the repo. `next.config.ts` sets `cacheComponents` and `partialPrefetching`. Both pages are server components with no `"use client"`. `ENGINEERING_STATUS.md` records HTTP status for `/en` and `/en/dashboard`, not timings. The unused Geist preload is the only performance defect visible in source. | A launch bar is a measured budget on the listing, intake, and checkout routes. Those routes do not exist, so no score is claimed here. |
| Mobile | partial | Both pages use `px-5`, `sm:px-8`, `max-w-3xl`, and a one-column grid until `sm:` (`sm:grid-cols-3` on the home cards, `sm:grid-cols-2` on the dashboard). No navigation, no touch target, no viewport override. | Upwork, Fiverr, and the GPT Store are usable as marketplaces on a phone. This layout stacks two scaffold pages. |
| i18n and RTL | partial | `SUPPORTED_LOCALES` is `["en"]` (`locale.ts`). `formatMoney` and `formatInstant` use `Intl` and are tested for USD/en-US, EUR/de-DE, JPY/ja-JP, Auckland, and London (`format.test.ts`). ADR 0005 says the only message catalog is `en`. No dictionary, no `dir`, no RTL fixture. Geist is Latin-only. `lang` does not follow the route param. | Fiverr and Upwork ship translated UI and currency. A second catalog, and `dir="rtl"` when that catalog needs it, are not in the tree. |
| Trust signals | missing | The home page says the slice uses a fixture model and a fake payment adapter. The dashboard says it is not a live cell. Service levels are a paragraph, not a priced choice. No verified badge, no review, no escrow copy, no sample deliverable, no "missing evidence" example. `release_review.py` sets `certification_claimed: false`. `docs/first-response.md` deferred the ratings UI. | Fiverr Pro and Toptal show a vetting mark that matches a real screen. The GPT Store shows ratings. Showing either here would invent a state the code does not have. |

### What would beat those products, using data this repo already has

These are not claims that the UI wins today. They are the screens the schema and the worker can support, which the scaffold does not draw.

1. **A compliance matrix, not a chat.** `TenderJob` returns requirements, matrix rows, claims, and chunks. A claim is `supported` with a citation, `unsupported`, or `missing_evidence` (`docs/agent-architecture.md`, `safety.py`). Loopio and Responsive attach library sources to an answer. The GPT Store, Lindy, and Relevance show a conversation or a run log. A page that lists each hospital-bed requirement, the support state, and the page locator, and that refuses a green check when the certificate is absent, is the screen those products do not sell. The web app does not render it.
2. **Three priced outcomes with a visible human gate.** `listing_tiers` stores `autonomous`, `expert_verified`, and `expert_led`, each with price, review fee, delivery days, included revisions, cancellation, and payout release (ADR 0007). Upwork sells time. Fiverr sells a package. Toptal sells a screened person and often hides the price. The GPT Store sells a prompt. The home page names the three levels and does not show a price, a review fee, or who must approve before the buyer accepts.
3. **The buyer's tender is not training data.** `app.assert_eval_fixture` rejects customer tenders as golden cases, and approved lessons cannot carry the buyer id (ADR 0003, `0010_learning.sql`). Agent stores and gig marketplaces do not put that rule next to the buy button. The home page mentions four memory domains in one card and does not say this.
4. **Do not borrow trust chrome the data does not have.** No ratings table is rendered. `certification_claimed` is false. A Pro badge, a star row, or a "certified agent" seal would be a false trust signal. Expert Verified on a listing is allowed only when `expert_profiles.status` is `verified` and the version is published (`assert_listing_publish`). That is the badge to draw, and only then.

**Recommended approach.** Build the hospital-bed buyer path before a directory. One listing, three tiers from `listing_tiers`, an intake form from the vertical schema, a run view of the matrix and citations, a download of the DOCX and XLSX, and a checkout that shows the order snapshot and uses the fake provider. Wire expert approval to the Temporal signal and stop `cli.py` from sending it. Add a skip link, a visible focus style, `lang` from the route, and the Geist face on `body`. Put an accessibility check and a Core Web Vitals run in CI when those routes exist. Leave search, messaging, ratings, and a second locale until that path is real. Effort is in the roadmap below.

## Roadmap

M5 makes the loop the schema already describes actually run, and puts the hospital-bed buyer path on a page. M6 is discovery, expert onboarding, and a second agent. Order inside each milestone is the dependency order.

### M5

| Order | Work | Effort | Depends on |
| --- | --- | --- | --- |
| 1 | Gateway reads `model_routes`, reads and writes `llm_cache`, falls back once, inserts `llm_invocations` with tokens and cost, and charges `RunBudget` plus `app.consume_rate_limit` before HTTP. Default provider stays `fixture`. | L | — |
| 2 | One OpenTelemetry span per activity and per `complete()`, attributes limited to ADR 0005. Dashboard reads `app.agent_version_metrics` instead of `FIXTURE_DASHBOARD`. | M | 1 |
| 3 | Add the three synthetic case files named by `fixtures/hospital-beds/eval/v1.json`. CI fails if `scoreLessons` or `measure_golden_suite` drops. | M | — |
| 4 | Per-stage JSON Schema on model output, including `claim_is_admissible`. | S | 1 |
| 5 | Worker calls `app.retrieve_chunks` and `app.retrieve_memory` under the job tenant and writes `retrieval_events`. | L | 2 for the event row |
| 6 | LLM-as-judge as a second score stored beside the deterministic score, with the rubric on the suite version. A judge failure does not publish. Customer text stays out via `assert_eval_fixture`. | M | 3 |
| 7 | Design shell: use the loaded sans face, focus style, skip link, `lang` from the route, and a contrast check of the zinc secondary text. No new brand claims. | S | — |
| 8 | Hospital-bed buyer path: one listing with the three `listing_tiers`, an intake form from the vertical schema, and a checkout that shows the order snapshot and calls the fake provider only. | L | — |
| 9 | Run and deliverable view: stage list, claims, citations, `missing_evidence`, and download of the DOCX and XLSX. On the demo path the approve control signals Temporal, and `cli.py` stops approving expert levels. | L | — |
| 10 | CI check for WCAG 2.2 AA on the routes above, and a Core Web Vitals run with a budget. No score is claimed until that run exists. | M | 8, 9 |

### M6

| Order | Work | Effort | Depends on |
| --- | --- | --- | --- |
| 1 | Sandbox eval in a non-buyer org required before the first listing publish. `certification_claimed` stays false. | L | M5.3 |
| 2 | Expert package for `VerticalDefinition`, the stage compiler, and the intake validator, tested by a data-only vertical. | L | M5.3 |
| 3 | Enforce `agent_version_tools` in the worker, and an MCP client whose tool names are catalog codes with `side_effect = false`. | L | M5.1 |
| 4 | Draft PII and confidentiality scan before delivery, separate from privacy-delete redaction. | M | M5.4 |
| 5 | Enforce `spend_limits` on order capture. | M | — |
| 6 | Relay `job_queue` to SQS and start `TenderJob` on a non-test Temporal frontend. Expert approval stays the signal from M5.9, not the CLI. | L | M5.9 |
| 7 | Typed handoff and A2A only when a second agent version must receive an artifact. Vendor prompt-cache headers only after a provider contract. | L, then S | M6.3 for tools; M5.1 for headers |
| 8 | Expert onboarding and a listing editor, after Cognito sets the session GUC. The verified badge renders only from `expert_profiles.status = 'verified'`. | L | Cognito work in section 12 |
| 9 | Buyer and expert dashboards from `app.agent_version_metrics` and the ledger. Retire `FIXTURE_DASHBOARD`. | M | M5.2 |
| 10 | Discovery, messaging, and ratings. Ratings appear only after a completed job. No certification seal. | L | M5.8 |
| 11 | A second message catalog, `lang` and `dir` from that catalog, and a mobile pass on search, intake, run, and checkout. | M | M6.10 |

## Top gaps

1. **No per-step trace or token cost in the running worker.** The columns exist. The gateway does not write them, and no OpenTelemetry, LangSmith, or Langfuse SDK is imported. The dashboard is a fixture.
2. **The eval harness does not judge agent output.** Scoring is keyword rules on lesson text. The golden case files the manifest names are absent. CI does not run a score gate. There is no LLM-as-judge.
3. **Routing, fallback, and the tenant prompt cache are tables only.** `gateway_from_env` never loads `model_routes` or `llm_cache`, and a provider error does not try `fallback_model`.
4. **No MCP client or server, and no A2A protocol.**
5. **No expert SDK and no pre-listing agent sandbox.** A verified human and a SQL eval gate are not a certification. `release_review.py` says none is claimed.
6. **No marketplace UI.** `/en` says buyers and experts do not register. There is no listing, intake, live run, deliverable review, or checkout. The differentiator the worker already produces — a cited matrix that stays `missing_evidence` when a certificate is absent — is not on a page.
