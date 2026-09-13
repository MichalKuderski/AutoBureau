# ADR-016 saved staging plan review — September 13

The separately saved Terraform plan from GitHub run [34777452159](https://github.com/MichalKuderski/AutoBureau/actions/runs/34777452159) passed review. Its source is `8ebf4dbd8ff52230b9b2a2d0d89337eee1c1907b`; Terraform is 1.16.2 and the locked AWS provider is 6.64.0. The plan is complete and applyable, all checks pass, and every managed action is a create with no previous resource. Twelve additions, zero replacements, zero deletions. No queue resources belong to this plan.

Binary SHA-256: `7c553fe2df069921c9cd201f947e0df8a6b54356e4aae02c4edbacbcc1db46c7`.
JSON SHA-256: `804b2bb84c64309ad0ca85f46caa0001be223b54d5bd3e888e51123c4d52c960`.
Reviewed `main.tf` SHA-256: `0040869477f660d2ae9782c57b0ba4e422f2f112487e2f1f5fbcaed37fea6151`.

| Addition | Semantic review |
| --- | --- |
| Quarantine bucket | Exact staging account/name, Ohio; force_destroy=false. Source lifecycle prevent_destroy=true is pinned by its digest because public plan JSON omits it. |
| Public-access block | All four protections enabled. |
| Ownership | BucketOwnerEnforced; no ACL grant. |
| Encryption | Default AES256; no new KMS key or decrypt grant. |
| Lifecycle | hh/ quarantine only; seven-day expiry and one-day incomplete multipart cleanup. |
| CORS | PUT only; stable staging and staging Preview origins; Content-Type/Content-Length. This is browser interoperability, not authorization. |
| Bucket policy | Deny non-TLS; deny query signatures older than 15 minutes; deny all query-signed download and sealed overwrite. |
| Vercel OIDC provider | Exact verified team issuer and audience. |
| Stable upload role | Exact staging project's production hosting subject; immutable upload boundary; temporary sessions. No separate Production application trust. |
| Preview upload role | Exact staging project's preview hosting subject; same restricted boundary. |
| Stable inline policy | Get/Put only incoming and sealed upload namespace; Delete only sealed attempts. |
| Preview inline policy | Same narrow upload capability; no bucket administration/listing, unrelated bucket, IAM or model access. |

The IAM Policy Autopilot 0.3.0 baseline was generated locally from this saved plan, with telemetry disabled and no policy upload. Its broad delete/pass-role/attachment and unrelated-resource output was rejected. The final deployment grant intersects necessary actions with the already verified immutable ceiling, retains exact resources/conditions, and adds automatic expiry at **2026-09-13 22:00 UTC** to every statement. A separate CloudFormation change set adds exactly one inline policy to `pellum-stg-terraform-deploy`; it does not alter the ceiling, trusts, state role or other resources. cfn-lint, CloudFormation validation, Access Analyzer (zero findings), Guard and executable semantic checks pass.

The storage reviewer exercises 13 unsafe-plan/source substitutions; the grant reviewer exercises six unsafe-policy substitutions. Artifact verification also pins the successful originating repository, branch, run, source and binary/JSON fingerprints. Apply is refused after 21:45 UTC to retain headroom before permission expiry. The apply job must initialize the existing protected remote state, verify the signed GitHub job and exact assumed deployment identity, then apply this binary without re-planning.

Remote-state bootstrap has already passed live read-back: private encrypted/versioned retained S3 state, encrypted deletion-protected locks, exact immutable GitHub staging identity, separate state/deployment roles and unchanged unrelated migration host. This plan's successful native GitHub job proves actual temporary role federation and backend initialization. No persistent credentials are created.

This is pre-apply evidence, not a storage-probe result. After apply, effective bucket/IAM policies and synthetic positive/negative provider probes remain mandatory. Intake and all model/worker processing stay disabled. ADR-017 requires its own state/authority review and separately saved additions-only plan. Production remains untouched.
