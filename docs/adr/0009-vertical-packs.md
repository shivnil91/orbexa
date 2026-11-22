# ADR 0009: Vertical packs

- Status: Proposed
- Date: 2026-11-22

## Context

Orbexa is a marketplace of verified specialists. Tender writing is the first vertical, used to prove the hospital-bed slice. The founder requires the core to stay vertical-agnostic: a new specialist category is configuration, not a code change to experts, agents, listings, jobs, orders, deliverables, pricing, reviews, memory, or payouts.

## Decision

- `verticals.code` is the category. Agents, listings, and expert profiles already point at it. Orders copy `vertical_code` from the listing. The copy is a label. Pricing, tax, the ledger, ratings, and payout screening do not branch on it.
- `vertical_revisions` holds the job schema for that category: a JSON Schema object for the intake form, deliverable type codes, a rubric, and an ordered workflow. Inserting a revision onboards the category. `job_intakes` stores the buyer's payload and rejects it when it misses the schema.
- Document kinds `evidence` and `expert_credential` are platform-wide. Any other kind must be declared by the latest revision of the job's vertical. `tender_source` and `bid_docx` are data on the tender-writing revision, not a permanent check constraint.
- The worker compiles whatever stage list the pack declares. Document text cannot add or skip a stage. The tender stages `extract`, `matrix`, `draft`, and `ground` live in `workers/ai/src/orbexa_ai/verticals/`. The fixture model that knows about certificates and bed width lives in that pack. A vertical with no Python module still runs its declared stages.
- The intake validator accepts a JSON Schema subset: object, properties, required, additionalProperties, and property types string, number, integer, and boolean, plus enum and minLength. The same rules are enforced in SQL, the API, and the worker.

## Alternatives

One table per vertical was rejected. It would make a new specialist a migration.

A full JSON Schema draft in the database was rejected. The subset covers intake forms. A later revision can widen it without renaming the column.

Making the tender Temporal class the only workflow was rejected for new categories. The in-process runner follows the declared list. Tender's Temporal workflow remains the durable implementation of that one pack.

## Consequences

A grant-writing category can be inserted, sold, and given an intake form and a deliverable type without a migration. Custom extraction or grounding still means a Python pack. That limit is below.

## Remaining tender coupling

These still assume the first vertical. They were left in place because changing them would rewrite the hospital-bed slice rather than the core model.

- `POST /v1/demo/hospital-beds`, `fixtures/hospital-beds`, and the default `FixtureGateway` implement the tender pack. A second vertical does not get that fixture unless it registers one.
- Temporal `TenderJob` is the durable workflow for tender stages. Other verticals use the in-process stage runner. They do not have their own Temporal workflow class.
- Tool catalog seeds `read_chunk`, `write_artifact`, and `flag_claim`. Adding a tool is still a migration.
- The seeded tender revision lists `tender_source`, `supplier_info`, `bid_docx`, and `bid_xlsx`. Those names remain in the first pack's data.
- Web and README copy still describe the hospital-bed demo.
- Memory domains, ledger accounts, service levels, and payout providers are already generic and were not branched for tenders.
