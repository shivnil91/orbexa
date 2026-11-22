# Orbexa

Orbexa is a marketplace where verified experts publish agents and buyers purchase a finished outcome. The first outcome is tender writing. Milestone 2 runs that transaction locally, with fake payments and a fixture model.

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

## Status

What was actually run is in [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md).
