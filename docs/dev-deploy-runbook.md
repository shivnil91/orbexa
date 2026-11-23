# Dev deploy runbook

Account `486726633485`, region `ap-southeast-2` (Asia Pacific (Sydney)). This is the only stack to apply. The founder has applied it. Do not apply `infra/envs/staging` or `infra/envs/prod`. Do not put a live Stripe key, a model key, an AWS access key, or a demo password in git.

The shape is [ADR 0011](adr/0011-dev-environment.md). CI runs `terraform validate` with `-backend=false` and does not call AWS.

## What you are creating

- A state bucket `orbexa-dev-tfstate-486726633485` and a lock table `orbexa-dev-tfstate-lock`.
- One VPC (`10.40.0.0/16`), two public subnets, one internet gateway. No NAT gateway and no load balancer.
- One ECS service `orbexa-dev` with `desired_count` 0. The task is 0.25 vCPU and 1 GB, ARM, and holds the API on port 43124, the worker, and the Temporal dev server on `127.0.0.1:7233`.
- RDS PostgreSQL 16, `db.t4g.micro`, 20 GB gp3, single-AZ, encrypted, not publicly reachable. The master password is an RDS-managed secret. pgvector is created by `packages/db/migrations/0001_foundations.sql`, not by Terraform.
- Document bucket `orbexa-dev-documents-486726633485`, private, versioned, SSE-S3.
- Secret shells with no values: `orbexa/dev/worker/anthropic`, `orbexa/dev/worker/openai`, `orbexa/dev/api/stripe_test`, `orbexa/dev/api/demo_auth`.
- Budgets `orbexa-dev-monthly-20` and `orbexa-dev-monthly-50`. They measure cost before credits are applied.

## 1. Confirm the account

1. Sign in to the AWS console as the root user or an IAM administrator of account `486726633485`.
2. Open the account menu in the top right. The account ID must be `486726633485`. If it is not, sign out.
3. Set the region menu to **Asia Pacific (Sydney) ap-southeast-2**. Leave it there for every step below.
4. Open **Billing and Cost Management → Credits**. Confirm the Free plan credit and the expiry **2027-05-22**. If either differs, stop. Credits are not a spending cap. Do not add a payment method you are unwilling to be charged on once the credit is gone.

## 2. Create the deployer policy and user

IAM managed policies are capped at 6,144 characters, so the deployer permissions are three policies. Attach all three. Together they are limited to this account, this region, and the resource names in the dev stack. They deny NAT gateways, Elastic IPs, EC2 instances, load balancers, WAF, Organizations, billing, Cost Explorer, payments, tax, invoicing, customer KMS keys, IAM users, access keys, and customer managed policies other than these three and `AmazonECSTaskExecutionRolePolicy`. They also deny `secretsmanager:GetSecretValue` and `secretsmanager:PutSecretValue`. `budgets:ViewBudget` and `budgets:ModifyBudget` are allowed only on the two budgets above, because Terraform creates those alarms and cannot do it without them. They do not change the payment method.

| File | IAM policy name |
| --- | --- |
| `infra/iam/orbexa-dev-deployer-platform.json` | `orbexa-dev-deployer-platform` |
| `infra/iam/orbexa-dev-deployer-data.json` | `orbexa-dev-deployer-data` |
| `infra/iam/orbexa-dev-deployer-identity.json` | `orbexa-dev-deployer-identity` |

