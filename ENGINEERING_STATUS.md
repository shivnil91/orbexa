# Engineering status

Checked on 2026-11-22 after the Milestone 2 defect fixes. Commands below were run in this environment. Anything not listed was not run.

## What works

The hospital-bed slice still runs without AWS, Stripe, or a model API. The five defects from the previous status are fixed as follows.

1. The tender job that the API slice shells out to is the Temporal workflow `TenderJob`: extract, matrix, draft, an approve signal when the service is not autonomous, then deliver. Each activity writes its result under a store directory before it returns, and a retry reads that file. `tests/test_temporal_resume.py` starts a worker process, waits until extract has been written, sends SIGKILL, starts a second worker, and signals approval. The extract computation counter stays `1`. The first attempt's process id is the killed process, and a later attempt runs in a different process. The delivered DOCX contains `950 mm`. The XLSX contains `regulatory certificate` and `invitation.pdf page 1`. The workflow status is `waiting_for_buyer`.
2. `persistWebhook` inserts `idempotency_keys` (scope `webhook`) and the ledger lines in one transaction. A second delivery of the same event id returns the existing transaction. A reuse with a different payload is rejected. The slice calls it twice. A separate test opens two `pg` clients against Postgres 16 and posts the same signed fake webhook from both; one ledger transaction is stored, debits equal credits at `100000`, and there is one webhook key.
3. Deliverable bytes are written under `.local-object-store/` (gitignored). The end-to-end test reads those bytes back, checks the ZIP header, matches `sha256` and `byte_size` to the `documents` row, and parses the DOCX and XLSX. The prose includes `950 mm`. The grid includes the certificate gap and `invitation.pdf page 1`.
4. `pnpm --filter @orbexa/db test` still applies the schema on PGlite. `pnpm --filter @orbexa/db test:pg16` applies the same schema tests to PostgreSQL 16.15 with pgvector 0.6.0. Docker is not installed. Postgres was installed in this VM and is listening on `127.0.0.1:5432`.
5. `POST /v1/demo/hospital-beds` is registered only when `ORBEXA_ENV` is unset, `local`, or `dev`. `prod` and `staging` do not register it. `GET /health` stays available.

`POST /v1/demo/hospital-beds` on the local API returned `reviewFeeMinor: "15000"`, `mentionsWidth: true`, `stripeCalls: 0`.

## What was run

| Command | Result |
| --- | --- |
| `ruff check .`, `mypy`, and `pytest -q --tb=line` in `workers/ai` | Ruff clean. mypy clean on 16 files. 15 tests passed. |
| `pnpm --filter @orbexa/db exec tsc --noEmit` and `eslint .` | Exit 0. |
| `pnpm --filter @orbexa/db test` | Exit 0. 24 tests on PGlite. |
| `pnpm --filter @orbexa/db test:pg16` | Exit 0. 19 schema tests on PostgreSQL 16.15, pgvector 0.6.0. |
| `pnpm --filter @orbexa/api exec tsc --noEmit` and `eslint .` | Exit 0. |
| `pnpm --filter @orbexa/api test` | Exit 0. 10 tests, including the byte round-trip and the two-session webhook test. |
| `psql` `SELECT version()` on `orbexa_test` | `PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. |
| `psql` `SELECT extversion FROM pg_extension WHERE extname = 'vector'` | `0.6.0`. |
| `curl http://127.0.0.1:43124/health` | `{"service":"orbexa-api","status":"ok"}` |
| `curl -X POST http://127.0.0.1:43124/v1/demo/hospital-beds` | HTTP 200 and the JSON summary above. |
| `ORBEXA_ENV=prod PORT=43125` API, `curl http://127.0.0.1:43125/health` | HTTP 200. |
| same server, `curl -X POST http://127.0.0.1:43125/v1/demo/hospital-beds` | HTTP 404 `{"error":"not_found"}`. That process was then stopped. |
| `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:43123/en` | `200` |

`pip-audit`, the web package checks, and GitHub Actions were not re-run. The workflow file now starts `pgvector/pgvector:0.8.7-pg16` and runs `test:pg16`, but Actions has not executed it.

## What is stubbed

- Payments: `FakePaymentProvider` signs webhooks with HMAC-SHA256. `createStripeStub` throws on every method. Nothing in the slice calls Stripe. The only connected Stripe account is the live ThirdRoc account and was not used.
- Models: `FixtureGateway` is rule-based over the fictional pack. Anthropic, OpenAI, and xAI are `BlockedLiveGateway`.
- Documents: generated PDF, DOCX, and XLSX under `fixtures/hospital-beds`. They are labeled fictional. There is no malware scanner service.
- Object storage: a local directory keyed by `storage_key`. Bytes are not uploaded to S3.
- Workflow durability: the Temporal Python SDK 1.36.1 time-skipping test server, which is a separate Java process. The worker is killed with SIGKILL and a second worker resumes the same workflow. Docker is not installed, so `docker compose` and `temporalio/temporal` were not started. Temporal Cloud was not used. The Java server writes a warning that it does not advertise `activity_failure_include_heartbeat` (it is older than server 1.16.0). The exactly-once check uses the activity file and the second process id, not heartbeat details.
- The older in-process runner in `workers/ai/src/orbexa_ai/workflow.py` is still what `tests/test_milestone2.py` calls. The CLI and the API slice use `TenderJob`.
- Expert verification uses `provider = 'test'` because the cell environment is `local`.
- No Cognito login. The slice inserts users directly.

## Defects

- Listing discovery is an SQL insert of a published listing, not a search UI.
- The demo route has no user authentication inside local and dev. A process with `ORBEXA_ENV=prod` or `staging` does not mount it.
- The Temporal test server is not the production server. A crash of that server process itself is not what the kill test covers. The kill test covers the worker.

## Servers left running

- Web on port 43123.
- API on port 43124, with `ORBEXA_ENV` unset, so the demo route is on.
