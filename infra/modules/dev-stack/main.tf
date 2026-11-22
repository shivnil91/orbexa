data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  account_id         = "486726633485"
  azs                = slice(data.aws_availability_zones.available.names, 0, 2)
  enable_github_oidc = var.github_repository != ""
  log_group          = "/orbexa/dev/app"
}

resource "terraform_data" "guards" {
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == local.account_id
      error_message = "Refusing to apply the Orbexa dev stack outside account 486726633485."
    }

    precondition {
      condition     = length(data.aws_availability_zones.available.names) >= 2
      error_message = "The dev database subnet group needs two availability zones."
    }

    precondition {
      condition = (
        (var.task_cpu == 256 && contains([512, 1024, 2048], var.task_memory)) ||
        (var.task_cpu == 512 && contains([1024, 2048], var.task_memory))
      )
      error_message = "Use 0.25 vCPU with 512, 1024, or 2048 MiB, or 0.5 vCPU with 1024 or 2048 MiB."
    }

    precondition {
      condition = var.task_desired_count == 0 || (
        !strcontains(var.api_image, "placeholder") && !strcontains(var.worker_image, "placeholder")
      )
      error_message = "Push real images to ECR before setting task_desired_count to 1."
    }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "orbexa-dev"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "orbexa-dev"
  }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index + 1)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "orbexa-dev-public-${count.index}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "orbexa-dev-public"
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "tasks" {
  name        = "orbexa-dev-tasks"
  description = "Dev Fargate task. API ingress is limited to the founder CIDRs."
  vpc_id      = aws_vpc.this.id

  dynamic "ingress" {
    for_each = var.api_ingress_cidrs
    content {
      description = "API from an allowed dev CIDR"
      from_port   = 43124
      to_port     = 43124
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    description = "DNS to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["10.40.0.2/32"]
  }

  egress {
    description = "DNS to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["10.40.0.2/32"]
  }

  egress {
    description = "HTTPS to AWS APIs, ECR, Docker Hub, and model providers"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "Postgres"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.database.id]
  }

  tags = {
    Name = "orbexa-dev-tasks"
  }
}

resource "aws_security_group" "database" {
  name        = "orbexa-dev-db"
  description = "Dev Postgres. No public IP. Ingress comes from the task security group."
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "orbexa-dev-db"
  }
}

resource "aws_security_group_rule" "database_from_tasks" {
  type                     = "ingress"
  description              = "Postgres from the dev task"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.database.id
  source_security_group_id = aws_security_group.tasks.id
}

resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group
  retention_in_days = 7
}

resource "aws_ecr_repository" "app" {
  name                 = "orbexa-dev"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last ten images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_s3_bucket" "documents" {
  bucket = "orbexa-dev-documents-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_iam_policy_document" "documents" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.documents.arn,
      "${aws_s3_bucket.documents.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.documents.json
}

