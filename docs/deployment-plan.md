# Deployment plan

## Environments

| | Local | Dev | Staging | Prod |
| --- | --- | --- | --- | --- |
| Data | Compose Postgres on port 54329, password `orbexa_local_only` | RDS `db.t4g.micro` single-AZ, private address, in `ap-southeast-2` | RDS single-AZ | RDS Multi-AZ |
| Workflow | Temporal `server start-dev` on 7233, UI 8233 | Temporal dev server in the one Fargate task. Temporal Cloud later | Temporal Cloud | Temporal Cloud |
| Stripe | Not called | Sandbox only, after the founder creates one | Sandbox | Live, after a separate approval |
| Customer files | Fixtures | Fixtures | Fixtures | Only after the founder allows real data |
| Terraform | Not used | `infra/bootstrap`, then `infra/envs/dev`. See [the dev runbook](dev-deploy-runbook.md) | `infra/envs/staging` | `infra/envs/prod` |

The compose file was not started here. Docker was not installed. The Temporal image tag is `temporalio/temporal:1.10.1` and the command is `server start-dev`. That command was not executed.

## Topology

ADR 0006. One cell per region per environment. No Kubernetes. Workers scale on SQS. The API is one Fargate service. Web is another. Both are still the modular monolith plus the UI, not a service per domain.

Secrets live in Secrets Manager. The worker role names only its own secret. Production secrets are not in dev task definitions, not in git, and not in this cloud agent's environment.

## CI/CD

`.github/workflows/ci.yml` runs, on pull request and on push to `main`:

- `pnpm install --frozen-lockfile`, lint, typecheck, test, `pnpm audit --audit-level=high`
- Python install, ruff, mypy, pytest, pip-audit
- The web build, Playwright, the API and worker image builds, and `terraform validate` with `-backend=false`

GitHub is not connected, so this workflow has not run on GitHub. Branch protection cannot be switched on from a file. When the repository is published, require the CI checks, one reviewer, and a protected environment named `prod` with a reviewer who is not the author before any apply.

Actions are pinned to commit SHAs recorded in the workflow file.

## Backups

RDS automated backups: 1 day in dev, because the Free plan rejects a longer retention, 7 days in staging, 35 in prod, as set in the Terraform. Snapshots stay in the region. Copying them to another region is a residency decision, not a default. S3 versioning is on. Milestone 4 runs a local restore drill against Postgres and a versioned directory and writes the timing in the test result. An RDS point-in-time restore and an S3 `get-object` by version id have not been executed. See `docs/m4-runbooks.md`.

## Monitoring

CloudWatch logs for the three services. Alarms to add before prod, not present in the skeleton yet: RDS CPU, queue age, 5xx on the load balancer, budget-exceeded log lines. OpenTelemetry from the app comes with the gateway work. Spans exclude prompt and document text.

## Incidents

Until there is an on-call rota, the founder is the contact. First moves: set worker `desired_count` to 0, leave the ledger readable, do not delete data, do not rotate secrets by pasting them into chat. A suspected cross-tenant read is a stop-the-line event: disable new jobs, preserve the `retrieval_events` rows, and review with the person named for Milestone 4.

## Agents and production

Coding agents do not receive AWS credentials and do not apply Terraform. The dev task's worker container does not receive the Stripe test secret. The API container does not receive the model keys. `task_desired_count` defaults to 0 so a mistaken apply does not start the placeholder image. The database, storage, and secrets are still billable once the founder applies `infra/envs/dev`. Staging and prod are a different shape, with a NAT gateway and a load balancer, and their roots refuse account `486726633485`.

The itemised dev estimate is in [the dev runbook](dev-deploy-runbook.md). The figures in `docs/first-response.md` section 4 are the earlier three-environment sketch.

## Cost

The estimate, the assumptions, and the inference separation are in `docs/first-response.md` section 4. Re-price before spend.
