# Account-security, export and TEST billing continuation — September 20, 2026

Status: **local development increment verified; Production preflight NO-GO**.
This is not full-stack, provider, staging acceptance, or launch-readiness evidence.
Nothing was pushed, deployed, merged, sent to support, or changed at a provider.
PR #5 was not queried or changed remotely; its last known state remains draft.

## Scope and source provenance

Continue the isolated `codex/review-pellum-hardening-v2` worktree at
`/private/tmp/pellum-native-review-20260920`. Starting clean HEAD was
`f5c24bafe4c8756e28daae6488c7fc4f9f8836ec`; its predecessor implementation
`40d0c78e0b728acf56fb670da1dd935bf6a31f25` was the previous tested checkpoint.
The original checkout remains on `main` at `56cf76ed3f6da70b506a1dd34b7258bfe6eebd95`.
All **386** previously inventoried original files match their original SHA-256 hashes.
No reset, stash, clean, overwrite or absorption of unrelated work occurred.

Tested implementation: `1d1b13840f11c53ae331cbc75197ace191e9780e`.
The final evidence commit is documentation only; obtain its exact ID with `git rev-parse HEAD`.
The machine-readable [receipt](evidence/account-lifecycle-native-20260920.json)
records versions, hashes, source identity, schema readback and precise test counts.

| Local commit | Change |
| --- | --- |
| `4578c1b` | ADR-019 principal-security decision and mandatory amendments |
| `7f810dd` | Bounded provider transport and unmounted MFA/recovery controllers |
| `21b5214` | Single-statement partial export snapshot and encrypted local artifact |
| `e407484` | Durable MFA journal, limiter, privacy inventory and revocation crash fix |
| `e6eca44` | TEST binding/inbox journal with restricted-role and SDK composition tests |
| `1d1b138` | Activation guards and exhaustive retention-catalog correction |

## ADR-019 decision

**APPROVE WITH REQUIRED AMENDMENTS**, documented in the
[principal-security review](adr019-security-review-20260920.md) and
[amended ADR](../architecture/adr/ADR-019-independent-privacy-authority.md).
The delegated architecture review accepts the direction, not an operational service.
Mandatory additions: independent incarnation/enrollment catalog and exact restore
manifest; serving/egress admission outside application deployment authority;
independently durable witnessed checkpoint lineage; standard versioned canonical
encoding and ordered epochs; durable one-use challenges; separately custodied key
registry, rotation, revocation and retrospective compromise handling; complete
partial/regional restore closure; bounded holds and truthful retention limitations.
Unknown/unavailable authority permits quarantined inspection, never active serving.

The review covers stale/malicious backups, replay, rollback, equivocation, writer,
signer, deployment and backup-operator compromise, unavailable/lost records,
regional partitions, account versus household scope and recreated identities.
Pseudonymous tombstones remain potentially personal data. No signatures, in-memory
map or higher sequence alone proves complete restore safety. v1 remains unchanged,
local and non-activating. No authority hosting, destructive journal retirement or
final deletion receipt was implemented.

## Account security

The separate provider transport uses one bounded attempt, no redirect following,
no automatic credential retry and coarse existing provider error classification.
It projects only closed user/factor/challenge/token fields, discarding arbitrary
provider metadata and enrollment SVG. Default transport deadline remains ten seconds.
It adds factor list/enrollment/challenge/verify/remove, recovery request/redemption,
password update and acknowledged global refresh revocation without changing the
existing signup/sign-in/confirmation/refresh handler.

Unmounted POST controllers enforce CSRF, signed principal/user/session binding,
current provider factors and TOTP freshness. Enrollment needs recent password/TOTP;
verification consumes a durable challenge before provider I/O, then checks fresh
same-session AAL2, current verified factor and live owner/fence admission before
setting HttpOnly cookies. Setup secret is returned only by the unmounted no-store
local enrollment controller, never logged or persisted. No browser-held provider
session is introduced. Verified-factor removal is refused for any MFA-required
household, avoiding a read-count/last-factor removal race. Actual whole-application
MFA enforcement remains required before mounting any of these flows.

