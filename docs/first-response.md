# Orbexa first response

Date: 2026-11-22. This is the founder briefing for Milestone 1. It records what was verified in this run. It does not claim a marketplace, a payment, or an AWS account.

## 1. Assessment of the proposed architecture

The shape that should be built is a modular monolith plus one separately scalable Python worker. Next.js serves the UI. One TypeScript API owns tenancy, orders, and the ledger. The worker parses untrusted tender files and runs the agent activity. PostgreSQL with pgvector is the system of record, including vectors. S3 with KMS holds documents and prompt objects. ECS on Fargate runs the processes. There is no Kubernetes cluster and no fleet of microservices.

Necessary changes from a literal reading of the stack list:

- **Temporal and SQS both stay, with different jobs.** SQS dispatches work and lets the worker scale. Temporal is the durable log for a job that waits on Moishin for days and must resume after a crash. LangGraph runs inside one Temporal activity. It is not a second durability store. LangGraph's default Redis or SQLite checkpointer is rejected because it would sit outside tenant row security.
- **Stripe Connect is not a global payout network.** A platform in Australia cannot self-serve cross-border Connect payouts. Fiji is not on the Stripe country list fetched on 2026-11-22, and Fiji did not appear in the Global Payouts recipient table fetched the same day. Buyer charges can be global from a supported platform entity. Creator payouts need Stripe where the corridor exists and a second rail (Wise is the candidate) everywhere else. Unsupported corridors stay `unsupported_corridor` and no money moves.
- **The connected Stripe account cannot be used.** It is one live account named ThirdRoc. No sandbox was visible. Development and tests use the ledger and a local tax provider named `test`, which the database rejects outside the local cell.
- **Cognito proves identity. Postgres authorizes.** Cognito groups are not roles. The alternative, a hand-rolled magic link, avoids a vendor but means writing account recovery and MFA. Cognito Essentials already includes email login and MFA, and the first 10,000 monthly active users are free. That is the M1 choice.
- **Memory has four domains, not one vector index.** Execution scratch, buyer-private, creator expertise, and approved reusable intelligence. Buyer rows carry the buyer tenant. Approved reusable rows do not carry the source buyer id. Provenance stays in a table the worker cannot read. Embeddings for execution memory are rejected. The HNSW index covers creator expertise and approved reusable rows only.
- **Lexical search in this schema is `simple` tsvector, not BM25.** The pgvector image we will actually run does not include ParadeDB. The retrieval function already fuses vector rank and lexical rank. Swapping the lexical scorer for BM25 does not change callers.
- **One AWS cell is deployed first.** The schema refuses private writes whose `home_region` is not this cell. A buyer who needs another region waits. Their documents are not parked in the wrong region "temporarily".
- **No fine-tuning in the product.** Improvements are a new agent version, an eval that beats the previous score, creator approval, and a one-step rollback. Confidential text is not training data.
- **Tax and FX are hooks.** Prices are tax-exclusive in the first invoicing path. Inclusive tax can be stored on a draft order and cannot leave draft. Orbexa does not run an FX book. A provider quote is snapshotted. The destination minor amount is what gets stored.

What was rejected for Milestone 1 even though it is in the long-term marketplace list: a search UI, messaging UI, ratings UI, admin console, reranker model, golden tender corpus, dashboards, and a second live region. The tables and routes those features need are either present or named in the backlog so they are not a schema surprise.

## 2. Tool and account access

Verified in this run, in the coordinator's words:

- Cursor cloud agents = verified working (this run)
- Cursor Origin = connected, repo is a private Origin draft
- GitHub = NOT connected (Cursor GitHub integration needs auth, gh CLI not logged in)
- AWS = NOT connected (no credentials or CLI available)
- Claude Code CLI = not connected, but Claude, GPT, Grok, Gemini models are verified available to Cursor cloud agents
- Grok Build = not available as a separate tool, Grok models available via Cursor cloud agents
- Stripe = connector connected to one LIVE account named ThirdRoc only, no test/sandbox account visible, must not be used for development
- model provider API keys (Anthropic/OpenAI/xAI) = none provisioned

`gh auth status` on this machine returned "You are not logged into any GitHub hosts." `aws` was not on the path. No Stripe API call was made. No model API was called.

## 3. Proposed repository structure

