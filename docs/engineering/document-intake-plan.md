# Document intake implementation plan

Staging project: `kdqnfruwgocfqwpbpuxo`. The launch branch remains isolated from main and Production.

Read-only inspection on September 12 found no staging storage buckets, no storage policies and zero stored objects. Docker Desktop is installed; its local engine was stopped and is now running. No AWS CLI configuration or AWS credential environment is present. These findings are dependencies, not proof that an external AWS account does not exist.

## Boundaries to preserve

- Authenticated, capability-checked requests and `Database.withHousehold` for every domain transaction.
- Direct-to-storage upload, 25 MB maximum and the documented MIME allowlist, with a 15-minute capability. No household file bytes through a Vercel route.
- Signed capabilities contain no application session token. Dedicated server-side storage credentials remain outside browser bundles and logs.
- Uploaded bytes remain quarantined and unavailable to download/extraction until malware/type checks finish. Upload completion means queued for scanning, not processed or safe.
- A completed upload is copied to a fresh, non-client-writable quarantine key before the domain transaction selects that snapshot. Concurrent completions use different destination keys; only one receives the conditional state transition and outbox intent. Expiring upload URLs cannot overwrite the worker's chosen snapshot.
- A SHA-256 is absent until computed from actual bytes. Do not put a random placeholder or client assertion in the authoritative hash column. The current non-null column needs a forward, backward-compatible schema expansion.
- All storage network operations happen outside tenant transactions. Orphaned temporary/sealed objects need explicit retention and retry cleanup.
- Scanner output, not MIME headers/extensions, owns the detected type and trusted content hash. Identical household content deduplicates after verified hashing.
- The outbox commits with the transition to scanning. Python consumers and Redis Streams follow architecture 07; no request-handler queue publish or direct model-provider SDK import.

## Provider facts and verification requirements

[Supabase's standard signed-upload helper](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl) issues two-hour URLs. It does not satisfy the documented 15-minute contract. Its [S3 interface](https://supabase.com/docs/guides/storage/s3/compatibility) supports SigV4 query signing and conditional copy, but has no object versioning. Confirm the actual provider's size/header enforcement and overwrite behavior with synthetic files before enabling the UI.

[Generated Supabase S3 credentials](https://supabase.com/docs/guides/storage/s3/authentication) are server-only and bypass RLS. Storage buckets must stay private, raw authenticated/anonymous access must fail closed, and the application must only mint capabilities after checking tenancy/capability and constructing an exact server-owned key. A session-token S3 URL would expose the HttpOnly application token, so it is excluded.

No hosted storage setting, bucket, object or credential has been changed by this inspection. The schema foundation adds `document_uploads` capability metadata and makes the content hash nullable until verified. Its new forced-RLS policy derives tenancy from the parent document; the request role may change only completion time after insertion. No intake API or worker has been implemented yet. Required production-shaped worker hosting, scanner/model/KMS access, Redis, sender trap and retention evidence remain to be established. The final external request must batch any requirements the agent cannot satisfy through already authorized access.

The restored staging dashboard confirms an empty bucket inventory, Free-plan 50 MB global limit, S3 protocol enabled, endpoint `https://kdqnfruwgocfqwpbpuxo.storage.supabase.co/storage/v1/s3` and region `us-west-2`. Enforce the smaller 25 MB cap on the private bucket and signed request. The AWS staging worker region chosen by the founder is Ohio (`us-east-2`); cross-region latency/transfer costs need measurement. The founder authorized a $100/month staging infrastructure limit and reported $95.10 of remaining promotional credits, ending February 28, 2027 or on exhaustion. Credits are not a recurring cost model. Provisioning/access and a priced design remain outstanding; no AWS resource has been created.

## Schema rollout gate

Migration `20260912000002_document_upload_ledger` runs first on the disposable local database. Existing document columns retain their names and all populated hashes remain unchanged. The new relation is unused by existing application routes, so Preview may verify the foundation before the staging migration. Publish only after build/typechecks and isolation tests pass; then follow the exact-project migration-only workflow used for the notification expansion, preserving main and removing any temporary exact-branch allowance afterward. Expected staging posture becomes 10 completed / 0 rolled-back migrations, 19 forced-RLS public tables and 25 public policies, with no role, owner or ensure-trigger change. All existing data and security fingerprints must match across the DDL. The upload ledger must be empty after expansion.

Rollback means reverting application code while keeping the additive schema. Never synthesize a hash or delete pending documents merely to restore the old NOT NULL constraint. Only a later reviewed migration may restore that constraint after proving no pending unknown hashes remain.

## Local verification

The migration applies to disposable PostgreSQL 18 and Prisma reports an empty schema diff. Full database integration passes 58/58, including four new tests for null-versus-verified hash uniqueness, tenant-derived access, column-specific grants and cascade/check constraints. Full web integration passes 361/361; repository units pass 1,011/1,011. Build, lint and typecheck pass. An overloaded concurrent attempt produced test timeouts and was stopped; the unchanged application suite passed alone in 91 seconds and units passed with two workers in 137 seconds. No assertions or timeouts were relaxed. Typecheck was rerun successfully after the interrupted attempt.

A fresh pre-publication staging snapshot is 102 households / 102 entitlements, 9 completed / 0 rolled-back migrations, 18 forced-RLS tables / 24 policies. The controlled identity remains confirmed with one session. This snapshot is not the immediate pre-DDL gate: Preview acceptance normally creates three additional synthetic households, so capture fresh fingerprints after it finishes.
