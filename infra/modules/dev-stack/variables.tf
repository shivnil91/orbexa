variable "budget_email" {
  type        = string
  description = "Inbox that confirms the US$20 and US$50 budget alarms. Not an example.com address."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email)) && !endswith(var.budget_email, "@example.com")
    error_message = "Set budget_email to a real inbox. example.com addresses are rejected."
  }
}

variable "api_ingress_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach the API on port 43124. Empty means no ingress. 0.0.0.0/0 is rejected."
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.api_ingress_cidrs :
      can(cidrhost(cidr, 0)) && cidr != "0.0.0.0/0" && cidr != "::/0"
    ])
    error_message = "Use a specific CIDR such as a /32. Opening the API to the internet is rejected."
  }
}

variable "task_desired_count" {
  type        = number
  description = "0 keeps the task off. 1 runs the single dev task. Nothing larger."
  default     = 0

  validation {
    condition     = var.task_desired_count == 0 || var.task_desired_count == 1
    error_message = "Dev runs at most one Fargate task."
  }
}

variable "task_cpu" {
  type        = number
  description = "Fargate CPU units. 256 is 0.25 vCPU. 512 is 0.5 vCPU."
  default     = 256

  validation {
    condition     = contains([256, 512], var.task_cpu)
    error_message = "Dev task CPU must be 256 or 512."
  }
}

variable "task_memory" {
  type        = number
  description = "Fargate memory in MiB. 1024 is the default. 2048 crosses the 24/7 credit target."
  default     = 1024

  validation {
    condition     = contains([512, 1024, 2048], var.task_memory)
    error_message = "Dev task memory must be 512, 1024, or 2048."
  }
}

variable "task_cpu_architecture" {
  type        = string
  description = "ARM64 is the priced default. X86_64 is the fallback if an image has no arm64 build."
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.task_cpu_architecture)
    error_message = "task_cpu_architecture must be ARM64 or X86_64."
  }
}

variable "api_image" {
  type        = string
  description = "API image. Leave the placeholder until an arm64 image is in ECR."
  default     = "orbexa/placeholder:not-built"
}

variable "worker_image" {
  type        = string
  description = "Worker image. Leave the placeholder until an arm64 image is in ECR."
  default     = "orbexa/placeholder:not-built"
}

variable "temporal_image" {
  type        = string
  description = "Temporal dev server image. The compose file pins the same tag."
  default     = "temporalio/temporal:1.10.1"
}

variable "github_repository" {
  type        = string
  description = "GitHub repo OWNER/orbexa. Empty skips the OIDC role."
  default     = ""

  validation {
    condition     = var.github_repository == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be empty or OWNER/name, with no wildcards."
  }
}
