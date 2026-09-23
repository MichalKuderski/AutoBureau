# Pellum local sensitive lifecycle verification

**Status: verified local increment; broader launch work remains incomplete. Production
preflight: NO-GO.** No hosted/full-stack claim, push, PR edit, merge, workflow dispatch,
deployment, hosted migration, provider mutation, Production access, Live Stripe,
real financial-account connection, real sensitive-document/model processing or DNS
operation occurred.

## Source and preservation

- Isolated worktree: `/private/tmp/pellum-native-review-20260920`.
- Branch: `codex/review-pellum-hardening-v2`.
- Starting clean HEAD: `4278a15bb1e2fea530ef2b029ff114e184ce624c`.
- Tested implementation: **`af570debe2298b2045c34abf39066ee972979a71`**.
- A subsequent documentation/evidence-only commit records this report. It changes no
  tested runtime, schema, dependency or test source.
- All **386** inventoried original user files remain byte-for-byte unchanged. The
  original checkout, modified `CLAUDE.md` and untracked user work were not discarded,
  reset, stashed, cleaned or absorbed.
- PR #5 was not accessed or changed remotely. Its reported draft/unmerged state is
  retained context, not a fresh provider readback.

Focused implementation commits:

| Commit | Result |
|---|---|
| `70f30df` | Closed account policy, route inventory/AST guard, real local HTTP MFA composition, transaction-time scope and drift tests |
| `87dcfd3` | Final sensitive check after audit flush; reject asynchronous policy callbacks and stale factor evidence |
| `5132260` | Guarded local partial-export HTTP lifecycle and active-account checks |
| `af570de` | Serialize cap reads with entitlement writes; PostgreSQL time for upload quota/expiry and member restoration |

## Implementation and coverage

The [design and authoritative inventory](sensitive-operation-enforcement-20260921.md)
explain the security boundary and what remains gated. All **27 mounted route files /
36 HTTP methods** are classified and their literal authorization wrappers checked by
a native AST guard. Six in-memory route mutations test the guard itself. This does
**not** prove whole-app MFA: ordinary mounted routes have not acquired that policy,
and local MFA/recovery/export compositions remain unmounted.

The central sensitive executor constructs a principal/household-bound request scope
from verified identity and fresh provider factors. Every scoped database transaction
in that operation checks live active owner, fence, current MFA policy and DB time
before work and after audit flush. It rejects cross-household/actor use, scope
replacement, privileged/non-household escapes, asynchronous policy callbacks and
detached work after completion. Owner/fence changes during file/provider work refuse
subsequent mutation or data release. Provider evidence is bounded, not an atomic
provider/database snapshot or instant JWT-revocation proof.

MFA challenge journals and audits recheck policy inside the committing transaction.
Controller/HTTP tests include signed same-session AAL2 cookie rotation, one-use
challenge consumption, current factor policy and owner changes during provider reads.
Recovery initiation now needs no household or JWT. Recovery retains single redemption,
password-strength/breach checks, factor confirmation, refresh revocation, forced
sign-in and coarse failures. A slow factor read or audit no longer manufactures
freshness before a sensitive provider mutation. Hosted activation remains gated.

The export controller exercises request/build/retry/download/revoke against actual
local encrypted artifacts and RLS journals. It requires caller-supplied rate limiting;
its HTTP composition tests use a deterministic limiter fixture. A production/shared
export-limiter composition is not proven. Export remains explicitly **partial**:
original documents, identifiers, arbitrary free text/attributes, full audit and
financial provider data are not silently reported as included. No complete-export
notification, final deletion receipt or independent backup/provider erasure claim.

Existing upload, member-create/restore and onboarding gateways now read allowances
under the same existing privacy lock used by entitlement writes. PostgreSQL time
governs upload rollover/expiry and the member restore window. No plan limits or
pricing changed. These gateways still use existing entitlement rows; the Stripe
TEST journal has **not** been activated as Premium authorization.

## Final native verification

| Check | Result |
|---|---|
| Offline frozen-lockfile installation | PASS |
| Full uncached build/typecheck | PASS / PASS |
| Lint | 0 errors; 13 pre-existing warnings |
| Unit/regression | **1,874 passed**: web 1,585; DB 40; contracts 152; AI boundary 89; ops 8 |
| Disposable PostgreSQL/RLS integration | **657 passed**: DB 223; web 434 |
| Local infrastructure/acceptance controls | **195 passed** |
| Architecture guards | **7 passed** |
| Real isolated ClamAV document lifecycle | **1 passed**, 26.232 seconds |
| Deliberate source weakenings/historical regressions | **11 caught and restored** |
| Schema/checksum/role/grant readback | PASS; unchanged |

The real-scanner lifecycle uses synthetic canonical PDF content, simulated human
review and local transport. It is not hosted document intake, model processing,
ADR-017 live transport, stable staging acceptance or full privacy completion.

The eleven negative controls cover factor-read freshness; post-audit MFA and
recovery checks; household binding; scope lifetime; async-callback refusal;
post-audit-flush rollback; inactive-account export denial; historical member-cap
serialization; historical upload clock rollover; and historical restore-clock
bypass. The three historical gateways incorrectly returned 201/201/200 where the
fixed routes require 402/402/409. Every edited source was restored before final
validation. Mutation evidence is not combined with the previous checkpoint's counts.

