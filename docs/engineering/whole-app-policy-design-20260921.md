# Local HTTP/SSR account policy and export contract

This document describes local implementation. It grants no hosted activation,
provider configuration, new billing/retention authority or Production permission.

## Request and mutation audit

`server/auth/operation-matrix.ts` inventories every mounted method and derives its
public/authenticated/household/owner/recent-auth/MFA/fence/financial/privacy class.
The AST guard inventories **30 route files and 39 HTTP methods** and scans all application source for unreviewed generated server-action directives. Seven existing auth
establishment/refresh/logout methods retain their separate reviewed session contract.
Twenty-nine ordinary protected methods now call the mandatory session scope before
idempotency, domain work or response construction. Three new account methods are
strictly synthetic-loopback mounts with explicit bootstrap/recovery policies.

Every capability has an explicit session policy, checked by the capability-union
guard. Ordinary requests require signed session assurance, fresh provider factor
inventory, active account and exact current membership role. A household with more
than one account holder or any identifier secret requires MFA. Voluntarily enrolled
verified TOTP also requires signed AAL2/TOTP. Unverified enrollment alone is not
MFA completion. Ordinary access lasts only as long as its signed session; the
separate export/delete/reveal policy retains fifteen-minute recent authentication.

The provider read is one attempt, bounded by the existing account transport; its
freshness interval begins before I/O and cannot exceed sixty seconds. Before and
after each scoped transaction, including audit flush, PostgreSQL time and the
existing privacy lock revalidate account/membership/fence/MFA policy. Ownership
loss during provider work, suspension and a mature fence refuse mutation. A final
admission refuses releasing previously prepared data after ownership loss. The
scope rejects nested replacement, detached tasks, asynchronous check callbacks and
non-household database escapes. Owner-only account scopes remain owner-only; the
ordinary scope preserves the reviewed member/viewer capability matrix. No new
roles, policies, migrations, credentials or SECURITY DEFINER functions.

The server-rendered layout and household chooser use the same policy. Phase-one
queries yield candidate UUIDs/roles internally; household names/profile/registry
content require the second-phase check. The scope does not claim remote session
revocation or an atomic provider/database snapshot. Auth establishment/bootstrap
and worker-only mutation paths remain governed by their own contracts, not falsely
classified as recent-auth domain requests. No account/financial/deletion operation
is made public by registering its name.

## Local mount and UI

`/v1/account/security`, `/v1/auth/recovery`, and `/v1/auth/recovery/complete` resolve
only with explicit `LOCAL_ACCOUNT_ROUTES=synthetic-only`, a non-production local
runtime, loopback HTTP Auth/JWKS/origin and loopback `app_user` PostgreSQL in a
`pellum_` fixture database. Vercel/AWS execution indicators refuse. The guard runs
before provider/database creation. It is not a flag that enables staging or Live.
Recovery paths are exact public middleware entries only so signed-out recovery can
reach this separate gate; they return unavailable when the local gate fails.

The mounted composition uses real signed verification, shared PostgreSQL counters,
RLS admission/audit/challenges and synthetic provider transport. Recovery resolves
household membership only after one-use redemption establishes the principal.
Password strength and range-response validation are real; the range request is
routed solely to the loopback synthetic provider. No real password or even a hash
prefix is sent to an external corpus in these tests. Hosted trusted ingress,
recovery templates, delivery and real Auth evidence remain unproven.

The local `/account-security` page is outside the household-data layout so an AAL1
session can perform step-up without first reading protected household data. It
supports inventory, enrollment, challenge, verification and confirmed removal.
Tokens remain HttpOnly. Setup material is transient client state, never storage or
logs. Component tests exercise keyboard focus, labels, live status, confirmation,
cancel focus return and uncertain provider failure without retry. They are not a
complete browser/mobile/contrast audit or a provider-backed authenticated preview.

## Export product contract and unfinished categories

The authoritative F15 target remains **originals + JSONL + appropriate audit ZIP**,
with bounded encrypted custody, owner/recent-auth download, expiry within 72 hours,
revocation and completion notification only after the complete artifact exists.
The current JSONL artifact is explicitly `complete=false` and remains partial.

| Category | Current local contract |
|---|---|
| Account/profile/household | Bounded owner email/status and profile/household fields |
| Members | Opaque IDs/kind/archive status; names remain a disclosed omission |
| Items/obligations | Closed enums, integer money, source links and cited deadline metadata; no arbitrary attrs/text |
| Documents | Metadata/status/size/source; no originals, object paths or download capability |
| Reminders | Opaque links, schedule and state |
| Preferences/notifications | Owner settings and bounded metadata; no message text/provider payload |
| Audit | Reviewed user-activity projection; not a full arbitrary audit dump |
| Entitlements/TEST subscription | Current limits and diagnostic TEST state; no claim of activated Premium |
| Identifiers | Omitted pending separately reviewed reveal/access policy; never ciphertext/keys |
| Plaid/provider data | Omitted; durable lifecycle is unfinished |

A single SQL statement captures the selected tables' MVCC snapshot; 1,001-row
sentinels reject overflow above 1,000 per source rather than silently truncate.
Encrypted local artifacts have a four-MiB bound, durable publication/revocation
journal, crash/retry/expiry/independent absence tests. Adding ZIP/originals cannot be
called complete until the reviewed original-access and full category policies exist.
No complete-export notification is emitted for this partial artifact.

The new export ports use existing shared Postgres counters: twenty operations per
verified account and sixty per trusted IP in fifteen minutes. Concurrent controller
instances share the same atomic buckets. Missing trusted ingress or counter outage
refuses. No per-process limiter, secret subject, request-ID reset or success reset.

## Deletion and billing boundaries

This increment adds no durable model or artifact class. Account challenges, export
artifacts and TEST billing journals retain their existing privacy inventory and
restricted-role coverage. Counter rows retain their existing bounded limiter
retention. Account-vs-household scope, provider erasure and backup expiry are not
collapsed into a successful local delete. `finalReceiptIssuable=false` remains.
ADR-019 operational authority and protected journal retirement stay disabled.

ADR-020 proposes a distinct billing role and atomic effective entitlements. This is
a material trust change: existing TEST trigger guards are keyed to `app_job_worker`;
simply granting a new role would bypass them. The proposal requires reviewed guard,
column-grant, RLS, lease/revision, internal-intent and DB-time cap design before any
new role or Premium writer. No fabricated Stripe event ID, new grant or entitlement
activation was added. Plaid durability remains required, unfinished launch work.

## Scanner diagnostics

Broker telemetry contains only closed stage names and monotonic elapsed milliseconds.
Stages distinguish queued, created, isolation-verified, scan-start-requested,
scan-returned, watchdog deadline and cleanup. `scan-start-requested` is deliberately
not proof the engine is scanning; no such observation exists in this interface.
Telemetry failure cannot authorize a verdict. Cleanup errors are coarse and still
fail closed. No payload, signature name, original path or provider identifier is
reported. Previous CPU-contention measurements and unknown historical queued cause
are retained; scanner budgets and hosted reliability claims are unchanged.

## Retained limits

Enforcement coverage is local HTTP/SSR evidence, not a claim that provider session
semantics, factor freshness under all revocations, hosted ingress, deployment,
account exit, complete export, full product UI or stable staging are ready. The added
read-only provider checks and serialized admission reads need hosted latency/load
and availability evidence before rollout. No timeout increase or credential retry.
Supabase's deeper 504 cause and historical management-token invalidation remain
unproven. The support packet is PREPARED BUT UNSENT. Production preflight: NO-GO.
