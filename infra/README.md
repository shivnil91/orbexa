# Infrastructure skeleton

This is a Terraform sketch of one regional cell. It is not applied. The environments pin `us-east-1` only so `terraform validate` has a provider region; the founder still chooses the first live region.

`desired_count` is 0. The container image is `orbexa/placeholder:not-built`. Applying this would create billable network, database, and load-balancer resources even with no running tasks. Do not apply it until the founder approves the spend and an AWS account exists.

Postgres on RDS can `CREATE EXTENSION vector`. That statement is in the SQL migrations, not in Terraform.

Identity is Amazon Cognito. Authorization stays in Postgres `org_memberships`. Cognito groups are not the permission model.

The worker task role can read only `orbexa/<cell>/worker/runtime`. The cell name defaults to the environment. It cannot read the API secret. No role has `AdministratorAccess`.

`infra/envs/prod-eu-central-1` is a second cell in `eu-central-1`. It is not applied. It does not copy tenants from another region.
