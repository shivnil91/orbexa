data "aws_caller_identity" "current" {}

resource "terraform_data" "refuse_dev_credit_account" {
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id != "486726633485"
      error_message = "Do not apply prod in the dev credit account 486726633485. That account runs infra/envs/dev only."
    }
  }
}
