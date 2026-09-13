mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "792394000571"
      arn        = "arn:aws:sts::792394000571:assumed-role/pellum-stg-terraform-deploy/mock-only"
    }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      id  = "pellum-stg-quarantine-792394000571-us-east-2"
      arn = "arn:aws:s3:::pellum-stg-quarantine-792394000571-us-east-2"
    }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::792394000571:oidc-provider/oidc.vercel.com/data-analyst-mike" }
  }
}

run "unverified_configuration_cannot_plan" {
  command = plan
  variables { issuer_mode = "team" }
  expect_failures = [aws_s3_bucket.quarantine]
}

run "staging_storage_boundaries" {
  command = apply # Mock provider only: no AWS calls or resources.
  variables {
    federation_verified = true
    issuer_mode         = "team"
  }
  assert {
    condition     = alltrue([for role in aws_iam_role.upload_signer : role.permissions_boundary == "arn:aws:iam::792394000571:policy/pellum-stg-upload-boundary"])
    error_message = "Both upload roles require the immutable quarantine-only boundary."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.quarantine.block_public_acls && aws_s3_bucket_public_access_block.quarantine.block_public_policy && aws_s3_bucket_public_access_block.quarantine.ignore_public_acls && aws_s3_bucket_public_access_block.quarantine.restrict_public_buckets
    error_message = "All public access must be blocked."
  }
  assert {
    condition     = aws_s3_bucket.quarantine.bucket == "pellum-stg-quarantine-792394000571-us-east-2" && !aws_s3_bucket.quarantine.force_destroy
    error_message = "Only the exact protected staging bucket is allowed."
  }
  assert {
    condition     = jsondecode(aws_iam_role.upload_signer["stg"].assume_role_policy).Statement[0].Condition.StringEquals["oidc.vercel.com/data-analyst-mike:sub"] == "owner:data-analyst-mike:project:autobureau-staging:environment:production"
    error_message = "Stable hosting trust must name the staging project exactly."
  }
  assert {
    condition     = jsondecode(aws_iam_role.upload_signer["preview"].assume_role_policy).Statement[0].Condition.StringEquals["oidc.vercel.com/data-analyst-mike:sub"] == "owner:data-analyst-mike:project:autobureau-staging:environment:preview"
    error_message = "Preview trust must name the staging project exactly."
  }
  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.quarantine_only["stg"].policy).Statement[0].Action) == toset(["s3:PutObject", "s3:GetObject"]) && jsondecode(aws_iam_role_policy.quarantine_only["stg"].policy).Statement[1].Action == "s3:DeleteObject"
    error_message = "The signer may perform object operations only; no bucket/IAM/list permissions."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.quarantine_only["preview"].policy).Statement : alltrue([for r in flatten([s.Resource]) : startswith(r, "arn:aws:s3:::pellum-stg-quarantine-792394000571-us-east-2/hh/")])])
    error_message = "No signer resource may escape the staging quarantine namespace."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_s3_bucket_policy.quarantine.policy).Statement : s.Effect == "Deny"]) && jsondecode(aws_s3_bucket_policy.quarantine.policy).Statement[1].Condition.NumericGreaterThan["s3:signatureAge"] == "900000"
    error_message = "Bucket policy grants no access and caps signed query age at fifteen minutes."
  }
  assert {
    condition     = jsondecode(aws_s3_bucket_policy.quarantine.policy).Statement[2].Action == "s3:GetObject" && jsondecode(aws_s3_bucket_policy.quarantine.policy).Statement[3].Action == "s3:PutObject"
    error_message = "Presigned requests must not download quarantine or overwrite sealed copies."
  }
}

run "interactive_credentials_cannot_plan" {
  command = plan
  variables {
    federation_verified = true
    issuer_mode         = "team"
  }
  override_data {
    target = data.aws_caller_identity.deployment
    values = { arn = "arn:aws:iam::792394000571:root" }
  }
  expect_failures = [aws_s3_bucket.quarantine]
}
