# Restore the dev database

This is the dev cell in `ap-southeast-2`, instance `orbexa-dev`. It was not executed against AWS in this change. Terraform was not applied.

Encryption at rest is `storage_encrypted = true` on `aws_db_instance.postgres` in `infra/modules/dev-stack/main.tf`. That uses the AWS-managed RDS key. Automated backups keep a restore window of `db_backup_retention_days` (default 7). Any retention above 0 includes point-in-time recovery inside that window. The AWS free plan may reject a retention above 1 day. If it does, set the variable to 1. That still allows point-in-time recovery for that day.

Do not restore on top of the live instance. Restore to a new instance in the same private subnets, still encrypted, still `db.t4g.micro`, and not publicly accessible.

## Point-in-time recovery

1. Scale the ECS service to 0 so nothing writes during the cut.
2. Pick a time inside the retention window, in UTC.

```bash
aws rds restore-db-instance-to-point-in-time \
  --region ap-southeast-2 \
  --source-db-instance-identifier orbexa-dev \
  --target-db-instance-identifier orbexa-dev-restore \
  --restore-time 2026-11-23T00:00:00Z \
  --db-subnet-group-name orbexa-dev \
  --vpc-security-group-ids <task-reachable security group> \
  --no-publicly-accessible \
  --deletion-protection
```

3. Wait until the new instance is `available`.
4. Confirm `StorageEncrypted` is true and `PubliclyAccessible` is false:

```bash
aws rds describe-db-instances --region ap-southeast-2 \
  --db-instance-identifier orbexa-dev-restore \
  --query 'DBInstances[0].{Encrypted:StorageEncrypted,Public:PubliclyAccessible,Class:DBInstanceClass}'
```

5. Point the task at the new endpoint only after that check. The password stays in the RDS-managed secret. Do not copy it into git or into the task definition.
6. Run the API as `orbexa_app` (`SET ROLE`), not as the table owner. `SELECT 1` from `GET /health` must return `database: ok`.
7. Read one seller's client workspace as that seller and confirm another seller's row is absent.

## Snapshot restore

Use the same target settings with `aws rds restore-db-instance-from-db-snapshot` and a snapshot from `aws rds describe-db-snapshots --db-instance-identifier orbexa-dev`. Prefer point-in-time recovery when the time you need is inside the retention window.

## After the restore

Keep the broken instance until the new one has been read. Then delete it only with deletion protection turned off, and only after the task is on the new endpoint. Uploads are not in the database. They are objects under `sellers/<seller-id>/uploads/` in the private documents bucket. Restoring RDS does not restore an object that was deleted. S3 versioning on that bucket keeps noncurrent versions for 30 days.
