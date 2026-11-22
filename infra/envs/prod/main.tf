# Do not apply this root in account 486726633485. account_guard.tf rejects that
# account. This skeleton still creates NAT gateways and a load balancer.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "cell" {
  source = "../../modules/cell"

  environment       = "prod"
  region            = "us-east-1"
  vpc_cidr          = "10.30.0.0/16"
  nat_count         = 2
  db_instance_class = "db.t4g.small"
  db_multi_az       = true
  web_cpu           = 512
  web_memory        = 1024
  api_cpu           = 1024
  api_memory        = 2048
  worker_cpu        = 1024
  worker_memory     = 2048
}