1. Open **IAM → Policies → Create policy**.
2. Choose **JSON**. Replace the stub with the full contents of `infra/iam/orbexa-dev-deployer-platform.json`.
3. Choose **Next**. Policy name: `orbexa-dev-deployer-platform`. Description: `Orbexa dev deployer, network and ECS, ap-southeast-2.`
4. Choose **Create policy**.
5. Repeat for `orbexa-dev-deployer-data.json` with policy name `orbexa-dev-deployer-data`, and for `orbexa-dev-deployer-identity.json` with policy name `orbexa-dev-deployer-identity`. The policy name must match the file name without `.json`. A mismatch makes the later GitHub role attachment fail.
6. Open **IAM → Users → Create user**.
7. User name: `orbexa-dev-deployer`.
8. Leave **Provide user access to the AWS Management Console** unticked. This user has no console password. Choose **Next**.
9. Choose **Attach policies directly**. Search for `orbexa-dev-deployer`. Tick all three policies from the table. Do not tick AdministratorAccess, PowerUserAccess, IAMFullAccess, or Billing. Choose **Next**, then **Create user**.
10. Open the user, then the **Security credentials** tab. Under **Access keys**, choose **Create access key**.
11. Use case: **Command Line Interface**. Tick the confirmation. Choose **Next**, then **Create access key**.
12. Copy the access key ID and the secret access key into a password manager. Close the dialog. AWS shows the secret once.
13. Do not download the CSV into the git checkout. Do not commit it. Do not paste it into chat, GitHub, Slack, or a `.tf` file.

## 3. Point the CLI at that user

Install AWS CLI v2 and Terraform 1.9.x. CI pins Terraform 1.9.8.

```bash
aws configure --profile orbexa-dev
```

Region: `ap-southeast-2`. Output: `json`. Use the access key from the password manager.

```bash
export AWS_PROFILE=orbexa-dev
aws sts get-caller-identity
```

Stop unless `Account` is `486726633485` and the ARN contains `user/orbexa-dev-deployer`.

## 4. Bootstrap remote state

From a checkout of this repository:

```bash
cd infra/bootstrap
terraform init
terraform plan -out=tfplan
```

The plan creates the state bucket and the lock table. It does not create a database, a NAT gateway, or a task. Then:

```bash
terraform apply tfplan
```

`infra/bootstrap/terraform.tfstate` is gitignored. Copy it to the password manager. If it is lost, the bucket and table can be imported:

```bash
terraform import aws_s3_bucket.state orbexa-dev-tfstate-486726633485
terraform import aws_dynamodb_table.lock orbexa-dev-tfstate-lock
```

Do not commit the state file. It contains no application secrets. It does contain resource IDs.

## 5. Plan and apply the dev stack

Find the laptop's public address at `https://checkip.amazonaws.com` and write it as a `/32`.

```bash
cd infra/envs/dev
cp dev.tfvars.example dev.tfvars
```

Edit `dev.tfvars`:

- `budget_email` is a real inbox. `@example.com` is rejected.
- `api_ingress_cidrs` is that `/32`. `["0.0.0.0/0"]` is acceptable only when `DEMO_BASIC_AUTH` is set. See section 12.
- `task_desired_count` stays `0`.
- `github_repository` stays empty until the optional OIDC step below.

`dev.tfvars` is gitignored.

```bash
terraform init
terraform plan -var-file=dev.tfvars -out=tfplan
```

`terraform init` configures the S3 backend from `backend.tf`. If it says the bucket does not exist, the bootstrap apply did not finish.

Read the plan. Apply only if all of these are true:

- `aws_db_instance.postgres` is `db.t4g.micro`, `multi_az` false, `publicly_accessible` false, `storage_encrypted` true, `backup_retention_period` 7, and `max_allocated_storage` 20.
- There is no `aws_nat_gateway`, no `aws_eip`, and no `aws_lb`.
- `aws_ecs_service.app` has `desired_count` 0.
- The `aws_secretsmanager_secret` resources have no `aws_secretsmanager_secret_version`.
- The budgets are `orbexa-dev-monthly-20` and `orbexa-dev-monthly-50`.

```bash
terraform apply tfplan
```

RDS takes several minutes. No container starts. The placeholder image is not pulled.

## 6. Confirm the budget mail and store the secret values

AWS sends a confirmation mail for each budget notification. Open them and confirm, or the alarms never send. There are two budgets and each has an actual notification and a forecast notification, so several messages can arrive. Confirm each one.

Store secret values while signed in to the console as the administrator. The deployer key is denied `PutSecretValue`, and putting a key on the deployer CLI would also leave it in shell history.

