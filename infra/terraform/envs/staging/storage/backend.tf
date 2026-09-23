terraform {
  # Supply backend.staging.hcl after the protected bootstrap exists. Never use
  # local state for a real plan/apply; CI mocks initialize with -backend=false.
  backend "s3" {}
}
