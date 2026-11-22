# ADR 0005: Residency, privacy, locale, and time zone

- Status: Proposed
- Date: 2026-11-22

## Context

Buyers and experts are worldwide. GDPR, UK GDPR, the Australian Privacy Act, and the CCPA/CPRA can all apply to the same product, depending on the person and the entity. This ADR does not assert that the product is compliant with any of them.

## Decision

- Each organisation has `country_code`, `home_region`, `default_locale`, and `default_time_zone`.
- Users have `locale`, `time_zone`, and confirmation flags. New users default to `en` and `UTC` until they confirm. Job creation in Milestone 2 waits on confirmation.
- `processing_regions` lists candidate cells: `ap-southeast-2`, `eu-central-1`, `eu-west-2`, `us-east-1`. None are `active` in the migration. `cell_identity` is one row per database, inserted by deploy or by the local seed. Private inserts fail if the row is missing or the region does not match.
- Orgs may name a home region that is not this cell. Their documents may not be written here. That is how a tenant waits for the right cell.
- Timestamps are `timestamptz`. The UI formats with `Intl` and an explicit IANA zone. The web test checks that 2026-11-22 12:00 UTC is a different civil date in Auckland and in London.
- Locales use BCP 47. The only message catalog shipped is `en`. The route is `/en`.
- `privacy_requests` records access, delete, export, correction, and restriction. Processing them is Milestone 4, before real customer data.
- `retention_policies` are `proposed`. Purge uses `retain_until` on the row. The tested purge redacts expired execution memory to `[purged]`.
- Prompt and tool bodies are object keys under `{tenant}/{region}/`. OpenTelemetry spans may carry model name, token counts, latency, tenant id, and agent version. They may not carry prompt text or document text.

## Alternatives

One global bucket with a prefix, and a promise to "respect residency in the application", was rejected. The cell trigger is the backstop when a restore or a bug targets the wrong database.

Guessing a legal regime from a country code inside the database was rejected. Country is stored. Counsel maps it.

## Consequences

Adding a region is a new cell, not a schema change. Moving a tenant later is a project of its own and copies documents only with a recorded transfer basis.