resource "aws_sqs_queue" "dead_letter" {
  name                    = "orbexa-dev-work-dlq"
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "work" {
  name                    = "orbexa-dev-work"
  sqs_managed_sse_enabled = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
}

resource "aws_secretsmanager_secret" "anthropic" {
  name                    = "orbexa/dev/worker/anthropic"
  description             = "Dev ANTHROPIC_API_KEY for the API and the worker. The secret value is set in the console, not in Terraform."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "openai" {
  name                    = "orbexa/dev/worker/openai"
  description             = "Dev OPENAI_API_KEY for the API and the worker. The secret value is set in the console, not in Terraform."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "stripe_test" {
  name                    = "orbexa/dev/api/stripe_test"
  description             = "Stripe test secret key only. Never store a live secret key."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "demo_auth" {
  name                    = "orbexa/dev/api/demo_auth"
  description             = "Demo HTTP Basic Auth for the API, as user:password. The secret value is set in the console, not in Terraform."
  recovery_window_in_days = 7
}

resource "aws_db_subnet_group" "this" {
  name       = "orbexa-dev"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name   = "orbexa-dev-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "orbexa-dev"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 20
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "orbexa"
  username = "orbexa"

  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.this.name
  parameter_group_name        = aws_db_parameter_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.database.id]

  multi_az                     = false
  publicly_accessible          = false
  backup_retention_period      = var.db_backup_retention_days
  backup_window                = "17:00-18:00"
  maintenance_window           = "sun:18:00-sun:19:00"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = true
  auto_minor_version_upgrade   = true
  apply_immediately            = true
  performance_insights_enabled = false
  monitoring_interval          = 0

  lifecycle {
    ignore_changes = [engine_version]
  }
}

resource "aws_cognito_user_pool" "this" {
  name = "orbexa-dev"

  username_attributes = ["email"]
  mfa_configuration   = "OPTIONAL"

  # TOTP only. OPTIONAL is rejected unless at least one factor is enabled,
  # and SMS or email MFA would need SNS or SES.
  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length = 12
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "orbexa-dev-web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "orbexa-dev-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid     = "InjectDevSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.anthropic.arn,
      aws_secretsmanager_secret.openai.arn,
      aws_secretsmanager_secret.stripe_test.arn,
      aws_secretsmanager_secret.demo_auth.arn,
      one(aws_db_instance.postgres.master_user_secret).secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "orbexa-dev-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "orbexa-dev-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid = "Documents"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  statement {
    sid       = "ListDocuments"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]
  }

  statement {
    sid = "WorkQueue"
    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.work.arn]
  }

  statement {
    sid    = "TaskDoesNotReadSecrets"
    effect = "Deny"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "orbexa-dev-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

locals {
  database_password_arn = "${one(aws_db_instance.postgres.master_user_secret).secret_arn}:password::"

  shared_environment = [
    { name = "ORBEXA_ENV", value = "dev" },
    { name = "AWS_REGION", value = "ap-southeast-2" },
    { name = "AWS_DEFAULT_REGION", value = "ap-southeast-2" },
    { name = "TEMPORAL_ADDRESS", value = "127.0.0.1:7233" },
    { name = "TEMPORAL_TASK_QUEUE", value = "orbexa-dev" },
    { name = "DB_HOST", value = aws_db_instance.postgres.address },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = "orbexa" },
    { name = "DB_USER", value = "orbexa" },
    { name = "DB_SSLMODE", value = "require" },
    { name = "DOCUMENT_BUCKET", value = aws_s3_bucket.documents.bucket },
    { name = "WORK_QUEUE_URL", value = aws_sqs_queue.work.url },
  ]
}

resource "aws_ecs_cluster" "this" {
  name = "orbexa-dev"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "orbexa-dev"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "temporal"
      image     = var.temporal_image
      essential = true
      command   = ["server", "start-dev", "--ip", "127.0.0.1", "--db-filename", "/tmp/temporal.db"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = "ap-southeast-2"
          awslogs-stream-prefix = "temporal"
        }
      }
    },
    {
      name      = "api"
      image     = var.api_image
      essential = true
      dependsOn = [
        {
          containerName = "temporal"
          condition     = "START"
        }
      ]
      portMappings = [
        {
          containerPort = 43124
          protocol      = "tcp"
        }
      ]
      environment = concat(local.shared_environment, [
        { name = "PORT", value = "43124" },
        { name = "ORBEXA_MODEL", value = "claude-sonnet-5-5" },
      ])
      secrets = [
        {
          name      = "STRIPE_SECRET_KEY"
          valueFrom = aws_secretsmanager_secret.stripe_test.arn
        },
        {
          name      = "STRIPE_TEST_SECRET_KEY"
          valueFrom = aws_secretsmanager_secret.stripe_test.arn
        },
        {
          name      = "DB_PASSWORD"
          valueFrom = local.database_password_arn
        },
        {
          name      = "DEMO_BASIC_AUTH"
          valueFrom = aws_secretsmanager_secret.demo_auth.arn
        },
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = aws_secretsmanager_secret.anthropic.arn
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = aws_secretsmanager_secret.openai.arn
        },
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:43124/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 90
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = "ap-southeast-2"
          awslogs-stream-prefix = "api"
        }
      }
    },
    {
      name      = "worker"
      image     = var.worker_image
      essential = true
      command   = ["python", "-m", "orbexa_ai.serve", "127.0.0.1:7233", "orbexa-dev"]
      dependsOn = [
        {
          containerName = "temporal"
          condition     = "START"
        }
      ]
      environment = local.shared_environment
      secrets = [
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = aws_secretsmanager_secret.anthropic.arn
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = aws_secretsmanager_secret.openai.arn
        },
        {
          name      = "DB_PASSWORD"
          valueFrom = local.database_password_arn
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = "ap-southeast-2"
          awslogs-stream-prefix = "worker"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "app" {
  name             = "orbexa-dev"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.app.arn
  desired_count    = var.task_desired_count
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_execute_command             = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }
}

resource "aws_budgets_budget" "monthly_20" {
  name         = "orbexa-dev-monthly-20"
  budget_type  = "COST"
  limit_amount = "20"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_blended                = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}

resource "aws_budgets_budget" "monthly_50" {
  name         = "orbexa-dev-monthly-50"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_blended                = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}

data "tls_certificate" "github" {
  count = local.enable_github_oidc ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = local.enable_github_oidc ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github[0].certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_assume" {
  count = local.enable_github_oidc ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:dev"]
    }
  }
}

resource "aws_iam_role" "github" {
  count              = local.enable_github_oidc ? 1 : 0
  name               = "orbexa-dev-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume[0].json
}

resource "aws_iam_role_policy_attachment" "github" {
  for_each = local.enable_github_oidc ? toset([
    "arn:aws:iam::486726633485:policy/orbexa-dev-deployer-platform",
    "arn:aws:iam::486726633485:policy/orbexa-dev-deployer-data",
    "arn:aws:iam::486726633485:policy/orbexa-dev-deployer-identity",
  ]) : toset([])

  role       = aws_iam_role.github[0].name
  policy_arn = each.value
}