1. Open **Secrets Manager** in Sydney.
2. Open `orbexa/dev/worker/anthropic`. Choose **Set secret value**. Type **Plaintext**. Paste the Anthropic key. Save.
3. Repeat for `orbexa/dev/worker/openai`.
4. Repeat for `orbexa/dev/api/stripe_test`. The value must start with `sk_test_`. If it starts with `sk_live_` or `rk_live_`, delete it. The connected ThirdRoc account is a live account and must not be used.
5. Repeat for `orbexa/dev/api/demo_auth`. The plaintext is `user:password` with one colon between them. The password may contain further colons. This becomes the API environment variable `DEMO_BASIC_AUTH`. Do not put that string in git, a chat, or `dev.tfvars`.
6. Do not copy the RDS-managed secret into a file, a chat, or the task definition. ECS reads it when a task starts.

Terraform does not store these values and will not overwrite them on a later apply unless the secret resource itself is replaced. `secretsmanager:UpdateSecret` remains allowed because that is the API Terraform uses for secret metadata. Do not use the deployer key to call it with a secret string.

## 7. Start the task only after images exist

`apps/web/Dockerfile` is the API image (the Next.js app) and `workers/ai/Dockerfile` is the worker. `scripts/build-and-push-dev.sh` pushes `linux/arm64` by default.

1. Build `linux/arm64` and push the API and the worker to the URL from `terraform output ecr_repository_url`. Tags are your choice. Put the full URIs in `api_image` and `worker_image`.
2. The API image serves `GET /health` on port 43124 and can run the health check, which is `node` fetching that URL. It reads `PORT`, `ORBEXA_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`, `TEMPORAL_ADDRESS`, `DOCUMENT_BUCKET`, `WORK_QUEUE_URL`, `STRIPE_SECRET_KEY`, and `DEMO_BASIC_AUTH`. `STRIPE_SECRET_KEY` is injected from `orbexa/dev/api/stripe_test`. `DEMO_BASIC_AUTH` is injected from `orbexa/dev/api/demo_auth`. Assemble `DATABASE_URL` in the entrypoint with the password URL-encoded, and use `sslmode=require`.
3. The worker image runs `python -m orbexa_ai.serve 127.0.0.1:7233 orbexa-dev`. It receives `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. It does not receive the Stripe secret or `DEMO_BASIC_AUTH`. The API container receives those same two model secrets, plus the Stripe test secret and `DEMO_BASIC_AUTH`.
4. The Temporal container is `temporalio/temporal:1.10.1`, command `server start-dev --ip 127.0.0.1 --db-filename /tmp/temporal.db`. It is pulled from Docker Hub on task start. A Docker Hub limit, or a missing arm64 manifest, shows up as a pull failure. The fallback is to copy that image into the ECR repository and set `temporal_image`.
5. Set `task_desired_count` to `1`.
6. Plan again. The plan should change the task definition and the desired count. It should not replace the database. Apply.

The API is then `http://<task public IPv4>:43124`. That address changes when the task restarts or is replaced. There is no TLS, no DNS name, and no load balancer. `api_ingress_cidrs` is what controls who can reach port 43124. Setting it to `["0.0.0.0/0"]` is acceptable only when `DEMO_BASIC_AUTH` is set. Do not send customer documents or a live payment through it.

Run SQL migrations from a one-off task in the same subnets and security group (`terraform output public_subnet_ids` and `terraform output task_security_group_id`). Do not open port 5432 to the internet so a laptop can reach RDS. The first migration runs `CREATE EXTENSION vector` as the master user. `rds.force_ssl` is 1.

To find the running address:

```bash
aws ecs list-tasks --region ap-southeast-2 --cluster orbexa-dev
aws ecs describe-tasks --region ap-southeast-2 --cluster orbexa-dev --tasks <task-arn>
```

The public address is on the elastic network interface in that description.

## 8. GitHub Actions OIDC, later

Leave this off until the repository has a GitHub owner. Pull-request jobs must not assume a cloud role.