```
apps/web                 Next.js UI. Locale route, money and time-zone formatting.
services/api             TypeScript API. Health route only in this milestone.
workers/ai               Python worker. Upload types, claim check, LangGraph skeleton.
packages/db              SQL migrations, money split, schema tests on PGlite.
infra/modules/cell       One regional cell: network, Fargate, RDS, S3, KMS, SQS, secrets, WAF, Cognito.
infra/envs/dev|staging|prod
docs/adr                 Decision records.
docs/agent-architecture.md
docs/first-response.md   This briefing.
docker-compose.yml       Local Postgres+pgvector and the Temporal dev server.
.github/workflows/ci.yml Lint, typecheck, tests, pnpm audit, pip-audit.
```

The API is one deployable with modules inside it (identity, catalogue, orders, jobs). The worker is separate because it parses untrusted files. That is a security boundary, not a microservice programme.

## 4. Initial AWS cost estimate

**This is an estimate, not a quote and not a bill.** Prices were read on 2026-11-22 from public AWS pages and from Vantage's republication of RDS on-demand rates. Nothing was priced from an AWS account, because none is connected. The arithmetic uses 730 hours in a month. The region in the Terraform files is `us-east-1` so validation has a region. Sydney and Frankfurt list prices differ. Re-run the AWS Pricing Calculator before any spend approval.

### Rates used

| Item | Rate | Source |
| --- | --- | --- |
| Fargate Linux/x86 vCPU | $0.000011244 per vCPU-second ($0.0404784 per vCPU-hour) | AWS Fargate pricing examples, US East (N. Virginia) |
| Fargate Linux/x86 memory | $0.000001235 per GB-second ($0.004446 per GB-hour) | Same page |
| NAT Gateway | $0.045 per hour and $0.045 per GB processed | Amazon VPC pricing examples ("for this region") |
| Public IPv4 | $0.005 per hour | Amazon VPC pricing |
| Application Load Balancer | $0.0225 per hour plus $0.008 per LCU-hour | ELB pricing example |
| RDS `db.t4g.micro` | $0.016 per hour | Vantage, "starting at", treated as the lowest-region on-demand rate |
| RDS `db.t4g.small` | $0.032 per hour | Vantage, same caveat |
| RDS `db.t4g.medium` | $0.065 per hour | Vantage, same caveat |
| KMS customer key | $1 per key-month | KMS pricing example |
| Secrets Manager | $0.40 per secret-month | Secrets Manager pricing example |
| WAF | $5 per web ACL, $1 per rule, $0.60 per million requests | WAF pricing example |
| CloudWatch Logs ingestion | $0.50 per GB | CloudWatch pricing examples |
| GuardDuty malware scanning | $0.09 per GB | GuardDuty page example ("decreased from $0.60 to $0.09") |
| Data transfer out | $0.09 per GB | VPC pricing example |
| Cognito Essentials | $0 under 10,000 MAU | Cognito pricing, fetched the same day |
| S3 Standard storage | $0.023 per GB-month | Figure used inside a CloudWatch pricing example. The S3 page itself renders the number with a region selector, so treat $0.023 as the planning figure and confirm it. |
| gp3 storage | Not extracted as a clean list price | Line called out below as unverified |
| SQS | Under the 1 million request free tier at this volume | Static page hides the per-million rate behind a region selector. The line is about $0 either way. |
| Multi-AZ RDS | Assumed 2× the single-AZ hourly rate | **Assumption. Not read off a Multi-AZ price row.** |

Fargate sizes below match the Terraform variables. `desired_count` in the skeleton is 0, so applying the skeleton and leaving it there would still bill NAT, the load balancer, public IPv4, RDS, KMS, and secrets. The tables below are the cost of running the cell, not the cost of the unapplied files.

### Dev, low and expected

Low assumes web and API run 220 hours (about 10 hours on 22 weekdays), the worker is scaled to zero, one NAT, no WAF, 20 GB through NAT, 2 GB of logs, 2 GB scanned, 5 GB egress. Expected assumes 24/7 tasks, WAF with 5 rules, and the higher traffic figures.

