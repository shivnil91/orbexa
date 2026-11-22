# Infrastructure

Two shapes live here. Only the dev shape is meant to be applied, and only by the founder, in account `486726633485`.

## Dev

`infra/bootstrap` creates the Terraform state bucket and the DynamoDB lock table. Its own state file stays on the founder's machine.

`infra/envs/dev` is one Fargate task, RDS PostgreSQL 16 on `db.t4g.micro` with room for pgvector, S3, SQS, Cognito, three secret shells, and budgets at US$20 and US$50. There is no NAT gateway and no load balancer. The steps, the IAM policy, and the cost table are in [docs/dev-deploy-runbook.md](../docs/dev-deploy-runbook.md). [ADR 0008](../docs/adr/0008-dev-environment.md) records why.

`task_desired_count` is 0. The container images are placeholders. Applying the stack still creates the database.

## Staging and prod

`infra/modules/cell` is the larger skeleton: NAT, a load balancer, WAF, and three services at `desired_count` 0. `infra/envs/staging` and `infra/envs/prod` call it. Both roots refuse account `486726633485`. Do not apply them.

The worker role in that module can read only `orbexa/<env>/worker/runtime`. The dev stack is one task, so the split there is which container receives which secret. The dev task role itself cannot call `GetSecretValue`.
