locals {
  all_queues = merge(local.queues, { for k, v in local.queues : "${k}-dlq" => v })
}
resource "aws_cloudwatch_metric_alarm" "visible" {
  for_each            = local.all_queues
  alarm_name          = "${each.key}-visible"
  alarm_description   = endswith(each.key, "-dlq") ? "Synthetic job dead-letter queue is nonempty; inspect, never replay automatically." : "Staging job backlog exceeds the synthetic operating envelope."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.key }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = endswith(each.key, "-dlq") ? 0 : 100
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "oldest" {
  for_each            = local.all_queues
  alarm_name          = "${each.key}-oldest"
  alarm_description   = "Staging delivery lag requires investigation. An absent worker is not healthy merely because metrics are missing."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = each.key }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 300
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_dashboard" "jobs" {
  dashboard_name = "pellum-staging-jobs"
  dashboard_body = jsonencode({ widgets = [for index, name in sort(keys(local.all_queues)) : {
    type = "metric", x = (index % 2) * 12, y = floor(index / 2) * 6, width = 12, height = 6,
    properties = {
      title = name, region = "us-east-2", period = 60, stat = "Sum",
      metrics = [
        ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", name, { stat = "Maximum" }],
        ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", name, { stat = "Maximum" }],
        ["AWS/SQS", "NumberOfMessagesReceived", "QueueName", name],
        ["AWS/SQS", "NumberOfMessagesSent", "QueueName", name],
        ["AWS/SQS", "NumberOfMessagesDeleted", "QueueName", name]
      ]
    }
  }] })
}

locals {
  application_metrics = toset(["send_failure", "processing_failure", "retry", "exhausted", "delivery_lag_ms", "reconciliation_mismatch"])
  metric_alarms = { for pair in setproduct(keys(local.queues), local.application_metrics) : "${pair[0]}-${pair[1]}" => {
    queue = pair[0], metric = pair[1], scope = local.queues[pair[0]].scope, kind = local.queues[pair[0]].kind
  } }
}
resource "aws_cloudwatch_metric_alarm" "application" {
  for_each            = local.metric_alarms
  alarm_name          = each.key
  alarm_description   = "Staging job ${each.value.metric}; reconcile against Postgres authority. No automatic redrive."
  namespace           = "Pellum/StagingJobs/${each.value.scope}/${each.value.kind}"
  metric_name         = each.value.metric
  statistic           = each.value.metric == "delivery_lag_ms" ? "Maximum" : "Sum"
  period              = 60
  evaluation_periods  = each.value.metric == "delivery_lag_ms" ? 3 : 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.metric == "delivery_lag_ms" ? 300000 : each.value.metric == "retry" ? 3 : 0
  treat_missing_data  = "notBreaching"
}
