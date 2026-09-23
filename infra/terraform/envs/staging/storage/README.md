# Proposed staging quarantine storage

**Not applied.** [ADR-016](../../../../../docs/architecture/adr/ADR-016-staging-quarantine-federation.md) records the decision and gates. This module does not create a worker, migrate application data or change Production. The application adapter has not yet been switched from Supabase.

Local validation, with no AWS credentials or resources:

```sh
terraform init -backend=false -input=false
terraform fmt -check
terraform validate
terraform test
```

The `.tftest.hcl` file uses a mocked AWS provider. Its mock apply checks the assembled trust and storage policies without calling AWS. Real planning fails with the default `federation_verified=false`; the exact observed issuer mode must be supplied after ADR approval and Vercel read-only verification. Do not set that flag merely to obtain a green plan.

Terraform 1.16.2 and AWS provider 6.64.0 are the initially validated versions. The lock file is committed. Local state and saved plans are ignored. A secured remote state/deployment bootstrap is still required before application; do not run a real apply from this proposal directory with an ad hoc state file.

The non-secret role ARNs, bucket and region belong in Doppler `autobureau/stg` and `autobureau/preview` only after read-back of a successful exact plan. No AWS access/secret keys should be stored in Vercel. This proposal's role scope is only the quarantine bucket; processed-document and worker permissions are not implied.
