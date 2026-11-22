# ADR 0008: Milestone 4 readiness work

- Status: Proposed
- Date: 2026-11-22

## Context

Milestone 4 in `docs/backlog.md` is production readiness: a restore drill, ledger reconciliation, load and abuse limits, a privacy drill, a third-party penetration test, dashboards, a BM25 swap, and a second region. No AWS account is connected. The only Stripe account previously connected to the authoring environment is a live ThirdRoc account and is not used. No penetration test has been commissioned.

## Decision

- Postgres `ts_rank_cd` stays the default lexical rank inside `app.retrieve_chunks`. The function signature does not change. Setting `app.lexical_scorer` to `bm25` selects an in-database Okapi BM25 score because the pgvector image does not include ParadeDB. A phrase-overlap reranker reorders candidates in the worker, outside SQL. It is not a neural reranker.
- The worker keeps the fixture gateway unless `LLM_PROVIDER` is `anthropic` or `openai` and the matching API key is set. xAI stays blocked. Payments stay on the fake provider unless `PAYMENT_PROVIDER=stripe` and `STRIPE_TEST_SECRET_KEY` begins with `sk_test_`. Any environment value containing `sk_live_` refuses process start. Tests and CI do not set these variables.
- Reconciliation compares ledger sums to a sandbox-day report. A mismatch sets `pageHuman` on the result. Nothing pages a vendor and nothing moves live money.
- Privacy export and delete run inside the current cell. Delete redacts buyer-private text, including a ledger memo, and does not change ledger amounts. Another region's database is out of reach.
- The second region is a separate Terraform root, `infra/envs/prod-eu-central-1`, region `eu-central-1`, cell name `prod-euc1`. It is not applied. It declares no tenant copy, no DMS task, and no bucket replication.
- The restore drill that CI runs is a local logical snapshot of a chunk row and a versioned local object store. It records a timing. It does not restore RDS or S3, because those APIs are not called.
- The penetration-test item stays open. The repository records `performed: false` and claims no certification.

## Alternatives

Calling Stripe or a model provider from the default test path was rejected. CI would then depend on secrets.

Marking the penetration test done from an internal fixture run was rejected. A fixture is not a third-party report.

Activating `eu-central-1` inside the local database was rejected. A region is a new cell.

## Consequences

Security and payment code in this milestone needs independent review before any real charge or any customer data. The founder still has to apply Terraform, create a Stripe test account, name a penetration tester, and name a reviewer who did not write the release.
