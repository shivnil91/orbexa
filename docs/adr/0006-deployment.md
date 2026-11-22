# ADR 0006: AWS cell and identity

- Status: Proposed
- Date: 2026-11-22

## Context

The founder asked for a modular monolith on AWS, no Kubernetes, least-privilege IAM, and an evaluation of Cognito. No AWS credentials are available in this run. The Terraform under `infra/` was validated and not applied.

## Decision

One cell contains:

- A VPC, public and private subnets, one or two NAT gateways.
- An internet-facing application load balancer and a regional WAF web ACL using the AWS common rule set.
- ECS Fargate services for web, API, and worker. `desired_count` is 0 in the skeleton. The image is `orbexa/placeholder:not-built`.
- RDS for PostgreSQL 16, encrypted, private, gp3. pgvector is created by the SQL migration. Dev and staging are single-AZ. Prod is Multi-AZ in the skeleton.
- One S3 bucket, Block Public Access, versioning, SSE-KMS.
- SQS work queue and a dead-letter queue.
- Two Secrets Manager entries: `orbexa/<env>/api/runtime` and `orbexa/<env>/worker/runtime`. The worker policy lists only the worker secret.
- CloudWatch log group.
- Cognito user pool, email as username, MFA optional. The pool client has no client secret.

IAM roles trust `ecs-tasks.amazonaws.com` only. No policy in the module is `AdministratorAccess`.

Cognito is identity. `org_memberships.role` is authorization. The evaluated alternative was a first-party magic link. Cognito won for Milestone 1 because Essentials includes email login and authenticator MFA, the first 10,000 monthly active users are free on the price page fetched on 2026-11-22, and we still keep roles in Postgres.

Environments are separate Terraform roots: `infra/envs/dev`, `staging`, and `prod`. They currently set `us-east-1` so the provider initializes. That is not a decision that the first cell is in Virginia.

## Alternatives

EKS was rejected. The founder forbade Kubernetes for this stage, and the operational load is wrong for one API and one worker.

Self-hosting Temporal next to ECS was rejected. Temporal Cloud is the production control plane. The compose file runs the single-process dev server locally.

Putting the Stripe secret in the worker task was rejected. The worker never settles money.

## Consequences

Applying any environment creates billable NAT, load balancer, address, and database resources even at `desired_count` 0. That waits for the founder ceiling in the first response.
