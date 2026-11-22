# Do not apply this root in account 486726633485. account_guard.tf rejects that
# account. This skeleton still creates a NAT gateway and a load balancer.

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

  environment       = "staging"
  region            = "us-east-1"
  vpc_cidr          = "10.21.0.0/16"
  nat_count         = 1
  db_instance_class = "db.t4g.small"
  db_multi_az       = false
  web_cpu           = 256
  web_memory        = 512
  api_cpu           = 512
  api_memory        = 1024
  worker_cpu        = 1024
  worker_memory     = 2048
}
