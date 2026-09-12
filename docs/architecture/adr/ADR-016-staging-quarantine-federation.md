# ADR-016: Bucket-scoped federation for staging document quarantine

**Status: Approved by the founder; not yet applied.** September 12, 2026. Scope: staging only. Approval is recorded in the release-director conversation and remains conditional on every pre-apply proof below. This does not change Production storage or approve public launch.

## Evidence and decision needed

The upload adapter currently targets Supabase Storage. Its generated S3 keys bypass storage RLS and grant all operations across all project buckets. Automatic approval review rejected creation of that persistent key; subsequent dashboard read-back confirms that no key exists. Retrying the same operation through another API is excluded.

The founder has authorized AWS staging account `792394000571`, Ohio `us-east-2`, with a $100 monthly infrastructure ceiling. The approved staging architecture is a dedicated AWS S3 quarantine bucket and short-lived Vercel OIDC roles with access only to that bucket. This ADR supersedes the Supabase quarantine-storage choice in docs 01, 03 and 05 for staging only. Production and processed-document storage are unchanged.

The founder authorizes the real staging apply without another approval only after live account/region/resource checks, verified Vercel claims, bounded trust policies, encrypted remote state and a scoped deployment role are established, and an exact saved plan contains only intended staging additions. Replacements, deletions, unrelated changes, persistent AWS keys and Supabase S3 keys are excluded. Effective policies and every synthetic provider probe must be verified afterward. Intake and worker/model processing remain disabled. Safe pre-provider redaction is a hard prerequisite to sending real document contents to any model provider.

Read-only staging inspection finds zero documents, upload ledgers and storage objects. There is no uploaded data to migrate. The empty Supabase quarantine bucket is retained untouched while this proposal is evaluated.

## Proposed boundary

- Bucket `pellum-stg-quarantine-792394000571-us-east-2`, fixed AWS account/region, public access blocked, ACLs disabled, TLS required, default AES-256 server-side encryption. Identifier field encryption remains governed separately by ADR-007.
- Two temporary roles, `pellum-stg-upload-signer` and `pellum-preview-upload-signer`. Trust only the verified issuer/audience and exact subject for `data-analyst-mike / autobureau-staging`, respectively its stable `production` hosting scope and `preview`. No wildcard project or development trust; no Production application trust.
- IAM allows GetObject/PutObject only under the incoming/sealed upload namespace and DeleteObject only for sealed attempts. No bucket listing, bucket administration, IAM, KMS decrypt or other-bucket access. No persistent access keys.
- Existing authenticated household checks, strict server-owned UUID keys, signed Content-Type/Content-Length, 25 MiB maximum, fifteen-minute capability, independent conditional-copy sealing and transactional outbox remain required.
- Bucket policy denies query-signed quarantine downloads, query-signed writes to sealed copies, and query signatures older than fifteen minutes. The browser may PUT only to the exact incoming capability.
- Bucket lifecycle expires quarantine objects after seven days and aborts incomplete multipart uploads after one day. Application reconciliation must mark abandoned/expired work and clean orphan rows; bucket lifecycle alone is not deletion evidence. No processed documents belong in this bucket.
- Separate processed-document storage and worker grants require their own concrete plan. No worker, model, email or billing permission is included in this module.

Temporary AWS session tokens in a SigV4 URL are provider signing context; they are not an application session JWT or the role's secret signing key. Nevertheless the whole URL is a bearer capability: never log, cache publicly, send to analytics or expose it outside its recipient's response. Expiry must not exceed the underlying STS credential lifetime.

## Prepared implementation and required proof

`infra/terraform/envs/staging/storage` contains the protected bucket, OIDC provider and two narrowly scoped roles. The account/region are fixed. `federation_verified=false` blocks planning by default; the issuer mode is required and has no assumed default. The provider is mocked in tests, so the test's apply command creates no real resources. State, plans and local variables are ignored by Git.

Before any real plan/apply:

1. Architecture approval is complete. Verify the actual staging project issuer mode and exact claims through an authorized provider session or the existing staging CI credentials without printing a token. The connected Vercel app currently belongs to a different team; its result is not evidence about the staging project.
2. Recheck AWS account/region, bucket-name availability, OIDC/role inventory and existing cost. Read-only inspection currently reports zero OIDC providers. Do not modify any pre-existing migration host or unrelated resource.
3. Establish encrypted, access-controlled remote Terraform state and deployment-role boundaries. This local proposal is not a substitute for the controlled apply path in doc 09.
4. Review a saved exact plan. It must only add the named staging resources; no replacements or deletions. Set staging budget alerts and resource limits before continuous worker hosting. Billing alerts are not a hard spending cap.
5. Adapt the gated storage configuration to the native AWS endpoint and federated credential provider, retaining static redacted errors and no network I/O in tenant transactions. Store only non-secret role/bucket/region configuration in stg/preview; keep intake disabled.
6. Run real synthetic provider probes: valid PUT, changed length/type, unsupported type/oversize refusal, consumed/expired capability behavior, conditional-copy race, anonymous read/list refusal, forbidden download and sealed-overwrite refusal, wrong-project/environment role refusal, and exact fixture cleanup. No controlled confirmation identity is involved.
7. Enable intake only after scanner, dispatcher, retention and end-to-end processing gates pass. Signed upload success alone never means a file is safe.

## Rollback and limits

No resource has been created and the existing application remains configured for Supabase with intake disabled. If the proposal is accepted but probes fail, leave the feature disabled and revoke the new narrowly scoped role trust; do not delete a bucket containing evidence or user data. No production migration follows automatically. `prevent_destroy` and `force_destroy=false` intentionally block casual destruction.

This removes a broad persistent storage credential; it does not prove safe extraction, tenant-safe worker behavior, cost control or Production readiness. The existing conflict between raw vision extraction and the constitutional ban on identifiers in prompts still needs a safe pre-provider redaction design.

## Primary references

- [Supabase S3 authentication and credential scope](https://supabase.com/docs/guides/storage/s3/authentication)
- [Vercel AWS OIDC federation](https://vercel.com/docs/oidc/aws)
- [Vercel OIDC claims](https://vercel.com/docs/oidc/reference)
- [AWS presigned URL expiry and signature-age controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

The live token issuer/claims and provider enforcement remain unverified. Documentation examples are design evidence, not execution evidence.
