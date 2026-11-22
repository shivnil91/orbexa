# Orbexa

Orbexa is a marketplace where verified experts publish agents and buyers purchase a finished outcome. The core is a vertical: intake, deliverables, rubric, and workflow are data on `vertical_revisions`. Tender writing is the first pack, not a hardcoded category. Milestone 2 runs that pack locally, with fake payments and a fixture model.

The design notes are in `docs/`. Start with [docs/first-response.md](docs/first-response.md).

## Local setup

Node 22 and pnpm 10.33.4. Python 3.12 for the worker.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

```bash
python3 -m venv workers/ai/.venv
source workers/ai/.venv/bin/activate
pip install -e "./workers/ai[dev]"
ruff check workers/ai
cd workers/ai && mypy && pytest
```

Postgres and the Temporal dev server:

```bash
docker compose up
```

`pnpm test` applies the schema on PGlite. `pnpm --filter @orbexa/db test:pg16` applies the same suite to Postgres 16 with pgvector at `127.0.0.1:5432`, database `orbexa_test`, user `orbexa`, password `orbexa_local_only`. Docker Compose was not required for that run.

Copy `.env.example` to `.env` for local URLs. Leave the Stripe and model keys empty. The only Stripe account connected to the authoring environment is a live ThirdRoc account and must not be used.

Web dev server:

```bash
pnpm --filter @orbexa/web exec next dev --hostname 0.0.0.0 --port 43123
```

API:

```bash
pnpm --filter @orbexa/api start
```

The API listens on port 43124 and answers `GET /health`. `POST /v1/demo/hospital-beds` runs the local fixture only when `ORBEXA_ENV` is unset, `local`, or `dev`.

## Terraform

`infra/` is a skeleton. `terraform validate` has been run. `terraform apply` has not, and should not, until the founder approves the spend.

## Dev container images

`apps/web/Dockerfile` is the API image. `workers/ai/Dockerfile` is the worker image. Both build for `linux/amd64` and `linux/arm64`. Neither image contains API keys or database passwords.

```bash
PLATFORM=linux/amd64 ./scripts/build-and-push-dev.sh
```

`PLATFORM` defaults to `linux/arm64`. Use `linux/amd64` on an x86_64 machine that cannot emulate arm64. That build is native. Before the ECS task runs those images, set the dev stack variable `task_cpu_architecture` to `X86_64`. The variable defaults to `ARM64`, which only starts `linux/arm64` images.

The script logs into ECR with the AWS CLI's current profile, reads `terraform -chdir=infra/envs/dev output -raw ecr_repository_url`, and pushes `api-<git short sha>` and `worker-<git short sha>` to that one repository (`aws_ecr_repository.app` in `infra/modules/dev-stack`). It prints both image URIs.

The API listens on `PORT` (default `43124`) and answers `GET /health`. On start, when `DB_HOST` is set, it URL-encodes `DB_PASSWORD`, sets `DATABASE_URL` with `sslmode=require` (and `uselibpqcompat=true`, so node-pg keeps libpq's meaning of require), and applies pending files in `packages/db/migrations` under a session advisory lock. Each file is one transaction, recorded in `schema_migrations`. A live Stripe secret (`sk_live_` or `rk_live_`) aborts startup. A one-off migration, without starting the server, is the same image with command `migrate`:

```bash
docker run --rm \
  -e DB_HOST -e DB_PORT -e DB_NAME -e DB_USER -e DB_PASSWORD -e DB_SSLMODE \
  <api-image> migrate
```

On ECS, the one-off task command override is `["migrate"]`. Leave `DB_HOST` unset to serve `/health` without a database. `DB_SSLMODE`, when set, must be `require`.

API environment: `PORT`, `ORBEXA_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`, `TEMPORAL_ADDRESS`, `DOCUMENT_BUCKET`, `WORK_QUEUE_URL`, `STRIPE_SECRET_KEY`. The entrypoint creates `DATABASE_URL` from the `DB_*` variables. The dev task also injects `STRIPE_TEST_SECRET_KEY` from the same Stripe test secret; the web app reads that name.

Worker command: `python -m orbexa_ai.serve 127.0.0.1:7233 orbexa-dev`. It reads `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from the process environment only. The image does not set them.

## Status

What was actually run is in [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md).
