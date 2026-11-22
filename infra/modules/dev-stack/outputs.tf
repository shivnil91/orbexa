output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "document_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "database_address" {
  value = aws_db_instance.postgres.address
}

output "database_secret_arn" {
  description = "RDS-managed master password. The value is not an output."
  value       = one(aws_db_instance.postgres.master_user_secret).secret_arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "work_queue_url" {
  value = aws_sqs_queue.work.url
}

output "stripe_test_secret_name" {
  value = aws_secretsmanager_secret.stripe_test.name
}

output "anthropic_secret_name" {
  value = aws_secretsmanager_secret.anthropic.name
}

output "openai_secret_name" {
  value = aws_secretsmanager_secret.openai.name
}

output "github_deploy_role_arn" {
  value = length(aws_iam_role.github) == 0 ? null : aws_iam_role.github[0].arn
}
