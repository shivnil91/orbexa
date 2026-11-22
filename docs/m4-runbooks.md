# Milestone 4 runbooks

These procedures were written with the code in this repository. Where a step needs AWS, Stripe live mode, or a named reviewer, that step has not been executed. No certification is claimed.

## Restore

CI does two local drills.

1. A versioned directory stands in for S3 versioning. The test writes a chunk, overwrites it, reads the prior version, and records `elapsed_ms`. `aws_s3_get_object_version` is false.
2. A chunk row is serialized, deleted, and inserted into the same Postgres database from that snapshot. The test reads the body back and records `elapsed_ms`. On `pnpm test` the engine is PGlite. On `pnpm --filter @orbexa/db test:pg16` the engine is PostgreSQL 16. `aws_rds_snapshot_restore` is false.

The operator steps below are the ones a human with credentials would run later. They were not run. Do not run them from a coding agent.

- RDS: `restore-db-instance-to-point-in-time` into a new instance in the same region, then `SELECT` the chunk by id. Snapshots stay in the region. Copying a snapshot to another region is a residency decision.
- S3: `aws s3api get-object --version-id` for the storage key. Versioning is enabled on the bucket in Terraform. That bucket has not been created.

A privacy delete on the local store overwrites every version of the key with `[redacted]`. An S3 delete of old versions is a separate operator action and was not run. Backups inside the RDS retention window can still hold a copy until they age out. Say that to a buyer before real data is accepted.

## Reconciliation

`reconcileSandboxDay` compares captured and refunded minor units per currency. A difference returns `pageHuman: true` and a page record with severity `page`. That record is the handoff to a human. There is no PagerDuty integration and no call to the live ThirdRoc account.

The Stripe test adapter can request `GET /v1/balance_transactions` only when `STRIPE_TEST_SECRET_KEY` starts with `sk_test_` and the caller supplies a transport. Tests use a fake transport. CI does not set the key.

## Load and abuse

A job stops when the next `llm_invocations` row would pass `job_budgets`, and when `app.consume_rate_limit` finds `requests_per_minute` events in the last minute. The worker `RunBudget` stops before an HTTP call. These are unit and database tests. They are not a load test of the load balancer.

The WAF on the cell is `AWSManagedRulesCommonRuleSet` from vendor `AWS`, associated with the ALB. That is the rule set in `infra/modules/cell/main.tf`. It has not been deployed.

## Privacy

`app.fulfill_privacy_request` exports or deletes one org in this cell.

- Export returns that org's document text, memory, order amounts, and ledger lines. Another org's chunk text is not in the payload.
- Delete sets buyer-private and execution bodies, lesson text, messages, and citation quotes to `[redacted]`, revokes lessons whose provenance points at the org, and sets a ledger memo to `[redacted]` without changing `amount_minor`.
- `access`, `correct`, and `restrict` raise. They are stored and not processed.
- The function checks `app.current_tenant()` when a tenant is set. A second cell is another database. This function cannot see it. Run the same request in each cell that holds the org. With one cell, one database is the whole story.

The drill uses a fixture org and the marker `FIXTURE_TENDER_ALPHA`. It is not a customer tender.

## Penetration test

Not performed. No third party is named. No independent reviewer is named. `workers/ai/src/orbexa_ai/release_review.py` records that, and the tests fail if a certification flag is turned on. Injection fixtures check that a foreign tenant id in a hostile document does not appear in the fixture draft, and that a draft which names another tenant is rejected. That is not a penetration test.

## Dashboards

`app.agent_version_metrics` groups `run_metrics` and `llm_invocations` by agent version and currency. It reports grounded-claim rate, latency, cost per job, mean invocation cost, and the share of jobs with more than one draft. The web page at `/en/dashboard` renders a fixture of that shape and says so on the page.

## Second region

`infra/envs/prod-eu-central-1` is a new cell in `eu-central-1` with `cell_name = prod-euc1`. `desired_count` stays 0. Applying it would create billable resources. Do not apply it. Tenants whose `home_region` is not this cell cannot insert private rows here, and nothing in the module copies them.
