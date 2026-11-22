# Engineering status

Checked on 2026-11-22 after Milestone 2. Commands below were run in this environment. Anything not listed was not run.

## What works

A local hospital-bed transaction runs without AWS, Stripe, or a model API:

- Moishin is inserted as a verified expert and the listing has Autonomous, Expert Verified, and Expert Led rows.
- Rahul checks out Expert Verified through `FakePaymentProvider`. The webhook signature is verified. A second delivery of the same event does not post the ledger twice.
- The ledger posts one USD transaction: platform fee, creator royalty, and review fee. Debits equal credits. A separate test posts JPY without mixing it into the USD transaction. A refund reversal balances.
- The fixture model reads the fictional pack in `fixtures/hospital-beds`, extracts the capacity and certificate requirements, marks the certificate and the quantity as missing evidence, and cites 950 mm only because that width is in the supplier note.
- Expert Verified waits for Moishin. After approval and Rahul's acceptance, `bid_docx` and `bid_xlsx` rows exist. The Python test rewrites both files and reads the edit back.
- A rating is stored. A lesson candidate stays `proposed`.
- Rahul's session does not see the other buyer's pricing chunk.
- A payout to `processing` is rejected because there is no clear payout screening.
- Selecting `PAYMENT_PROVIDER=stripe` throws. The end-to-end slice records `stripeCalls: 0`.
- Selecting `LLM_PROVIDER=openai` throws, including when a dummy key is set. No HTTP client is called.
- A Temporal Python SDK 1.36.1 test server runs a workflow that waits for an approve signal. The tender slice itself uses the in-process activity runner in `workers/ai/src/orbexa_ai/workflow.py`, not that server.

`POST /v1/demo/hospital-beds` on the API repeats the slice and returned `reviewFeeMinor: "15000"`, `mentionsWidth: true`, `stripeCalls: 0`.

## What was run

| Command | Result |
| --- | --- |
| `pnpm --filter @orbexa/api test` | Exit 0. 8 tests, including the end-to-end slice. |
| `pnpm --filter @orbexa/api lint` and `typecheck` | Exit 0. |
| `pnpm --filter @orbexa/db test` | Exit 0. 24 tests. |
| `pnpm --filter @orbexa/web test`, `lint`, `typecheck` | Exit 0. 3 tests. |
| `ruff check .`, `mypy`, `pytest -q` in `workers/ai` | Ruff clean. mypy clean on 13 files. 14 tests passed. |
| `pip-audit` | No known vulnerabilities. Local package `orbexa-ai` is skipped. |
| `curl -X POST http://127.0.0.1:43124/v1/demo/hospital-beds` | HTTP 200 and the JSON summary above. |
| `curl http://127.0.0.1:43123/en` | HTTP 200. Body mentions the fixture model. |
| `curl http://127.0.0.1:43124/health` | `{"service":"orbexa-api","status":"ok"}` |

## What is stubbed

- Payments: `FakePaymentProvider` signs webhooks with HMAC-SHA256. `createStripeStub` throws on every method. Nothing in the slice imports a Stripe SDK and nothing is sent to Stripe.
- Models: `FixtureGateway` is rule-based over the fictional pack. Anthropic, OpenAI, and xAI are `BlockedLiveGateway`. `complete` raises even if an env key is present.
- Documents: generated PDF, DOCX, and XLSX under `fixtures/hospital-beds`. They are labeled fictional. There is no malware scanner service. `scan_upload` rejects unknown types and MZ/ELF bytes, and marks the fixture files clean.
- Object storage: deliverable rows store a key and a hash. Bytes are not uploaded to S3. The editability test rewrites the bytes in process.
- Workflow durability for the slice: in-process `WorkflowState.activity`. Temporal's test server is covered by `tests/test_temporal_gate.py` only. `docker compose` was not started. Docker is still not installed, so the Temporal dev server container was not run.
- Expert verification uses `provider = 'test'` because the cell environment is `local`. That value is rejected outside local by the database trigger.
- No Cognito login. The slice inserts users directly.

## Defects

- The slice runner and the Temporal workflow are two pieces. Killing a process mid-extract does not resume through Temporal. The in-process runner only deduplicates activities inside one process.
- Deliverable files are not round-tripped through the database, only their metadata.
- Schema tests and the slice still use PGlite (PostgreSQL 18.7), not the pg16 image in Compose.
- The demo route has no authentication. It is a local fixture runner, not a buyer API.
- Listing discovery is an SQL insert of a published listing, not a search UI.

## Servers left running

- Web on port 43123.
- API on port 43124.
