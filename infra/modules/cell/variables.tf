variable "cell_name" {
  type        = string
  default     = ""
  description = "Resource-name prefix for this cell. Empty uses environment. A second region sets its own name. Tenants are not copied."

  validation {
    condition     = var.cell_name == "" || can(regex("^[a-z0-9-]+$", var.cell_name))
    error_message = "cell_name must be empty or a lowercase identifier."
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "region" {
  type        = string
  description = "AWS region for this cell. The founder chooses the first live region."
}

variable "vpc_cidr" {
  type = string
}

variable "nat_count" {
  type = number
  validation {
    condition     = var.nat_count == 1 || var.nat_count == 2
    error_message = "Use one NAT gateway, or two for a multi-AZ egress path."
  }
}

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "api_cpu" {
  type = number
}

variable "api_memory" {
  type = number
}

variable "web_cpu" {
  type = number
}

variable "web_memory" {
  type = number
}

variable "worker_cpu" {
  type = number
}

variable "worker_memory" {
  type = number
}

variable "container_image" {
  type        = string
  description = "Placeholder until an ECR image exists. Do not apply this stack against a live account from this draft."
  default     = "orbexa/placeholder:not-built"
}
