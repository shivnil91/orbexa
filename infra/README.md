# Infrastructure

Two shapes live here. Only the dev shape is meant to be applied, and only by the founder, in account `486726633485`.

## Dev

`infra/bootstrap` creates the Terraform state bucket and the DynamoDB lock table. Its own state file stays on the founder's machine.

`infra/envs/dev` is one Fargate task, RDS PostgreSQL 16 on `db.t4g.micro` with room for pgvector, S3, SQS, Cognito, four secret shells, and budgets at US$20 and US$50. There is no NAT gateway and no load balancer. The steps, the IAM policy, and the cost table are in [docs/dev-deploy-runbook.md](../docs/dev-deploy-runbook.md). [ADR 0011](../docs/adr/0011-dev-environment.md) records why.

`task_desired_count` is 0 until real images are in ECR. Applying the stack still creates the database. The dev stack is one task, so the split there is which container receives which secret. The dev task role itself cannot call `GetSecretValue`.

## Staging and prod

`infra/modules/cell` is the larger skeleton: NAT, a load balancer, WAF, and three services at `desired_count` 0. `infra/envs/staging` and `infra/envs/prod` call it. Both roots refuse account `486726633485`. Do not apply them.

The worker task role can read only `orbexa/<cell>/worker/runtime`. The cell name defaults to the environment. It cannot read the API secret. No role has `AdministratorAccess`.

`infra/envs/prod-eu-central-1` is a second cell in `eu-central-1`. It is not applied. It does not copy tenants from another region.