The new forced-RLS journal binds user/session/factor/challenge, uses DB-time expiry
(maximum five minutes) and single-use consumption under row lock. A waiting consumer
cannot extend validity using an old application clock. No OTP, seed, access token or
refresh token is stored. No runtime authority to reset consumption or change binding.
The provider call occurs after the short transaction commits; a crash or ambiguous
provider outcome requires a fresh challenge rather than replay. Fixed durable MFA
budgets are 20 actions and five verification attempts per user per fifteen minutes,
plus sixty per trusted IP. Counter failure refuses MFA with 503; the separately
accepted public-auth fail-open policy is unchanged. Success does not reset counters.

Recovery initialization preserves account-independent 202 responses; provider outages
remain coarse 503. Completion redeems a recovery token hash once, requires the
existing verified TOTP factor when present, updates the password once, audits phases,
revokes refresh sessions and requires sign-in. It never resets a lost factor or issues
an application session. Failure after an ambiguous effect clears local cookies,
without claiming the effect did or did not commit. Already issued access JWTs may
remain valid until expiry; global logout is not an immediate JWT invalidation claim.

**Activation gaps:** password-strength/breach-check adapter (zxcvbn >=3 and k-anonymity),
shared recovery limiter/admission adapter, reviewed server-mediated recovery email
and landing page, whole-app MFA enforcement/session policy, provider/session-rotation
and recovery evidence, and audited identity-proof procedure for lost factors. Existing
default implicit-fragment/PKCE recovery callbacks are not supported by this token-hash
seam. No templates, Auth settings, users or sessions were changed at Supabase.

