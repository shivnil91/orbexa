output "vpc_id" {
  value = module.dev.vpc_id
}

output "public_subnet_ids" {
  value = module.dev.public_subnet_ids
}

output "task_security_group_id" {
  value = module.dev.task_security_group_id
}

output "document_bucket" {
  value = module.dev.document_bucket
}

output "database_address" {
  value = module.dev.database_address
}

output "database_secret_arn" {
  value = module.dev.database_secret_arn
}

output "ecr_repository_url" {
  value = module.dev.ecr_repository_url
}

output "ecs_cluster_name" {
  value = module.dev.ecs_cluster_name
}

output "ecs_service_name" {
  value = module.dev.ecs_service_name
}

output "log_group_name" {
  value = module.dev.log_group_name
}

output "cognito_user_pool_id" {
  value = module.dev.cognito_user_pool_id
}

output "work_queue_url" {
  value = module.dev.work_queue_url
}

output "stripe_test_secret_name" {
  value = module.dev.stripe_test_secret_name
}

output "demo_auth_secret_name" {
  value = module.dev.demo_auth_secret_name
}

output "anthropic_secret_name" {
  value = module.dev.anthropic_secret_name
}

output "openai_secret_name" {
  value = module.dev.openai_secret_name
}

output "github_deploy_role_arn" {
  value = module.dev.github_deploy_role_arn
}
