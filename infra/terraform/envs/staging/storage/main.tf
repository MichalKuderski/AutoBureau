variable "federation_verified" {
  description = "Set only after exact staging project OIDC claims and issuer mode have been verified and ADR-016 is accepted."
  type        = bool
  default     = false
}

variable "issuer_mode" {
  description = "The staging Vercel project's observed issuer mode; never guess this from the team name."
  type        = string
  validation {
    condition     = contains(["team", "global"], var.issuer_mode)
    error_message = "Use the verified team or global issuer mode."
  }
}

locals {
  account_id  = "792394000571"
  bucket_name = "pellum-stg-quarantine-792394000571-us-east-2"
  team        = "data-analyst-mike"
  project     = "autobureau-staging"
  issuer_host = var.issuer_mode == "team" ? "oidc.vercel.com/${local.team}" : "oidc.vercel.com"
  environments = {
    stg     = "production" # Stable scope of autobureau-staging, never the Production project.
    preview = "preview"
  }
  objects = "arn:aws:s3:::${local.bucket_name}/hh/*/upload/*"
}

resource "aws_s3_bucket" "quarantine" {
  bucket        = local.bucket_name
  force_destroy = false
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.federation_verified
      error_message = "STOP: ADR-016 approval and read-only staging OIDC verification are required before planning resource creation."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "quarantine" {
  bucket                  = aws_s3_bucket.quarantine.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_cors_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = [
      "https://autobureau-staging.vercel.app",
      "https://autobureau-staging-*-data-analyst-mike.vercel.app",
    ]
    allowed_headers = ["content-type", "content-length"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    id     = "bounded-quarantine-retention"
    status = "Enabled"
    filter { prefix = "hh/" }
    expiration { days = 7 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_s3_bucket_policy" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RequireTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.quarantine.arn, "${aws_s3_bucket.quarantine.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "ExpireQuerySignaturesAfterFifteenMinutes"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = "${aws_s3_bucket.quarantine.arn}/*"
        Condition = {
          StringEquals       = { "s3:authType" = "REST-QUERY-STRING" }
          NumericGreaterThan = { "s3:signatureAge" = "900000" }
        }
      },
      {
        Sid       = "NoQuarantineDownloadCapabilities"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.quarantine.arn}/*"
        Condition = { StringEquals = { "s3:authType" = "REST-QUERY-STRING" } }
      },
      {
        Sid       = "NoBrowserWriteToSealedCopies"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.quarantine.arn}/hh/*/upload/*/sealed/*"
        Condition = { StringEquals = { "s3:authType" = "REST-QUERY-STRING" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.quarantine]
}

resource "aws_iam_openid_connect_provider" "vercel" {
  url            = "https://${local.issuer_host}"
  client_id_list = ["https://vercel.com/${local.team}"]
}

resource "aws_iam_role" "upload_signer" {
  for_each             = local.environments
  name                 = "pellum-${each.key}-upload-signer"
  description          = "Temporary Vercel credentials for the staging quarantine bucket only."
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${local.issuer_host}:aud" = "https://vercel.com/${local.team}"
        "${local.issuer_host}:sub" = "owner:${local.team}:project:${local.project}:environment:${each.value}"
      } }
    }]
  })
}

resource "aws_iam_role_policy" "quarantine_only" {
  for_each = local.environments
  name     = "quarantine-objects-only"
  role     = aws_iam_role.upload_signer[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CreateUploadAndPrivateCopy"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${local.objects}/incoming", "${local.objects}/sealed/*"]
      },
      {
        Sid      = "DiscardUnselectedCopy"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "${local.objects}/sealed/*"
      },
    ]
  })
}

output "quarantine_bucket" { value = aws_s3_bucket.quarantine.id }
output "region" { value = "us-east-2" }
output "upload_roles" { value = { for name, role in aws_iam_role.upload_signer : name => role.arn } }
