# Engineering status

Milestone 1 scaffold, checked on 2026-11-22. Commands below were run in this environment. Anything not listed was not run.

## What exists

- Architecture notes in `docs/`, including `docs/first-response.md` and `docs/agent-architecture.md`.
- SQL migrations in `packages/db/migrations`, applied only inside the test process.
- A Next.js page at `/en` and an API `GET /health`.
- A Python worker skeleton that classifies uploads, checks claim citations, and runs a four-node LangGraph with no model call.
- Terraform for a dev, staging, and prod cell. Validated. Not applied.
- `docker-compose.yml` for Postgres with pgvector and the Temporal dev server. Not started. Docker is not installed here.

## What was run

| Command | Result |
| --- | --- |
| `pnpm --filter @orbexa/db test` | Exit 0. 24 tests, 0 failed. Schema applied on PGlite 0.5.17, which reports PostgreSQL 18.7. |
| `pnpm --filter @orbexa/db typecheck` | Exit 0. |
| `pnpm --filter @orbexa/db lint` | Exit 0. |
| `pnpm --filter @orbexa/api lint` | Exit 0. |
| `pnpm --filter @orbexa/api typecheck` | Exit 0. |
| `pnpm --filter @orbexa/api test` | Exit 0. 1 test. |
| `pnpm --filter @orbexa/web test` | Exit 0. 3 tests. USD formats as `$10.50`. The same UTC instant renders on different civil dates in `Pacific/Auckland` and `Europe/London`. |
| `pnpm --filter @orbexa/web lint` | Exit 0. |
| `pnpm --filter @orbexa/web typecheck` | Exit 0. |
| `workers/ai/.venv/bin/ruff check .` from `workers/ai` | `All checks passed!` |
| `workers/ai/.venv/bin/mypy` from `workers/ai` | `Success: no issues found in 4 source files` |
| `workers/ai/.venv/bin/pytest -q` from `workers/ai` | `5 passed` |
| `pnpm audit --audit-level=high` | `No known vulnerabilities found` |
| `pip-audit` after `pip install -U 'pip>=26.2'` | `No known vulnerabilities found`. The local package `orbexa-ai` is skipped because it is not on PyPI. Before the pip upgrade, pip 24.0 itself reported PYSEC advisories. |
| `terraform version` | Terraform v1.10.5. Installed under `/tmp/tfbin` for this run. It is not a repo dependency. |
| `terraform fmt -recursive infra` | Exit 0. |
| `terraform init -backend=false` and `terraform validate` in `infra/envs/dev`, `staging`, and `prod` | `Success! The configuration is valid.` Provider resolved to `hashicorp/aws` v5.100.0. |
| `curl http://127.0.0.1:43123/en` | HTTP 200. Body contains `Orbexa foundation` and `$10.50`. |
| `curl -D - http://127.0.0.1:43123/` | HTTP 307 to `/en`. |
| `curl http://127.0.0.1:43124/health` | `{"service":"orbexa-api","status":"ok"}` |
| `curl http://127.0.0.1:43124/missing` | HTTP 404. |
| `gh auth status` | Not logged in. |
| `aws` | Not on `PATH`. |

LangGraph resolved to 1.2.24. pytest 9.2.0, ruff 0.17.6, mypy 2.4.1.

## What was not done

- `docker compose up` was not run.
- `terraform apply` and `terraform plan` were not run.
- The migrate CLI was not pointed at a TCP Postgres.
- No Stripe call. The connected account is the live ThirdRoc account.
- No model API call. No provider key is provisioned.
- GitHub Actions has not run. GitHub is not connected.
- The hospital-bed transaction, chunker, Temporal worker, and payout adapter are not implemented. Their tests in the backlog are specifications, not results.
- RLS was proved for `orbexa_app` and `orbexa_worker` on PGlite. It was not proved on the pg16 image named in Compose.

## Servers left running

- Web: `next dev` on port 43123.
- API: `node` on port 43124.
