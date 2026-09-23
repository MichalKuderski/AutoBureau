terraform {
  required_version = "~> 1.16.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = "us-east-2"
  allowed_account_ids = ["792394000571"]
  default_tags {
    tags = {
      Application = "Pellum"
      Environment = "staging"
      ManagedBy   = "Terraform"
      Purpose     = "document-quarantine"
    }
  }
}
