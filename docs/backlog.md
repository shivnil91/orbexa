# Backlog

Sizes are relative. S is one module. M crosses two components. L crosses the transaction path or a security boundary. They are not calendar estimates.

Done in Milestone 1 means the schema, the test, or the document exists in this repository. It does not mean the marketplace flow runs.

## Milestone 1 — foundation (this repository)

| Item | Size | Acceptance |
| --- | --- | --- |
| SQL migrations for identity, catalogue, commerce, jobs, memory, agent ops | L | `pnpm --filter @orbexa/db test` passes, including cross-tenant retrieval, citation FK, ledger balance, payout block, eval rollback. **Done.** |
| Money split and ISO minor units | S | Unit tests for remainder-to-creator and for JPY versus three-decimal amounts. **Done.** |
| Web locale route and `Intl` formatting | S | Tests show USD versus EUR and Auckland versus London. **Done.** |
| LangGraph skeleton and untrusted-text test | S | Hostile document does not change stage order. **Done.** |
| Terraform cell, three environments, validate, no apply | M | `terraform validate` succeeded for dev, staging, and prod with Terraform 1.10.5. **Done.** |
| Threat model, ownership, ADRs, this backlog, first response | M | Docs merged. **Done with this commit series.** |

## Milestone 2 — Rahul's hospital-bed transaction

The local slice now has passing tests. See `ENGINEERING_STATUS.md` for what is stubbed. These rows stay open where they still need a real provider or a UI.

Dependency order matches section 5 of `docs/first-response.md`. Acceptance tests are the Given/When/Then list in section 7 of that file.

| Item | Size | Acceptance |
| --- | --- | --- |
| Cognito linked to `users`, RLS session GUCs | M | A user in org A cannot set org B's tenant and read a document. |
| Expert verification and screening fail-closed | M | `verified` without a clear screening raises. Test provider rejected when environment is not local. |
| Listing with three service levels | M | Order snapshot matches `splitServiceAmount`. Autonomous has no review fee. |
| Upload, malware gate, chunker with locators | L | PDF, DOCX, and XLSX become immutable chunks. An executable is rejected. Tables keep headers and cell ranges. |
| Temporal workflow, SQS outbox, idempotent steps | L | Killing the worker mid-extract resumes the same step and does not double-write requirements. |
| Draft, matrix, grounding | L | A missing bed certificate is `missing_evidence`. A supported claim without a citation does not persist. |
| Docx and xlsx export | M | Rahul opens both in an editor and changes a cell. |
| Expert review and buyer acceptance | M | Expert Verified waits for Moishin. Autonomous does not. |
| Ledger and payout state, no live Stripe | L | Balanced journal. Payout blocked without screening. Zero calls to the ThirdRoc account. |

Global work that is part of Milestone 2 and not a rewrite: currency on every amount, locale and zone confirmed before the job, `home_region` on every private row, tax quote recorded, checkout stops when tax status is `unsupported`.

## Milestone 3 — persistent intelligence

| Item | Size | Acceptance |
| --- | --- | --- |
| Post-job lesson candidate | M | Candidate is invisible to other buyers. |
| Scrub, IP check, consent | L | A lesson containing a buyer name or a price is rejected. No consent row means no promotion. |
| Golden suite for the hospital-bed vertical | L | Synthetic or licensed fixtures only. Score stored on `eval_runs`. |
| Publish only on a higher score, one-step rollback | M | Already enforced in SQL for the gate. Milestone 3 connects it to a real suite. A regression does not publish. |
| Re-embed on a new model as a new version | M | Old citations still resolve. Rollback restores the previous `embedding_model_id`. |
| Cross-cell revocation of a lesson | L | Revocation in the buyer cell hides the lesson in the creator cell. Not required while there is one cell. |
| Security test: no cross-account retrieval | L | Two tenants, hostile prompts, shared cache keys, and a forgotten filter. Must match the PGlite tests against the deployed cell. |

No fine-tuning. No reuse of confidential text without the consent row.

## Milestone 4 — production readiness

| Item | Size | Acceptance |
| --- | --- | --- |
| Restore drill from RDS and from S3 versioning | M | A written timing and a successful read of a restored chunk. |
| Reconciliation | M | Ledger sums match provider reports for a sandbox day. Mismatches page a human. |
| Load and abuse tests | M | Budget and rate limit stop a runaway job. WAF rule set is the one in Terraform. |
| Privacy-request drill | M | Export and delete on a fixture tenant. Ledger retains amounts, not document text. |
| Penetration test by a named third party | L | Report read by the independent reviewer. No claim of a certification. |
| Dashboards | M | Grounded-claim rate, latency, cost per job, revision rate, by agent version. Built from `run_metrics` and `llm_invocations`. |
| BM25 swap and reranker | M | Same function signature. Measured change on the golden suite. |
| Second region | L | New cell. Tenants are not copied across regions by default. |
| Vertical packs | M | Core commerce is category-agnostic. A specialist is a `vertical_revisions` row: intake schema, deliverable types, rubric, and workflow. Tender rules live in the tender pack. |

The founder added the vertical-pack row to this milestone. See ADR 0009. A new category does not require a migration. Custom model behavior beyond the declared stage list still requires a pack module.

What landed in the repository, and what did not:

- Restore: local logical snapshot and versioned object drill, with a timing. RDS and S3 were not restored.
- Reconciliation: sandbox-day comparison pages a human on mismatch. No live charge.
- Load and abuse: budget and rate limit stop a runaway job. The WAF resource is `AWSManagedRulesCommonRuleSet`. No production load test.
- Privacy: export and delete on a fixture org. Ledger amounts remain. Document text is redacted in this cell.
- Penetration test: not performed. No certification is claimed. See `docs/m4-runbooks.md`.
- Dashboards: `app.agent_version_metrics` and a fixture page at `/en/dashboard`.
- BM25: same `app.retrieve_chunks` signature, selected with `app.lexical_scorer`. Worker rerank is phrase overlap. The golden-suite measurement is synthetic.
- Second region: `infra/envs/prod-eu-central-1`. Not applied. No tenant copy.

## Explicitly later

Public marketplace search, admin moderation UI, a wallet, a tax engine, an FX desk, self-hosted Temporal, Kubernetes, and any use of the live ThirdRoc Stripe account.