Pinned toolchain: Node 22.16.0, pnpm 10.34.5, Next 15.5.22, TypeScript 5.9.3,
Vitest 3.2.7, Prisma 6.19.3, Stripe 22.6.2, zxcvbn 4.4.2, PostgreSQL 18.3,
pgvector 0.8.1 and pinned ClamAV 1.4.6 image/signature hashes. Native PostgreSQL 18
is not evidence for every hosted/CI database version. The pre-existing Next ESLint
plugin warning remains. No warnings or provider evidence were relabeled as passes.

Retained verification corrections: an initial auth run lacked sandbox permission
for loopback HTTP fixtures (22 failures / 23 errors); the authorized rerun passed
555 auth tests and the final full suite passed. An incorrect ESLint `--force`
argument was corrected. An initial disposable PostgreSQL start omitted its port,
failed to bind occupied 5432, and was restarted explicitly on 55540. The existing
5432 listener was neither accessed nor modified. None required a product workaround
or increased timeout.

## Database/security readback

Only disposable `127.0.0.1:55540/pellum_adr018_final` was used. Restricted-role tests
perform authorization assertions through `app_user` and reviewed worker roles;
administrative connections seed/clean synthetic fixtures and inspect schema.

- **24** completed migrations; **0** unfinished; **0** rolled back; all checksums
  match repository SQL. No new migration in this increment.
- **32** forced-RLS tables; **42** policies; **23** privacy write fences;
  **11** journal audit triggers; **0** `ensure_rls` triggers.
- Role/grant inventories match the previous readback. No provider-table grants,
  runtime-owned tables or new SECURITY DEFINER functions.
- `app_user` remains the local non-superuser/NOBYPASSRLS application login. Worker
  roles remain restricted; the existing reviewed dispatcher BYPASSRLS exception is
  unchanged. Temporary worker passwords/logins are cleared.
- Scan/deletion/challenge/export/billing/job fixture journals read back empty.
- The disposable server is stopped; its fixture directory is retained for continuation.

## Scanner contention evidence

No unrelated Docker containers were running. The scanner retained one CPU, 3 GiB,
40-second execution and 5-second cleanup limits. All load/scan containers were removed.

| Controlled local condition | Result |
|---|---|
| First fresh container, pre-existing cached image | CLEAN, 23.729 s |
| Subsequent fresh container, warm image | CLEAN, 19.699 s |
| Two simultaneous invocations | CLEAN, 29.359 s and 29.645 s |
| Six-CPU bounded synthetic load | Deadline refusal, 40.729 s |
| 360 MiB synthetic tmpfs load, 512 MiB container cap | CLEAN, 22.191 s |
| Caller cancellation | Closed runtime failure, 0.184 s; cleanup empty |

CPU contention **can** produce a deadline here. It does not retrospectively prove
why the previous concurrent run returned queued, whose exact broker error was not
captured. A true cold image-cache run was not established; no shared cache/image
was deleted. These ARM64 Docker Desktop/amd64-emulation observations do not establish
hosted Linux reliability. No budget or retry limit was raised to obtain green results.

## Remaining risks and continuation

| Area | Current status / next required work |
|---|---|
| Whole-app sensitive/MFA policy | Local account/export transaction enforcement proven; ordinary routes and hosted activation remain incomplete |
| MFA/recovery | Local controller/HTTP/DB evidence; whole-app enforcement, reviewed ingress/template and provider lifecycle evidence still required |
| Export | Guarded partial JSONL artifact; complete reviewed categories, shared export limiter, custody/deployment, full UI and complete-export delivery remain |
| Deletion / ADR-019 | Protected journal retirement, independent operational restore authority, provider/backup proof and final receipts remain gated |
| Stripe TEST | Existing durable TEST state unchanged; dedicated billing role, internal missed-event intent, atomic entitlement projection and full lifecycle remain |
| Premium/caps | Existing gateways' races/time defects repaired; reconciled Premium expiry/catalog not activated; $12/month or $99/year remains provisional |
| Plaid | Required launch work; durable Sandbox custody/sync/unlink/export/deletion remains incomplete |
| UI/accessibility | No new UI mounted; no new authenticated browser or accessibility-completion claim |
| Supabase 504 | Three upstream gateway failures confirmed previously; deeper request-linked hop unknown |
| Credential containment | OAuth revocation/replacement established previously; historical management-token invalidation unproven |
| Support packet | PREPARED BUT UNSENT |
| Stable staging | Not deployed or tested in this continuation; no Preview/local evidence relabeled as stable |

**Independent local work remains**; the passing totals are not a claim that all
requested objectives are finished or that every remaining task requires a provider.
Next order: complete ordinary-request MFA policy and activation-safe compositions;
finish reviewed export/deletion boundaries; implement narrow TEST billing authority,
internal reconciliation and atomic effective entitlements; then Plaid durability and
backend-supported UI/accessibility. Provider diagnostics, real MFA/recovery/financial
lifecycles and stable-candidate validation retain their separate external gates.

Production prerequisites include completing that implementation, approved legal/operator
and privacy details, independently reviewed deletion/restore authority, real hosted
security/provider evidence, exact-candidate stable-staging acceptance and separate
explicit deployment/Production/live-payment/real-data approvals. No public launch.

The private preview is restored at `http://127.0.0.1:4317/` (loopback only, no provider
credentials). Its homepage is not authenticated end-to-end evidence. Current tool
session: `1038`; stop only this preview before a later build that shares `.next`.

Machine evidence: [native verification JSON](evidence/sensitive-lifecycle-native-20260921.json).
Raw logs, mutation receipts, scanner measurements and SHA-256 hashes:
`/private/tmp/pellum-sensitive-lifecycle-20260920/`.
