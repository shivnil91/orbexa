terraform {
  backend "s3" {
    bucket         = "orbexa-dev-tfstate-486726633485"
    key            = "envs/dev/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "orbexa-dev-tfstate-lock"
    encrypt        = true
  }
}
