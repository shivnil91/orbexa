# Second cell. Do not apply. This stack creates billable network and database
# objects even with desired_count 0. Tenants are not copied from another region.
# There is no S3 replication and no DMS task.

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
  region = "eu-central-1"
}

module "cell" {
  source = "../../modules/cell"

  environment       = "prod"
  cell_name         = "prod-euc1"
  region            = "eu-central-1"
  vpc_cidr          = "10.40.0.0/16"
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
