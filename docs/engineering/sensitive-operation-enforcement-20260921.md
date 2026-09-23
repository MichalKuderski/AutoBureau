# Local sensitive-operation enforcement, September 21

This increment is local development evidence, not hosted/full-stack evidence or
permission to enable MFA, recovery, document intake, model processing or billing.
Production preflight remains **NO-GO**.

## Authoritative inventory

[`operation-matrix.ts`](../../apps/web/src/server/auth/operation-matrix.ts) is the
single operation/route inventory. It distinguishes recent-auth operations,
bootstrap/step-up, public recovery, recovery completion and retention-worker
transitions. The native AST test checks every mounted route file, every HTTP method,
its literal capability and the actual `authenticated` import/call. An unclassified
route, added method, re-export, bypassed wrapper or computed/spread capability fails.
The existing mounted document read is metadata; it is not original-document access.

This is coverage control, **not proof of whole-app MFA**. Existing ordinary mounted
routes still use their established membership/capability boundary. The new account
and export HTTP compositions are dependency-injected local seams, not Next routes.
The separate source guard forbids importing them into routes/UI. No flag activates
them. CI source now explicitly runs this activation guard; no workflow was dispatched.

## Transaction boundary

The existing `app.assert_household_open` uses an **exclusive**, transaction-scoped
household advisory lock. Runtime household write triggers already take the same
lock. Earlier prose describing it as shared was imprecise; this increment does not
change its SQL. Security admission takes this lock **before** the live owner and MFA
policy reads, and takes a shared row lock on the active account. This closes the
previous owner-read-before-lock window without another schema or lock protocol.
Administrative fixture/migration authority is outside the runtime trigger boundary.

`runWithSensitiveScope` binds a verified request to one principal and household.
The existing `Database.withHousehold` validates the binding, active owner, fence,
current MFA requirement and database time both before domain work and after audit
flush, immediately before returning to commit. A failure rolls domain and audit
back together. Nested replacement, another actor/household, non-household database
capabilities and detached work after request completion refuse. Policy callbacks
must be synchronous; a returned Promise refuses rather than silently bypassing the
check. No network/provider call is performed by the transaction guard.

The server executor constructs this scope from signature-verified identity and a
closed provider-factor projection. Provider reads happen outside transactions.
Evidence age starts **before** the provider call, not when a slow response finishes.
It lasts at most sixty seconds; recent password or verified AAL2/TOTP lasts at most
fifteen minutes, bounded by token expiry. A final owner/fence/policy/time read also
refuses data release after slow file/serialization work.

This is not atomic with the remote provider. Factor changes or access-session
revocation after the provider read cannot be proven absent through a local lock.
There is no claim of instantaneous JWT revocation, no access to provider session
tables and no credential retry. Request/provider cancellation remains a bounded
ambiguity, not evidence that an external mutation did or did not occur.

## MFA and recovery

Both controllers use the same closed account-operation evaluator, with explicit
bootstrap exceptions. Verified-factor challenges work at AAL1 so step-up remains
possible; enrollment requires recent password when there is no verified factor.
Removing a verified factor from an MFA-required household remains refused. Signed
same-session AAL2 and current factor evidence are required before cookie rotation.

Challenge creation/consumption and audit writes repeat policy in their own short
RLS transaction on the database clock; consumption checks again after its row lock.
A slow audit cannot extend authority before enrollment/password mutation. Invalid,
duplicate, unknown or foreign-user factor results refuse. Session and factor IDs
must agree with the durable challenge binding. No browser-held provider state or
lost-factor reset was introduced.

Public recovery initiation has independent ports requiring no household candidate,
account lookup or JWT verifier. Existing shared rate-limit and password/breach
policies remain mandatory. Completion preserves single-use redemption, factor
checks, password update, refresh-session revocation and forced sign-in. The local
HTTP adapter bounds streamed request bytes and accepts the access cookie only.
Hosted trusted-ingress, email-template and provider lifecycle evidence remain gates.

