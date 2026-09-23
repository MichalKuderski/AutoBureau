mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "792394000571"
      arn        = "arn:aws:sts::792394000571:assumed-role/pellum-stg-jobs-terraform-deploy/synthetic-test"
    }
  }
}
run "unverified_gate_is_closed" {
  command = plan
  variables { preapply_verified = false }
  expect_failures = [aws_sqs_queue.dlq]
}
run "isolated_encrypted_queues" {
  command = plan
  variables { preapply_verified = true }
  assert {
    condition     = length(aws_sqs_queue.main) == 4 && length(aws_sqs_queue.dlq) == 4 && alltrue([for q in aws_sqs_queue.main : q.sqs_managed_sse_enabled && q.message_retention_seconds == 604800 && q.visibility_timeout_seconds == 60 && q.receive_wait_time_seconds == 20])
    error_message = "Exactly four encrypted main queues with the reviewed worker budget are required."
  }
  assert {
    condition     = alltrue([for q in aws_sqs_queue.dlq : q.sqs_managed_sse_enabled && q.message_retention_seconds == 1209600 && jsondecode(q.redrive_allow_policy).redrivePermission == "byQueue"])
    error_message = "Each encrypted DLQ must retain fourteen days and allow only its exact source."
  }
  assert {
    condition     = length(aws_iam_role.runtime) == 6 && alltrue([for k, r in aws_iam_role.runtime : jsondecode(r.assume_role_policy).Statement[0].Condition.StringEquals["oidc.vercel.com/data-analyst-mike:sub"] == "owner:data-analyst-mike:project:autobureau-staging:environment:${local.scopes[local.roles[k].scope]}"])
    error_message = "All runtime role trusts must bind the exact staging project and intended scope."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.visible) == 8 && length(aws_cloudwatch_metric_alarm.oldest) == 8 && length(aws_cloudwatch_metric_alarm.application) == 24
    error_message = "Queue depth/age and fixed application failure metrics must be monitored."
  }
  assert {
    condition     = alltrue([for a in concat(values(aws_cloudwatch_metric_alarm.visible), values(aws_cloudwatch_metric_alarm.oldest), values(aws_cloudwatch_metric_alarm.application)) : a.alarm_actions == toset(["arn:aws:sns:us-east-2:792394000571:pellum-stg-operational-alerts"])])
    error_message = "Every alarm must route only to the approved staging alert topic."
  }
}
