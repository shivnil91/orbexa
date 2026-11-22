# Threat model

Method: STRIDE against the assets that matter for a multi-tenant tender marketplace. This is a design review, not a penetration test and not a certification.

## Assets

Buyer tender files, supplier evidence, drafts, prompt objects, creator methods, approved lessons, the ledger, payout instructions, and the credentials that can reach any of those.

## Actors

A curious buyer, a malicious bidder, a compromised expert, a compromised worker process, a poisoned document, a dependency update, and an operator with a production role. We do not model a cloud-provider insider beyond using their KMS and audit logs.

## Multi-tenant isolation

| Threat | What we do | Residual |
| --- | --- | --- |
| Spoofing a tenant id from the client | Session sets the GUC from membership | A bug that sets the wrong membership still sees that tenant |
| Tampering with another tenant's chunk | Composite foreign keys include `tenant_id` | Tested as superuser: the insert fails |
| Repudiation of a read | `retrieval_events` and `audit_log` are append-only | They do not store the document body |
| Information disclosure via a forgotten `WHERE` | `FORCE ROW LEVEL SECURITY` on private tables | Superuser and `BYPASSRLS` still see everything. App roles are neither. Tested. |
| Denial of service | Per-job budget, rate-limit rows, SQS and WAF in the cell | Not load-tested |
| Elevation | Platform roles only on a platform org. The trigger rejects them elsewhere | A stolen platform session is still serious |

## RBAC and resource grants

Org membership is not access to a buyer's files. An expert reads a job through `job_grants` for that job, in the buyer tenant, with an audit row. Creator-org membership does not copy the tender into the creator tenant.

## Prompt injection

Tender files are hostile input. The graph does not branch on their text. The model has no tool that sends email, fetches a URL, or changes `app.tenant_id`. Outputs that claim support without a citation are rejected by the database. This reduces the blast radius. It does not make the model incapable of being confused. Milestone 4 adds a fixture set of injection documents and checks that no foreign tenant id appears in the draft.

## Tool sandbox

The worker container is non-root in the task definition we will ship with the real image. The skeleton image is a placeholder and is not running. The worker task role cannot read the API secret. Egress in the security group is 443 and Postgres. There is no shell tool. Side-effect tools cannot be attached to a version.

## Cross-buyer learning

Approved lessons have a null tenant id and must be scrubbed. Provenance is not granted to the worker. The cache primary key includes the tenant. Execution memory is run-scoped and purged. Buyer-private rows with a `job_id` do not appear in another job. Tests in `schema.integration.test.ts` cover these cases on PGlite (PostgreSQL 18.7). They have not been re-run on the pg16 Docker image.

## Payment fraud

The platform is merchant of record in the proposed design, so a stolen card becomes our dispute. Payouts do not proceed without screening. Webhooks, when a sandbox exists, are verified and stored under an idempotency key. Ledger lines are immutable. The live ThirdRoc account is out of scope and was not called.

## Secrets and autonomous agents

Product workers read one secret prefix. Coding agents in this environment have no AWS credentials and no model keys. CI on pull requests gets no cloud role. Production apply waits for a protected GitHub environment, which does not exist yet because GitHub is not connected. Break-glass is a human with MFA, not an agent.

## Supply chain

pnpm and the Python package are locked by install files once committed. CI runs `pnpm audit --audit-level=high` and `pip-audit`. Actions are pinned by commit SHA. Dependabot is configured. The Terraform AWS provider was initialized at v5.100.0 during validate. No production image is built.

## Supply of documents

Malware status starts at `pending`. A chunk should not be created before `clean`. The schema allows the column. The scanner is not deployed. Zip bombs, XXE in DOCX, and formula injection in XLSX are in the chunker task, which refuses macro execution and external entities and does not evaluate formulas.

## Residency

A job for a tenant whose `home_region` is not this cell cannot insert. That blocks the "just store it in Virginia" failure. It does not choose the lawful region. That is a founder and counsel decision.
