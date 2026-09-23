bucket              = "pellum-stg-jobs-tfstate-792394000571-us-east-2"
key                 = "adr017/jobs.tfstate"
region              = "us-east-2"
encrypt             = true
allowed_account_ids = ["792394000571"]
dynamodb_table      = "pellum-stg-jobs-tfstate-locks"
use_lockfile        = true

assume_role_with_web_identity = {
  role_arn                = "arn:aws:iam::792394000571:role/pellum-stg-jobs-terraform-state"
  web_identity_token_file = "/tmp/pellum-adr017-github-oidc.jwt"
  duration                = "900s"
}