1. In `dev.tfvars`, set `github_repository` to `OWNER/orbexa` with no wildcard.
2. Plan and apply. Terraform creates the OIDC provider and the role `orbexa-dev-github-deploy`.
3. The trust allows only `repo:OWNER/orbexa:environment:dev`. It does not allow `pull_request`. Terraform attaches the same three managed policies, including the denies. Those policies must already exist from step 2.
4. In GitHub, create an environment named `dev` and require a reviewer. A workflow that assumes the role must set `environment: dev` and must not run from a pull request.
5. The role ARN is `terraform output github_deploy_role_arn`.
6. After that works, disable the access key on `orbexa-dev-deployer`. A long-lived key is the worse of the two credentials.

`infra/iam/orbexa-dev-github-oidc-trust.json` is the same trust with `REPLACE_WITH_GITHUB_OWNER` left for a reader. Terraform substitutes the owner from `github_repository`. Do not attach that file to a role by hand unless the placeholder has been replaced.

## 9. Stop spend

Scale the task to zero when nobody is using it. Fargate and the public IPv4 stop. The database does not.

```bash
# dev.tfvars: task_desired_count = 0
terraform plan -var-file=dev.tfvars -out=tfplan
terraform apply tfplan
```

Stop the database to drop the instance charge. Storage and secrets continue. AWS starts a stopped instance again after seven days, so this is a week at a time, not a way to leave it off until May.

```bash
aws rds stop-db-instance --region ap-southeast-2 --db-instance-identifier orbexa-dev
```

Start it again with `aws rds start-db-instance` and the same identifier. A Terraform apply that modifies the instance can also start it. Read the plan.

The database has deletion protection. To destroy the dev stack, set deletion protection to false in `infra/modules/dev-stack/main.tf`, apply, then destroy. The state bucket and lock table refuse `terraform destroy` until `prevent_destroy` is removed. Empty the bucket first.

## 10. Re-apply after a partial apply

The first apply can create the network, the secret shells, and the user pool, then stop. Before running apply again:

1. In **IAM → Policies**, open `orbexa-dev-deployer-data`, choose **Edit**, replace the JSON with the current `infra/iam/orbexa-dev-deployer-data.json`, and save. The other two deployer policies did not change. The live policy is what the deployer uses. The file in git does not update it.
2. In `dev.tfvars`, leave `db_backup_retention_days` at `7` unless a previous apply was rejected for the free-plan backup limit.
3. `terraform plan -var-file=dev.tfvars -out=tfplan`, then `terraform apply tfplan`.

The plan should refresh the existing `orbexa/dev/*` secrets, create `aws_db_instance.postgres`, and update the Cognito user pool. It should not add a NAT gateway or a load balancer. If Cognito reports that `orbexa-dev` already exists and is not in state, delete that empty pool in the Cognito console and apply again.

If RDS still returns `FreeTierRestrictionError` for the backup retention, set `db_backup_retention_days = 1` and apply again. `1` is the free-plan maximum and still keeps point-in-time recovery for that day. `0` turns automated backups off; use it only if `1` is rejected. Restore steps are in [restore.md](restore.md).

Free-plan limits checked against this stack, besides the backup retention:

| Item | This stack |
| --- | --- |
| RDS class | `db.t4g.micro` only. The deployer policy denies any other class. The Free plan allows one micro instance. |
| Storage | 20 GB gp3, and `max_allocated_storage` 20, so autoscaling cannot grow past the Free plan storage cap. |
| Multi-AZ, read replica, RDS Proxy, Performance Insights, enhanced monitoring | Off. Proxy and Aurora are blocked on the Free plan, and this stack creates neither. |
| Cognito MFA | Optional authenticator (TOTP) only. No SMS and no SES. |
| Secrets | Metadata reads are allowed. Secret values stay denied. |

## 11. Monthly cost

US dollars, list price, 730-hour month, before tax. This is an estimate, not a quote. Re-check the AWS Pricing Calculator for `ap-southeast-2` before relying on it. Model invoices and Stripe fees are not on this bill and are not paid by these credits.

