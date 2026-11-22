# Data ownership

## Classes

| Class | Who owns it | Who can retrieve it | Reuse |
| --- | --- | --- | --- |
| Creator expertise | Creator org | That creator's sessions, and the worker session scoped to the creator org while serving that creator's agent | The creator's later versions. Not other creators. Not as buyer content. |
| Buyer-private | Buyer org | That buyer, and a granted reviewer, inside the job or the buyer's own library | Not another buyer. Not another job when `job_id` is set. |
| Execution | Buyer org, for one run | That run | Purged. Never cited. Never embedded. |
| Approved reusable intelligence | Creator org, after consent | Sessions whose current agent is that agent, and the owner | Only after scrubbing, IP clearance, and consent. Revocation hides it. |
| Job commercial record | Buyer for the invoice, platform for the ledger | Buyer finance sees the buyer's ledger. Platform finance sees the cell. Creators see `payout_obligations`, not the tender. | Retained for the financial period counsel sets. |
| Prompt and tool trace | Buyer | Buyer tenant, operators under the same RLS | Same retention as the job. Not a training set. |

## The guarantee

A retrieval, prompt, export, log line, lesson, or embedding produced for buyer B does not contain buyer A's content, identifiers, or commercial terms. The mechanisms are separate rows, a tenant predicate inside `app.retrieve_chunks`, row-level security that still filters when the predicate is omitted, composite foreign keys on citations, a cache key that includes the tenant, and a provenance table the worker cannot read. The tests assert those behaviors. They do not assert it for a superuser.

## Consent

Absence of a `consent_grants` row means no reuse. A grant is `same_region_abstracted_lesson` or `cross_border_abstracted_lesson`, lawful basis `consent`. Cross-border is off unless that grant exists and the lesson row is `transferable`, scrubbed, and clear on PII, confidentiality, and IP. Buyer-private text is never the thing that moves. The lesson text is.

Creator expertise written by the creator does not need the buyer's consent. It also must not be a paste of the buyer's file. That distinction is an insertion-time check in Milestone 3, plus the scope constraints already in the table.

## IP

`source_permissions.permission` is `owner_authored`, `licensed`, `public`, or `unknown`. `unknown` forces `may_quote` and `may_paraphrase` off. Drafting may cite a chunk only when the permission allows it. A claim about a certificate needs a citation to a chunk that actually contains that certificate.

## Audit

Append-only `audit_log` for reads of documents, exports, lesson publication, consent changes, and ledger posts. Metadata only. No document body and no prompt body. Financial rows and the audit log outlive a deletion request. The proposed retention row is 7 years and is not active. Backups stay in the cell and age out with the backup window, so a delete is not instant in every copy. That limit is stated to the buyer before real data is accepted.

## Deletion

A privacy request of kind `delete` redacts buyer-private and execution rows, deletes or revokes lessons whose provenance points at that buyer, and leaves ledger lines that contain amounts and ids but not tender text. The request row is stored in the tenant's cell. Acting on it across every cell is a Milestone 4 runbook. With one cell, one database is the whole story.

## What learning may store

A lesson candidate can be stored in the buyer cell. It becomes approved reusable only after the checks in `docs/agent-architecture.md`. It is not used to fine-tune a shared model. Measurable improvement is a higher eval score on the same suite, not a vibe.