| Line | Low USD | Expected USD |
| --- | --- | --- |
| NAT, 730 hours | 32.85 | 32.85 |
| NAT data | 0.90 | 2.25 |
| Load balancer hourly | 16.43 | 16.43 |
| Load balancer capacity units | 2.92 | 5.84 |
| Three public IPv4 addresses | 10.95 | 10.95 |
| Fargate web 0.25 vCPU / 0.5 GB | 2.72 | 9.01 |
| Fargate API 0.5 vCPU / 1 GB | 5.43 | 18.02 |
| Fargate worker 0.5 vCPU / 1 GB | 0 | 18.02 |
| RDS `db.t4g.micro` single-AZ | 11.68 | 11.68 |
| 20 GB gp3, unverified at $0.115/GB | 2.30 | 2.30 |
| Two KMS keys | 2.00 | 2.00 |
| Six secrets | 2.40 | 2.40 |
| S3, 10 GB | 0.23 | 0.23 |
| Logs | 1.00 | 2.50 |
| WAF | 0 | 10.00 |
| Malware scan | 0.18 | 0.90 |
| Egress | 0.45 | 1.80 |
| Cognito under 10,000 MAU | 0 | 0 |
| **Dev total** | **92** | **147** |

### Staging

Same pattern as dev expected, with `db.t4g.small` ($23.36) instead of micro, and a 1 vCPU worker always on ($36.04 instead of $18.02). Planning range **$170 to $250**.

### Prod

Low: one NAT, WAF, `db.t4g.small` Multi-AZ at the 2× assumption ($46.72), web 0.5 vCPU, two API tasks of 0.5 vCPU, one 1 vCPU worker, 100 GB gp3 doubled for the standby assumption ($23, unverified rate), 20 GB logs, 50 GB scanned, 50 GB egress.

Expected: two NAT gateways, `db.t4g.medium` Multi-AZ at the 2× assumption ($94.90), web 0.5 vCPU, two 1 vCPU API tasks, two 1 vCPU workers, 200 GB gp3 doubled ($46), 50 GB logs, 200 GB scanned, 200 GB egress.

| | Low USD | Expected USD |
| --- | --- | --- |
| Prod infra | 280 | 550 |

The low prod figure is rounded up from a line-by-line sum of about $278. The expected figure is rounded up from about $520. Both move a lot if Multi-AZ is not 2×, if gp3 is not $0.115, or if the first cell is not US East.

### All three environments

Running dev, staging, and prod together: about **$540 low** and **$950 expected** per month in infrastructure, before inference and before Stripe fees.

### Inference, separate from infrastructure

No provider key is provisioned, so this is list price, not a measured tender. Source: OpenAI standard rates fetched 2026-11-22. gpt-4.1-mini is $0.40 per million input tokens and $1.60 per million output tokens. gpt-4.1 is $2.00 and $8.00. Embeddings at text-embedding-3-small ($0.02 per million) are a few cents even for a re-embed of one tender and are omitted from the job total.

Assumed hospital-bed job, not a benchmark: 180,000 input tokens and 20,000 output tokens (extract, matrix, draft, grounding, one revision).

| Model | That job | 20 jobs / month | 100 jobs / month |
| --- | --- | --- | --- |
| gpt-4.1-mini | $0.10 | $2 | $10 |
| gpt-4.1 | $0.52 | $10 | $52 |

A short job at 40,000 in and 8,000 out is about $0.03 on the mini rate and $0.14 on gpt-4.1. A heavy job at 500,000 in and 40,000 out is about $0.26 and $1.32. Residency endpoints for models released on or after 5 March 2026 add 10% on that price list. Stripe fees are not in this table.

Do not approve a paid AWS account from this estimate alone. The founder action is to re-price the chosen region in the AWS calculator and accept a ceiling.

## 5. First 20 engineering tasks

Dependency order. Items already in this repository are marked done. They are not re-done.