| Line | Rate and assumption | USD / month |
| --- | --- | --- |
| RDS `db.t4g.micro`, single-AZ, always on | US$0.025 per hour. Usage AI price list of 2026-11-19 and cloud-credits.org of 2026-10-19, both for PostgreSQL in `ap-southeast-2`. 0.025 × 730 = 18.25 | 18.25 |
| gp3, 20 GB provisioned | US$0.138 per GB-month, the Singapore and Tokyo single-AZ rate on the Clowdey RDS gp3 page checked 2026-11-03. Sydney's code is `APS2-RDS:GP3-Storage`; that page did not print the Sydney dollar rate, so this row uses the Singapore/Tokyo rate. 20 × 0.138 = 2.76. Baseline 3,000 IOPS and 125 MiB/s are included. Backups up to the allocated size are included. Autoscaling is capped at 30 GB | 2.76 |
| Fargate Linux ARM, 0.25 vCPU, 730 hours | US$0.03885 per vCPU-hour in Sydney. Usage AI Fargate page and vmprices, the latter checked 2026-11-22. 0.25 × 0.03885 × 730 = 7.09 | 7.09 |
| Fargate Linux ARM, 1 GB, 730 hours | US$0.00426 per GB-hour in Sydney, same sources. 0.00426 × 730 = 3.11 | 3.11 |
| One in-use public IPv4, 730 hours | US$0.005 per hour in every commercial region, Amazon VPC pricing. Charged only while the task is running | 3.65 |
| Secrets Manager, five secrets | US$0.40 per secret-month, Secrets Manager pricing. Four application shells plus the RDS-managed password. API calls at US$0.05 per 10,000 are under one cent at task-start volume | 2.00 |
| S3 Standard, 5 GB | US$0.025 per GB-month in Sydney. Toolweight's reading of the S3 pricing page, and the Clowdey regional map of 2026-11-03 (Sydney storage about 9% above the US$0.023 US East rate). Documents plus state | 0.13 |
| CloudWatch Logs, 1 GB ingested | US$0.70 per GB, the Singapore rate on the Clowdey ingestion page checked 2026-11-13. Sydney's code is `APS2-DataProcessing-Bytes`; that page did not print the Sydney dollar rate. Retention is 7 days. If an account-level 5 GB allowance applies, this row is zero | 0.70 |
| ECR, 1 GB | US$0.10 per GB-month from the ECR pricing example. A Sydney uplift was not extracted; treat the row as under US$0.20 | 0.10 |
| Data transfer out, 2 GB | US$0.114 per GB. Toolweight's Sydney column, consistent with the Clowdey map (Sydney egress about 27% above US$0.09). An account-level 100 GB allowance would make this zero | 0.23 |
| SQS, DynamoDB lock, Cognito, budgets | SQS stays inside the 1 million request allowance. The lock table is on-demand and under US$0.05. Cognito Essentials is US$0 under 10,000 monthly active users, as recorded from the Cognito pricing page on 2026-11-22 in `docs/first-response.md`. The first two AWS Budgets are US$0; a further budget is US$0.02 per day | 0.00 |
| **Task running all month** | | **38.02** |

Rows that are not in that total:

