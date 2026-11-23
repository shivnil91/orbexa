variable "db_backup_retention_days" {
  type        = number
  description = "Automated RDS backup retention in days. 7 enables point-in-time recovery. Free plan accounts may reject values above 1."
  default     = 7
}

variable "budget_email" {
  type        = string
  description = "Inbox for the US$20 and US$50 budget alarms."
}

variable "api_ingress_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach port 43124. 0.0.0.0/0 is acceptable only when DEMO_BASIC_AUTH is set."
  default     = []
}

variable "task_desired_count" {
  type    = number
  default = 0
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "task_cpu_architecture" {
  type    = string
  default = "ARM64"
}

variable "api_image" {
  type    = string
  default = "orbexa/placeholder:not-built"
}

variable "worker_image" {
  type    = string
  default = "orbexa/placeholder:not-built"
}

variable "temporal_image" {
  type    = string
  default = "temporalio/temporal:1.10.1"
}

variable "github_repository" {
  type    = string
  default = ""
}
