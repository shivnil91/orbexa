provider "aws" {
  region = "ap-southeast-2"

  default_tags {
    tags = {
      Project     = "orbexa"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

module "dev" {
  source = "../../modules/dev-stack"

  budget_email             = var.budget_email
  db_backup_retention_days = var.db_backup_retention_days
  api_ingress_cidrs        = var.api_ingress_cidrs
  task_desired_count       = var.task_desired_count
  task_cpu                 = var.task_cpu
  task_memory              = var.task_memory
  task_cpu_architecture    = var.task_cpu_architecture
  api_image                = var.api_image
  worker_image             = var.worker_image
  temporal_image           = var.temporal_image
  github_repository        = var.github_repository
}