Primary protocol references: [Supabase Auth OpenAPI](https://raw.githubusercontent.com/supabase/auth/master/openapi.yaml),
[MFA guidance](https://supabase.com/docs/guides/auth/auth-mfa), and
[password security](https://supabase.com/docs/guides/auth/passwords). The changelog
fetch was unavailable; no claim is made that it was reviewed.

## Export and deletion

A single parameterized MVCC SQL statement captures deterministic owner-scoped
projections of items, obligations, documents, members, reminders and entitlements.
Money remains exact integer strings (including above 2^53); dates retain offsets.
Each collection is bounded at 1,000; overflow refuses rather than truncates. The
statement repeats owner and intent checks, and the scoped transaction takes the
privacy write fence. No network I/O occurs inside the transaction.

The local-only artifact vault accepts a caller-custodied AES-256 key, fresh nonce and
scope-bound authenticated encryption. It writes no plaintext file or persistent key.
Private directory/file ownership, symlink/link-count/size checks, exclusive temporary
writes, fsync and atomic publication protect the immutable snapshot. Retry/restart
reuses the same artifact. Each download reauthorizes the original live owner, request,
72-hour request-based expiry and deletion/revocation state before and after assembly.
No bearer URL is minted. Revocation is durable before unlink; expiry independently
checks file absence and handles ciphertext left by a crash after revocation.

**Explicitly partial:** this is bounded JSONL, not the promised complete originals +
JSONL + audit ZIP. Account/profile data, originals, identifier reveal, names/free-text,
attrs/extracted content, audit, notification/preferences and provider records are
listed as omissions in every manifest. No completion notification is emitted for an
incomplete export. Crashed `.pending` ciphertext sweeping, notification intent/delivery,
complete artifact journaling, hosted key custody/storage and backup deletion remain
unfinished. Removing a local file proves only local path absence, not physical media,
provider, backup or already-downloaded-copy erasure. JavaScript memory zeroization is
not claimed.

Bounded deletion inventory now includes opaque MFA challenge and TEST billing journal
references. Restricted retention/verifier roles cannot read their session, factor,
customer or event IDs. Independent source/manifest reconciliation still detects missing,
extra and invalid entries; coverage metadata includes every Prisma model. New FK
RESTRICT edges prevent deleting a household while these journals remain. Challenge
expiry and event consumption are not retention approval. No destructive retirement,
provider/account deletion or final-receipt issuance was added.

## Stripe TEST and Plaid

Stripe now has immutable owner/account/customer/subscription bindings and a durable
minimal notice inbox under forced RLS. The official pinned SDK's exact raw-body
signature verifier composes with this journal using offline synthetic fixtures.
One account/event identity survives retries and client restart; changed content under
the same identity, wrong account/subscription/scope, unsafe projections, Live input
and deletion fences refuse. Application role cannot write webhook notices; the scoped
job role cannot change bindings, mutate provider identity fields or purge history.
Claims are bounded to three attempts with DB-time sixty-second leases (two ten-second
provider-read budgets + two seven-second DB budgets + completion margin, rounded up).
Expired/replaced lease owners cannot finish even a refusal. No lease extension,
automatic replay or continuous worker is enabled. A refused/poison claim is not success.

**Incomplete:** notices only become pending/leased/refused reconciliation intent.
Invoice/customer association still needs authenticated provider refetch; an accepted
invoice notice does not authorize its household. Binding establishment needs authenticated
TEST account/customer/subscription creation/refetch evidence outside the transaction.
There is no anonymous webhook resolver/route, successful reconciliation state, serialized
subscription transition, transactional entitlement/outbox effect, seven-day grace,
renewal/cancel/plan-change completion, customer/portal/checkout activation, or provider
lifecycle proof. Metadata and checkout success URLs cannot grant Premium. The existing
$12/month and $99/year TEST price contract remains provisional; unit economics and caps
must be confirmed before payments. These new local role grants need deployment review
before hosted adoption. No Stripe account call, customer, key or charge was created.

Stripe semantics were checked against [webhook guidance](https://docs.stripe.com/webhooks)
and [subscription lifecycle events](https://docs.stripe.com/billing/subscriptions/webhooks);
the pinned SDK is 22.6.2 and local webhook fixtures pin `2026-02-25.clover`.

Plaid's existing Sandbox contract/token/webhook foundations are unchanged. Durable
Item/account/transaction storage, encrypted custody integration, cursor/inbox replay,
reconnect/unlink, export/deletion effects and genuine Sandbox lifecycle proof remain
required launch work. No real account, Plaid Production action or payment initiation.
No unsupported UI was added for these unmounted/incomplete flows.

## Validation and defects caught

Final candidate results: **1,716 units; 586 restricted-role PostgreSQL integrations;
195 local controls; seven architecture guards; one real local ClamAV lifecycle;
16 caught/restored deliberate weakenings.** Frozen install, forced build/typecheck
and lint pass (zero errors, thirteen pre-existing warnings). Test jobs are uncached;
only dependency builds may be reused by the integration task after the forced build.
Toolchain: Node 22.16.0, pnpm 10.34.5, TypeScript 5.9.3, Next 15.5.22,
Vitest 3.2.7, Prisma 6.19.3 and Stripe SDK 22.6.2.

Fresh disposable readback: **22 completed migrations, zero rolled back/unfinished,
all checksums match Git; 30 forced-RLS tables, 40 policies, 21 privacy fences,
nine journal audit triggers; zero ensure_rls triggers, provider grants, runtime-owned
tables or new SECURITY DEFINER functions.** No new roles. Existing dispatcher alone
retains its reviewed BYPASSRLS/NOLOGIN escape hatch; app_user is non-superuser and
NOBYPASSRLS. Worker/retention/verifier roles are NOLOGIN after fixtures. New challenge
and TEST billing tables have zero remaining synthetic rows. Migration SQL records
lock bounds, 100k-household estimates and disable/retain-evidence rollback stories.
No hosted schema/readback is implied. See the receipt for hashes and column grants.
Full uncached runtime validation includes frozen offline install, build, units,
typecheck, lint, disposable PostgreSQL/RLS integrations, local controls, architecture
guards and the pinned real local ClamAV synthetic lifecycle. RLS assertions use
non-superuser application/worker/retention/verifier connections, not the administrator.
Administrative connections create synthetic fixtures and read schema metadata only.

Sixteen deliberate code weakenings fail their intended tests and are byte-restored:
coarse restore errors, abort bound, signature, one-use challenge, checkpoint advancement,
recent auth, export owner/fence/expiry, MFA TOTP freshness, recovery factor requirement,
DB factor binding, Stripe subscription binding, duplicate-event identity, stale lease
and official signature verification. This is selected mutation evidence, not exhaustive
mutation coverage or independent authority durability proof.

Caught during this increment: export revocation-crash cleanup gap; missing new-model
retention catalog entries (the guard failed and was preserved); a subscription-binding
negative control initially reused an event ID and was masked by deduplication. The latter
was changed to a fresh event and now fails when the ownership guard is weakened.
Development also corrected two lint coercions and moved billing schemas into the
contracts package after the DB package correctly refused an undeclared Zod import.
No broad dependency upgrade was used to hide failures. A final unit invocation made
without socket permission failed with `listen EPERM` in existing loopback HTTP/JWKS
fixtures; the unchanged suite was rerun with local socket permission. Its separate
failure log is retained, not misclassified as a product or provider failure.

Warnings: thirteen pre-existing script console warnings; Next's existing flat-config
plugin-detection warning; expected unauthorized/retry/provider-failure fixture diagnostics.
Local PostgreSQL is 18.3/pgvector 0.8.1, not proof of the hosted provider's version or
its operational behavior. No live acceptance or browser/provider QA was performed.

## Remaining gates and next order

1. Keep ADR-019 operational authority and final receipts blocked. Prepare the concrete
   independent custody/enrollment/witness/admission/hold/rotation/restore-drill design;
   provider selection, infrastructure, credentials and activation need separate approval.
2. Finish recovery password-policy/limiter/admission adapters and whole-app MFA policy;
   then controlled provider recovery/rotation/expiry/replay evidence and accessible UI,
   only after the explicit provider/deployment gate. Lost-factor reset stays closed.
3. Complete bounded export coverage, privileged originals/identifier policy, pending-file
   sweep, artifact/notification journal and account-wide deletion/provider inventory.
   Retire no evidence until independent restore/hold authority is established.
4. Complete serialized Stripe TEST refetch/reconciliation, invoice ownership, durable
   subscription/entitlement/outbox state, seven-day grace and full lifecycle tests.
   Never interpret this inbox foundation as paid entitlement or hosted proof.
5. Complete Plaid Sandbox durable custody/inbox/cursor/reconnect/unlink and privacy
   lifecycles, then backend-supported UI/accessibility and synthetic end-to-end proof.
6. Only after separately authorized deployment/provider actions: exact-candidate stable
   staging smoke/acceptance and all provider/document/reminder/privacy/browser matrices.

Independent local implementation remains possible; these limitations are not a claim
that every remaining task is externally blocked or that the launch mandate is complete.
The genuine operational dependencies are separately approved trust-plane custody and
hosting, provider configuration/lifecycle access, legal operator/jurisdiction/contact,
pricing/cap validation, and consequential rollout authorizations. None is inferred here.

Supabase conclusion remains exactly: three September 13 upstream gateway HTTP 504s
confirmed; no request-linked Auth/DB/dependency evidence proves the deeper cause.
OAuth revocation/replacement is established; historical management-token invalidation
is unproven. The sanitized [support packet](supabase-support-packet-20260920.md) remains
**PREPARED BUT UNSENT**. No timeout increase, credential retry or provider mutation.
Production, live payments, real financial ingestion, real sensitive-document/model
processing, DNS, merge, deployments and public launch remain closed. **NO-GO**.