1. **Done.** Monorepo, CI, Compose, and the SQL migrations, including the isolation tests.
2. **Done.** Terraform cell for dev, staging, and prod. Validated locally. Not applied.
3. Founder supplies an AWS account, a billing ceiling, and the first region. No one applies Terraform before that.
4. Founder opens a Stripe sandbox that is not the ThirdRoc live account, and names the platform legal entity.
5. Wire Cognito to the `users` table. A Cognito subject maps to one user. Roles stay in `org_memberships`.
6. Session middleware that sets `app.tenant_id`, `app.user_id`, `app.access`, and `app.job_id` from the membership, never from the model.
7. Org and expert registration. An expert cannot become `verified` without a clear, unexpired screening row. The trigger already enforces this.
8. Screening provider adapter with a fail-closed `error` status. `provider = 'test'` stays local-only.
9. Agent studio: create an agent version snapshot (prompt hash, tool list, model route, embedding model, memory snapshot) and publish version 1 as `initial_human`.
10. Listing with Autonomous, Expert Verified, and Expert Led rows: price, currency, delivery days, included revisions, cancellation code, payout release.
11. Order snapshot using `splitServiceAmount`, spend-limit check, and a tax quote. Checkout stops when the quote is `unsupported`.
12. Ledger post for a captured charge in one currency. No Stripe call until the sandbox exists.
13. Upload API: PDF, DOCX, XLSX only; malware status must be `clean` before a chunk exists; object key is `{tenant}/{region}/...`.
14. Chunker that emits page, paragraph, and cell-range locators, including tables, and writes immutable `document_chunks`.
15. Temporal workflow plus the SQS dispatch of the outbox. Activities are idempotent on `(run_id, step name)`.
16. LangGraph activity: extract, matrix, draft, ground. The model is called only through the gateway. With no API key, the activity uses a fixture model in local and refuses in prod.
17. Word and Excel export of the bid and the matrix. Claims marked `supported` must have citations. The database already rejects the rest.
18. Expert review grant and approval for Expert Verified and Expert Led. Autonomous has no review row.
19. Buyer acceptance, then payout obligation. If the payee country has no rail or no clear screening, status is `unsupported_corridor` or `screening_blocked` and the ledger still shows the payable.
20. Run the same isolation tests against the pg16 Docker image, not only PGlite, once Docker is available. This environment had no Docker daemon.

## 6. Parallel workstreams

These are assignments for later cloud agents. None of them were started as separate agents in this run. Each workstream has a branch and a review. They share `packages/db` migrations, so migration numbers are reserved by the person who merges first.

| # | Functional role | Workstream | Owns | Does not touch |
| --- | --- | --- | --- | --- |
| 1 | Identity and tenancy | Cognito login, org membership, session GUCs | `users`, `orgs`, `org_memberships` | Ledger, prompts |
| 2 | Expert trust | Verification and sanctions screening | `expert_profiles`, `compliance_screenings` | Buyer documents |
| 3 | Catalogue | Agents, versions, three service levels, listings | `agents`, `listing_tiers` | Job bodies |
| 4 | Commerce | Orders, tax quotes, ledger, refunds | `orders`, `ledger_*` | Model prompts |
| 5 | Document intake | Upload, malware gate, chunker | `documents`, `document_chunks` | Payouts |
| 6 | Execution | Temporal workflow, SQS, idempotent steps | `job_runs`, `job_queue`, worker | Direct SQL from the model |
| 7 | Memory and retrieval | Four domains, hybrid retrieve, citations | `memory_items`, `app.retrieve_*` | A global cache |
| 8 | Review and delivery | Grants, approvals, docx, xlsx, messages | `approvals`, `job_messages`, exports | Training data |
| 9 | Security and privacy | RLS tests, retention, privacy requests, threat tests | `privacy_requests`, CI security tests | Live customer data |
| 10 | Platform operations | Terraform apply in dev only after approval, logs, budgets | `infra/`, alarms | Production |

## 7. First executable vertical slice

Rahul runs a pharmaceutical distribution business in Pacific markets. He is tendering to supply hospital beds. Moishin is the verified expert who owns the tender-writing agent. The slice ends when Rahul has an editable Word response and an editable Excel matrix, unsupported claims are flagged, and the ledger records the platform fee, creator royalty, and review fee. No certification, capacity, specification, or piece of evidence is invented.

The acceptance tests below are the contract for Milestone 2. They are not yet automated end to end. The database tests in this milestone already cover the isolation, citation, ledger, payout-block, and eval-rollback parts.

**Service level.** Given Moishin publishes Expert Verified at a stated currency, delivery days, two included revisions, and payout after the dispute window, when Rahul checks out, then the order stores those figures and `review_fee_minor > 0`. Given Autonomous, when the order is created, then `review_fee_minor = 0` and no expert approval is required.

**Documents.** Given Rahul uploads a PDF invitation, a DOCX specification, and an XLSX equipment schedule, when intake finishes, then each file is `clean`, stored under his tenant and region, and chunked with page or cell locators. Given an `.exe` renamed to `.pdf`, when he uploads it, then it is rejected.

**Extraction.** Given the invitation says a bidder must show hospital-bed capacity and a regulatory certificate, when extraction runs, then both items exist as requirements with a citation to the source chunk. Given the supplier pack has dimensions and no certificate, when the matrix is built, then the certificate row is `missing_evidence` and the draft does not contain a fabricated certificate number.