## Partial export contract

The local export controller composes request, encrypted build, idempotent retry,
JSONL download and revocation with the central executor. Downloads use a fixed
`pellum-partial-export.jsonl` attachment name and private/no-store headers; no signed
URL or cacheable bearer capability exists. Inactive accounts are refused at each
export entry point. Owner/fence/MFA changes during file work cannot publish/release
an authorized result. Required caller-supplied rate limiting has no permissive default.

The existing bounded consistent snapshot and ciphertext journal are retained.
This is **not a complete F15 export**. Original documents, identifier reveal,
arbitrary attributes/free text, full audit and provider records retain their
reviewed omissions. No `export completed` notification or false completion claim is
emitted. Hosted key custody/downloads, full export contract, provider/backup erasure,
independent retention authority and final deletion receipts remain incomplete.

## Scanner experiment scope

The separate experiment uses synthetic canonical public PDF bytes and the existing
pinned amd64 ClamAV image on ARM64 Docker Desktop (8 virtual CPUs, 4,106,604,544 bytes
VM memory). Scanner budgets remain one CPU, 3 GiB, forty seconds plus five-second
cleanup. No unrelated containers were running. Results and exact fixture cleanup
are preserved in the native evidence directory and final verification report.

A newly created container with the already cached image and its subsequent warm
run are not a cold image-cache experiment. No image/cache was deleted. Bounded
CPU contention reproduced a deadline; it supports a possible mechanism for the
historical queued run but does not retrospectively identify that run's failure.
Two concurrent scans and bounded memory pressure passed. These measurements are
not hosted Linux reliability evidence, and do not justify raising scanner limits.

## Remaining order and gates

1. Finish ordinary application-wide MFA policy composition and reviewed route
   activation, including account-independent recovery ingress/provider evidence.
2. Complete reviewed export categories and independent deletion/restore authority;
   keep ADR-019 protected journals and final-receipt gates intact.
3. Introduce a narrowly scoped billing runtime, distinct internal missed-event
   intent and atomic entitlement projection. No TEST decision grants Premium yet.
   Review the cap catalog before binding effective DB-time state to every gateway.
4. Finish Plaid Sandbox custody/durable lifecycle and privacy inventory, then UI
   and authenticated accessibility/browser evidence.
5. Obtain exact-candidate hosted/stable-staging evidence only under separate gates.

Supabase remains three confirmed upstream gateway 504 records with the deeper hop
unknown. OAuth revocation/replacement is established; historical management-token
invalidation remains unproven. The support packet is **PREPARED BUT UNSENT**.
No provider, Production, deployment, DNS, live payment, real financial data or real
sensitive-document/model processing operation is authorized by these local results.

## Existing cap gateways and restore window

The gateway inventory is: document reservation (`POST /v1/documents/uploads`),
completion (`POST /v1/documents/[id]/complete`), person creation, person restoration,
and onboarding's person creation. Member creation/restoration and onboarding share
the same member lock. They now acquire the existing household privacy lock before
reading the entitlement, in the same order as other protected household operations.
This serializes a concurrent entitlement reduction with the actual domain mutation.

Document reservation/completion likewise acquire the privacy lock before the quota
lock/read. Database time **after** locking decides month rollover, pending reservations,
completion expiry and usage timestamps. A ticket already expired at that point is
refused. Person archive timestamps and the thirty-day restore decision also use
PostgreSQL time. No plan/cap value, pricing, provider credential or intake flag changed.

Restricted-role HTTP regressions reproduce both historical cap bypasses: queued
person creation after a cap reduction returned 201 rather than 402; a future host
clock reset the upload allowance early and returned 201 rather than 402. A historical
restore with a past host clock returned 200 rather than the required 409. The fixed
implementations refuse all three. Historical-source substitutions were restored.

This is enforcement of existing entitlement rows, **not** a completed Premium
billing gateway. TEST state does not yet update entitlements, and the complete
reconciled plan-expiry/cap catalog integration remains required work.