| Choice that was not taken | Why it lost | USD / month |
| --- | --- | --- |
| One NAT gateway, no data | US$0.059 per hour in Sydney. AWS Network Firewall pricing example for Asia Pacific (Sydney); cloud-credits.org of 2026-10-19; DevOpsPlant, October 2026. 0.059 × 730 = 43.07, before the US$0.059 per GB processed | 43.07 |
| Application load balancer, plus its own public IPv4 | US$0.0252 per hour and US$0.008 per LCU-hour. cloud-credits.org of 2026-10-19 and CloudCostDB. 0.0252 × 730 = 18.40, plus US$3.65 for the address, before LCUs | 22.05 |
| Aurora Serverless v2 at a 0.5 ACU floor | US$0.12 per ACU-hour in US East and US$0.20 in Singapore, Clowdey ServerlessV2Usage page checked 2026-11-03. Sydney's code is `APS2-Aurora:ServerlessV2Usage`. 0.5 × 730 × 0.12 = 43.80 at the cheaper published rate, before storage and I/O. An open connection from the API stops scale-to-zero | 43.80 |
| Customer-managed KMS key | US$1 per key-month on the KMS pricing example. SSE-S3 and the AWS-managed RDS key are used instead | 1.00 |
| Temporal Cloud | No monthly minimum on the pay-as-you-go plan published 2026-09-14: US$50 per million actions plus 10% support (temporal.io/pricing). Left for later. The dev server shares the task and adds no AWS line | 0.00 |

Planning figures, same assumptions:

| Way of running it | USD / month before tax | What US$100 covers |
| --- | --- | --- |
| Task off, database on | 23.24 | about 4.3 months |
| Task 10 hours × 22 weekdays (220 hours), database on | 27.74 | about 3.6 months |
| Task and database on all month | 38.02 | about 2.6 months, into February 2027 |

The 220-hour row uses the same unit rates: Fargate US$2.14 + US$0.94, public IPv4 US$1.10, logs 0.3 GB at the Singapore stand-in (US$0.21), and 1 GB egress (US$0.11), on top of the US$23.24 fixed rows.

US$100 spread to 2027-05-22 is about US$16.67 a month. An always-on database is already US$18.25, so the credit does not last until expiry unless the database is stopped for a large part of each month. The seven-day auto-start limit means that takes a weekly action. The US$20 alarm is the signal to stop the database or scale the task to zero.

If Australian GST of 10% applies to the account, the always-on total is about US$42. The task should not stay at 1 in that case. Raising memory from 1 GB to 2 GB adds US$3.11 all month (US$41.13 before tax). Switching the task to x86 adds about US$2.55 all month (US$40.57 before tax). Stay on ARM and 1 GB unless a container is killed for memory, and then scale it to zero overnight.

Nothing here was read from the account. The two rows marked as stand-ins are gp3 storage and CloudWatch ingestion. Confirm `APS2-RDS:GP3-Storage` and `APS2-DataProcessing-Bytes` in the pricing calculator before treating US$38.02 as closer than a planning figure.

## 12. Demo Basic Auth

`api_ingress_cidrs` remains the control for who can open TCP port 43124. Setting it to `["0.0.0.0/0"]` is acceptable only when `DEMO_BASIC_AUTH` is set. Store `user:password` as the plaintext of `orbexa/dev/api/demo_auth` before the next task start. The API container receives that value as `DEMO_BASIC_AUTH`. An empty shell makes ECS fail the start, the same way an empty Stripe shell does.

With the variable set, the Next.js app returns 401 and `WWW-Authenticate: Basic` for every route except `GET /health` and `/api/stripe/webhook`. The task health check is `GET /health` from inside the task, so it does not send the password and does not depend on `api_ingress_cidrs`.

The URL is `http://<task public IPv4>:43124`. That address changes when the task restarts. There is no load balancer and no DNS name. Find the address with the `aws ecs describe-tasks` commands in section 7.

The next plan, against the stack that is already applied, should:

- add `aws_secretsmanager_secret.demo_auth` named `orbexa/dev/api/demo_auth`, with no secret version
- add that secret's ARN to `GetSecretValue` on the task execution role `orbexa-dev-execution`
- publish a new task definition revision so the `api` container receives `DEMO_BASIC_AUTH`

It should not replace RDS, the existing secrets, Cognito, the VPC, or ECR. The deployer policy files in `infra/iam` already allow secret metadata on `orbexa/dev/*` and do not need an edit for this shell. `GetSecretValue` and `PutSecretValue` stay denied on the deployer. If the task is already running, applying the new task definition rolls it and the public IP changes. Leave `task_desired_count` at 0 until the secret value is stored and the image you want is in ECR.