**Grounding.** Given a sentence in the draft that is not tied to a chunk from this job, when it is saved as `supported`, then the database rejects it. Given the same sentence saved as `unsupported` or `missing_evidence`, then it is stored and visible to Rahul.

**Isolation.** Given another buyer's tender contains a pricing schedule, when retrieval runs as Rahul, then that schedule is absent even if the query omits a tenant filter. Given Moishin's creator-expertise notes, when Rahul's session selects memory, then those notes are absent. Given an approved reusable lesson, when it is read, then it has no buyer tenant id, and the worker cannot select `memory_provenance`.

**Review and delivery.** Given Expert Verified, when the worker finishes, then the job waits until Moishin approves or requests changes. Given Rahul accepts, then he can download an editable `.docx` and an editable `.xlsx`. Given he leaves a rating, then one rating is stored on the job.

**Money.** Given a captured test payment in the listing currency, when the ledger posts, then debits equal credits in that single currency, and the three commercial parts plus tax equal the charge. Given Moishin's payout country has no rail or no clear screening, then the payable remains and the payout does not move to `processing`. Given the Stripe account available today is the live ThirdRoc account, when this test runs, then it does not call Stripe.

**Learning boundary.** Given the job completes, when a lesson candidate is proposed from Rahul's certificate gap, then it stays a candidate until redaction, IP permission, Rahul's consent, and Moishin's approval. It is not fine-tuning data.

## 8. Risks that need a founder decision

Security:

- Sending a hospital tender to a model in another country is a cross-border disclosure. Until counsel names the lawful transfer tool, an EU or UK tenant's job fails closed rather than using a US-only endpoint.
- RLS stops the application roles. A superuser still bypasses it. The composite foreign keys stop a cross-tenant citation even for a superuser. Production must not give the app or the worker `BYPASSRLS`.
- Prompt objects are buyer data. They go to the tenant prefix in S3. They must not be copied into logs, traces, or the creator's expertise store.
- Holding creator payables can be regulated stored value. The ledger is an accounting record, not a wallet, unless counsel says otherwise.
- No certification (SOC 2, ISO, or otherwise) is claimed. A penetration test happens before unrestricted release, and the founder names the tester.

Commercial:

- Who the contracting entity is. A Fijian resident founder cannot open the platform Stripe account in Fiji. An Australian entity can charge many buyer countries and pay Australian connected accounts. Worldwide creator payouts need a second rail and, for Connect cross-border, a platform entity in a country Stripe supports for that product (the self-serve list fetched on 2026-11-22 was US, UK, EEA, Canada, and Switzerland).
- The live ThirdRoc Stripe account is the wrong account for Orbexa development and probably the wrong account for the platform.
- Who eats a chargeback. The recommended posture is that Orbexa is merchant of record, payouts wait until funds are available, and the platform bears the dispute. That is a loss-allocation decision.
- The numeric fee schedule, the rounding rule (remainder to the creator), GST/VAT registration countries, and whether displayed prices are tax-inclusive in some countries.
- The first AWS region and the monthly ceiling. The estimate above is not an approval to spend.

## 9. Actions required from the founder

Do these. Engineering cannot invent the answers.

1. Confirm the legal entity that will contract with buyers and with Stripe. Name the country of that entity.
2. Create a Stripe sandbox that is not the ThirdRoc live account. Leave ThirdRoc unused by this codebase.
3. Choose the payout pair: Stripe Connect for supported corridors, and Wise or a named alternative for the rest. Ask that provider whether Fiji and the other Pacific countries on the creator list can be paid.
4. Choose the first AWS region and a monthly infrastructure ceiling. Do not treat section 4 as that approval.
5. Name the screening vendor. Until then, no expert can be verified in any environment except local fixtures.
6. Name counsel's position on Orbexa as merchant of record, on tax registrations, and on sending tender files to a model outside the buyer's region.
7. Accept or replace the proposed retention rows (`execution_memory` 7 days, `buyer_private` 90 days, prompts 90 days, financial records 7 years). They are `proposed` and are not applied.
8. Accept or replace the eval rule: a later agent version publishes only when a passing score is strictly greater than the previous version's score on the same suite.
9. Name the independent reviewer for Milestone 4. That person is not the author of the release.
10. Say when real customer documents may be uploaded. Until that sentence, Milestone 2 uses Rahul and Moishin fixtures and founder-owned files only.

Material paid infrastructure, a production deploy, a production security change, real customer data, a live financial transaction, public content, contacting customers, deleting production data, and a change to the data-ownership rules each need a separate yes.
