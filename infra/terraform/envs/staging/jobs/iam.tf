locals {
  roles  = jsondecode(file("${path.module}/runtime-policies.json"))
  issuer = "oidc.vercel.com/data-analyst-mike"
}
resource "aws_iam_role" "runtime" {
  for_each             = local.roles
  name                 = each.key
  max_session_duration = 3600
  permissions_boundary = "arn:aws:iam::792394000571:policy/pellum-${each.value.scope}-job-runtime-boundary"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::792394000571:oidc-provider/${local.issuer}" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${local.issuer}:aud" = "https://vercel.com/data-analyst-mike"
        "${local.issuer}:sub" = "owner:data-analyst-mike:project:autobureau-staging:environment:${local.scopes[each.value.scope]}"
      } }
    }]
  })
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role_policy" "runtime" {
  for_each = local.roles
  name     = "exact-queue-runtime"
  role     = aws_iam_role.runtime[each.key].id
  policy   = jsonencode(each.value.policy)
}
resource "aws_sqs_queue_policy" "main" {
  for_each  = local.queues
  queue_url = aws_sqs_queue.main[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}", Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "OnlyExactStagingPrincipals", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}", Condition = {
      ArnNotEquals = { "aws:PrincipalArn" = [
        "arn:aws:iam::792394000571:root", local.deploy_role,
        "arn:aws:iam::792394000571:role/pellum-${each.value.scope}-job-dispatcher",
        "arn:aws:iam::792394000571:role/pellum-${each.value.scope}-job-${each.value.kind}-worker"
      ] }
      Bool = { "aws:PrincipalIsAWSService" = "false" }
    } },
    { Sid = "NoQueuePurge", Effect = "Deny", Principal = "*", Action = "sqs:PurgeQueue", Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}" }
  ] })
}
resource "aws_sqs_queue_policy" "dlq" {
  for_each  = local.queues
  queue_url = aws_sqs_queue.dlq[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}-dlq", Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "NoRuntimeOrForeignDeadLetterAccess", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}-dlq", Condition = {
      ArnNotEquals = { "aws:PrincipalArn" = ["arn:aws:iam::792394000571:root", local.deploy_role] }
      Bool         = { "aws:PrincipalIsAWSService" = "false" }
    } },
    { Sid = "NoAutomaticReplayOrPurge", Effect = "Deny", Principal = "*", Action = ["sqs:StartMessageMoveTask", "sqs:PurgeQueue"], Resource = "arn:aws:sqs:us-east-2:792394000571:${each.key}-dlq" }
  ] })
}
