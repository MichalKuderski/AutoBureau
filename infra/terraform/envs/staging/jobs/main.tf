variable "preapply_verified" {
  description = "True only after ADR-017 account, region, claims, cost, state and separate deployment authority gates pass."
  type        = bool
  default     = false
}
locals {
  account = "792394000571"
  region  = "us-east-2"
  queues = {
    pellum-stg-pipeline          = { scope = "stg", kind = "pipeline" }
    pellum-stg-notifications     = { scope = "stg", kind = "notifications" }
    pellum-preview-pipeline      = { scope = "preview", kind = "pipeline" }
    pellum-preview-notifications = { scope = "preview", kind = "notifications" }
  }
  scopes = { stg = "production", preview = "preview" }
  # Derived from the implemented database-only worker, not a scanner/model runtime.
  # (30s receive + 2s DB wait + 5s transaction + 10s acknowledgement) * 1.25 = 58.75s.
  visibility_seconds = 60
  deploy_role        = "arn:aws:iam::792394000571:role/pellum-stg-jobs-terraform-deploy"
}
data "aws_caller_identity" "deployment" {}
resource "aws_sqs_queue" "dlq" {
  for_each                   = local.queues
  name                       = "${each.key}-dlq"
  fifo_queue                 = false
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 1209600
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = local.visibility_seconds
  max_message_size           = 1024
  redrive_allow_policy       = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = ["arn:aws:sqs:us-east-2:792394000571:${each.key}"] })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.preapply_verified && startswith(data.aws_caller_identity.deployment.arn, "arn:aws:sts::792394000571:assumed-role/pellum-stg-jobs-terraform-deploy/")
      error_message = "STOP: use the separate bounded ADR-017 deployment role after every live gate passes."
    }
  }
}
resource "aws_sqs_queue" "main" {
  for_each                   = local.queues
  name                       = each.key
  fifo_queue                 = false
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 604800
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = local.visibility_seconds
  max_message_size           = 1024
  redrive_policy             = jsonencode({ deadLetterTargetArn = "arn:aws:sqs:us-east-2:792394000571:${each.key}-dlq", maxReceiveCount = 3 })
  redrive_allow_policy       = jsonencode({ redrivePermission = "denyAll" })
  depends_on                 = [aws_sqs_queue.dlq]
  lifecycle { prevent_destroy = true }
}
