# ADR 0011: Low-cost dev cell in Sydney

- Status: Proposed
- Date: 2026-11-22

## Context

Account `486726633485` is on the AWS Free plan in `ap-southeast-2`, with US$100 of credits that expire on 2027-05-22. ADR 0006 describes the cell we want later: private subnets, a NAT gateway, an application load balancer, WAF, and three Fargate services. None of that has been applied. A NAT gateway in Sydney is about US$43 a month before data, which is already over the US$40 target and would spend the credits in a little over two months with nothing else running.

No AWS API was called while writing this. Prices are list prices cited in [the dev runbook](../dev-deploy-runbook.md).

## Decision

`infra/envs/dev` is a separate stack from the staging and prod skeleton.

- One VPC, two public subnets, an internet gateway, and no NAT gateway. The RDS instance has `publicly_accessible = false`, so it has no public address even though its subnets have a route to the internet gateway. An address without a public IP cannot use that route for outbound traffic.
- One Fargate task, ARM, 0.25 vCPU and 1 GB, `desired_count` 0 until real images exist. The task gets one public IPv4 so it can reach Secrets Manager, ECR, Docker Hub, Stripe test APIs, and the model APIs without a NAT gateway. The security group allows inbound TCP 43124 only from the CIDRs in `api_ingress_cidrs`. `0.0.0.0/0` is acceptable only when `DEMO_BASIC_AUTH` is set. The URL is that public IPv4 on port 43124, and the address changes when the task restarts.
- The task runs three containers that share localhost: the API, the worker, and `temporalio/temporal:1.10.1` with `server start-dev` bound to `127.0.0.1`. That is the same image and command as `docker-compose.yml`. Workflow state is a file in the task and disappears when the task is replaced. That is acceptable for fixtures. Temporal Cloud stays the later production control plane from ADR 0002. Its pay-as-you-go plan has no monthly minimum, and it is still a second vendor and a second credential, so it is not wired up here.
- RDS for PostgreSQL 16, `db.t4g.micro`, single-AZ, 20 GB gp3 with no storage autoscaling past 20 GB, encrypted with the AWS-managed RDS key, backups kept 1 day (the Free plan maximum; `db_backup_retention_days` can be set to 0 if 1 is still rejected), deletion protection on. `CREATE EXTENSION vector` stays in the SQL migration. Aurora Serverless v2 was rejected: a 0.5 ACU floor that never pauses is about US$44 a month at the US East list rate and about US$73 at the Singapore list rate, before storage, and an always-on API connection prevents scale-to-zero.
- S3 for documents uses SSE-S3, not a customer KMS key. A customer key is US$1 per month and is left for the production cell.
- Four Secrets Manager shells, with no values in Terraform: `orbexa/dev/worker/anthropic`, `orbexa/dev/worker/openai`, `orbexa/dev/api/stripe_test`, and `orbexa/dev/api/demo_auth`. The API container receives the Stripe test secret, `DEMO_BASIC_AUTH`, and the model secrets `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, because a paid draft runs in the API process. The worker container receives the same model secrets and not the Stripe secret or `DEMO_BASIC_AUTH`. The task role is denied `secretsmanager:GetSecretValue`. The execution role, which the ECS agent uses to inject environment variables, can read those four secrets and the RDS-managed password. This is one task and therefore one task role. Splitting the API and the worker into two tasks would add a second public IPv4 and a second Fargate minimum, which does not fit the credit target. Staging and prod keep separate task roles.
- App Runner was rejected. Sending App Runner traffic into the VPC so it can reach a private database also sends its calls to Stripe and the model providers into that VPC, and those calls then need a NAT gateway.
- Account-wide budgets at US$20 and US$50, measured before credits, with forecast and actual notifications. The alarms are there so the credits are not the only limit.
- Remote state is an S3 bucket and a DynamoDB lock table created by `infra/bootstrap`, whose own state stays local.
- Staging and prod refuse to plan in this account.

The dev task serves the Next.js app from `apps/web` on port 43124. When `DEMO_BASIC_AUTH` is `user:password`, every route except `GET /health` and `/api/stripe/webhook` returns 401 until the client sends that HTTP Basic credential.

## Consequences

A task at `desired_count` 0 still bills the database, storage, and secrets: about US$23 a month. Running the task all month is about US$38 before tax. Australian GST, if it applies, pushes the always-on figure to about US$42, so the task should be scaled to zero when nobody is using it. US$100 does not cover six months of an always-on database. The runbook has the arithmetic and the stop command.

The API is HTTP on a public address. The address is not in DNS, and it changes when the task restarts. `api_ingress_cidrs` still chooses who can open port 43124. `["0.0.0.0/0"]` is acceptable only with `DEMO_BASIC_AUTH` set. The data on this cell is fixtures. There is no TLS terminator because a load balancer does not fit the budget.

The deployer policy can change this stack, including the task definition. It cannot read secret values, create IAM users, create a NAT gateway, create a load balancer, or call billing and organization APIs. That key is still a credential for the dev account and does not belong in git or in a pull-request job.
