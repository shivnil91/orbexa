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

  environment       = "dev"
  region            = "us-east-1"
  vpc_cidr          = "10.20.0.0/16"
  nat_count         = 1
  db_instance_class = "db.t4g.micro"
  db_multi_az       = false
  web_cpu           = 256
  web_memory        = 512
  api_cpu           = 512
  api_memory        = 1024
  worker_cpu        = 512
  worker_memory     = 1024
}
