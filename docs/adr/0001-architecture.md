# ADR 0001: System shape

- Status: Proposed
- Date: 2026-11-22

## Context

Orbexa is a marketplace where verified people publish agents and buyers purchase an outcome. The first outcome is a hospital-bed tender response for a Pacific pharmaceutical distributor. The product is global: many currencies, many countries, and a data region chosen per tenant. Milestone 1 has to carry that without building the marketplace screens.

## Decision

- `apps/web` is Next.js and TypeScript.
- `services/api` is one TypeScript process. Modules live inside it. It is not split into services.
- `workers/ai` is the only separate process, because it parses untrusted PDF, DOCX, and XLSX.
- PostgreSQL is the system of record. pgvector stores embeddings in the same database, with the tenant predicate and row-level security on the same query.
- Objects live in S3-compatible storage with SSE-KMS. Local development can point at the same API later. Compose in this milestone runs Postgres only.
- Money is integer minor units plus an ISO currency. The exponent lives in `currencies`. Checkout stays disabled until a currency is explicitly enabled.
- The three service levels are `autonomous`, `expert_verified`, and `expert_led`.

## Alternatives

A second TypeScript service per domain was considered. One order path does not need a network hop between catalogue and ledger. The worker is the exception because a malicious spreadsheet must not share a process with the ledger.

Prisma was considered. The schema uses row-level security, deferred constraints, and pgvector. SQL migrations keep those in one language.

A separate vector database was considered. It would split the backup story from the tenant predicate. pgvector keeps both in one query.

## Consequences

New product code lands in the existing API or the worker. A new deployable needs an ADR. Adding a currency is an insert into `currencies`, then a founder decision to set `checkout_enabled`.
