# Local whole-app policy continuation — September 21, 2026

**Verified local increment, not completion of all requested objectives. Production preflight: NO-GO.**
No push, PR mutation, merge, workflow, deployment, provider mutation, hosted migration,
Production access, live billing, real financial/document ingestion, model call, DNS
change or support submission occurred. The existing private preview is local only.

## Candidate and preservation

- Branch/worktree: `codex/review-pellum-hardening-v2` at `/private/tmp/pellum-native-review-20260920`.
- Starting clean SHA: `9e6af7e7ad9b74d91a7584e04ba1996fc85b6851`.
- Tested candidate: `2ded06635ee74b590a9bc193440dea9098d7de9a`.
- Last runtime-code commit: `2a1ae8d14783ff16fba327539fa7d6bbc49b639f`.
- The two successors before this report add the ADR proposal and server-action tests/comment only.
- The final successor containing this report is documentation/evidence only; obtain its
  exact SHA from Git, rather than embedding a self-referential hash here.
- All **386** inventoried files in the original checkout retain their recorded SHA-256.
  Original modified `CLAUDE.md` and untracked work were not absorbed or changed.
- PR #5 was not contacted or modified. Its prior draft/unmerged state is retained context,
  not a new remote observation.

Focused commits:

| Commit | Change |
|---|---|
| `956ccf3` | Mandatory ordinary HTTP/SSR session admission, guarded local MFA/recovery mounts and security UI |
| `46f9efd` | Shared fail-closed PostgreSQL export limiter and concurrency tests |
| `2a1ae8d` | Content-free scanner stage/elapsed-time diagnostics |
| `625ab2d` | Proposed ADR-020 before creating dedicated billing authority |
| `2ded066` | Source-wide AST inventory for generated server-action boundaries |

## Delivered and remaining scope

Detailed contracts: [design and export inventory](whole-app-policy-design-20260921.md).

| Objective | Evidence-backed status |
|---|---|
| Whole-app policy | **Implemented for current ordinary HTTP and SSR entry points locally.** Thirty route files/39 methods classified: 29 ordinary protected methods, seven existing auth-special methods, three local account bootstrap methods. Explicit capability coverage; new route/method or server-action boundary fails inventory checks. This does not make hosted MFA/product recovery complete. |
| MFA/recovery | Three actual Next POST exports mounted only behind explicit synthetic-loopback guard. Enroll/challenge/verify/AAL2, one-use challenge/recovery, factor removal/last-factor refusal, strength/breach seam, password update, revocation acknowledgement and forced sign-in exercised through local signed provider/RLS compositions. Hosted mode refuses before DB/provider construction. Lost-factor reset stays closed; immediate issued-JWT revocation is not claimed. |
| Export | New shared limiter: 20/account and 60/trusted-IP per 15 minutes, missing IP/outage fail closed. Existing consistent encrypted partial snapshot/journal/crash/expiry/revoke/download tests pass. **Still incomplete**: originals, identifier reveal, record names/free text/attrs, full reviewed audit/provider data and ZIP remain omitted. `complete=false`; no completion notification. |
| Deletion | Existing restricted inventory/journal tests pass; no new durable artifact/model was introduced. Protected restore journals preserved. ADR-019 operational authority remains unactivated; `finalReceiptIssuable=false`. Account/household/provider/backup erasure is not claimed. |
| Billing authority | [ADR-020](../architecture/adr/ADR-020-dedicated-test-billing-authority.md) **PROPOSED**. A separate billing role materially changes authority; current trigger guards special-case the generic worker. Per the user's decision rule, implementation stops at this proposal until reviewed. No new grants. |
| Stripe TEST/Premium | Existing official-SDK refetch, immutable binding, diagnostic journal/state and atomic state/audit/outbox regression tests pass locally. Dedicated authority, internal missed-event intent and atomic effective Premium projection remain unimplemented. No Premium grant or fabricated provider event. Pricing $12/month or $99/year remains provisional. |
| Caps | Existing serialized Free/upload/member restoration and DB-time regression tests pass under the new policy boundary. Effective Premium/grace-expiry gateway races depend on the unimplemented ADR-020 projection; not claimed complete. |
| Plaid | Prior Sandbox-shaped contracts remain; durable custody/Item/accounts/webhook inbox/cursor/sync/unlink/export/deletion lifecycle remains required local work. No provider/real-account evidence added. |
| UI/accessibility | Local gated security panel with labels, live status, keyboard verification focus, destructive confirmation and cancel focus return; three component tests pass. No authenticated full-browser/mobile/contrast or screen-reader audit was completed. Recovery/export/delete/billing/Plaid product UI remains unfinished. |
| Scanner | Fixed stage names and monotonic elapsed milliseconds only; observer failures cannot alter verdict. Isolated real ClamAV lifecycle passes. No new contention experiment or hosted reliability proof. Prior CPU-contention deadline and unknown historical queued cause remain separate. |

## Security and race evidence

Ordinary requests require signature-verified immutable principal/session evidence,
one bounded current factor read, live active account and exact membership role.
Enrolled verified TOTP or household MFA policy requires AAL2/TOTP. Provider evidence
expires at sixty seconds; ordinary authorization is session-lived, while sensitive
export/delete/reveal retains fifteen-minute recent authentication.

Existing privacy-lock/transaction hooks check before work and after audit flush,
using PostgreSQL time. New tests refuse AAL1 reads/mutations, absent assurance,
owner downgrade/suspension/fence during factor I/O, stale factors, foreign identity,
revoked-factor evidence, prepared data after ownership loss and SSR name disclosure.
Provider outage returns a coarse 503 without returning household data or clearing
otherwise valid cookies. Existing scope tests retain actor/household binding,
nested/detached task refusal and synchronous commit checks. Bounded factor freshness
is not an instantaneous provider/DB snapshot or universal revocation guarantee.

Three source weakenings were deliberately applied, tested and restored:

1. Remove ordinary MFA denial: mounted AAL1 request returned 200 instead of expected 403.
2. Remove production-runtime local-mount guard: production-mode configuration was accepted.
3. Remove factor freshness bound: stale evidence reached a handler instead of refusing.

Each mutation failed for its intended assertion. `mutations.json` records restored
source hashes. These are **three current-run mutations**, not a re-run of the prior
checkpoint's eleven. AST fixtures additionally reject generated server actions,
including function-local and Unicode-escaped directives.

## Native validation

| Check | Result |
|---|---:|
| Frozen/offline pinned dependency validation | PASS; lockfile unchanged |
| Full uncached build/typecheck | PASS |
| Lint | PASS: 0 errors, 13 pre-existing warnings |
| Unit/regression | **1,901**: web 1,612; DB 40; contracts 152; AI boundary 89; ops 8 |
| Disposable PostgreSQL/RLS integrations | **675**: DB 223; web 452 |
| Local infrastructure/acceptance/source controls | **199** |
| CI architecture guards | **7** |
| Isolated real ClamAV synthetic lifecycle | **1**, 27.94 seconds test execution |
| Deliberate source weakenings | **3 caught and restored** |

Full DB/web integrations ran at `625ab2d`; their source/runtime tree is identical
at tested candidate `2ded066` except an account-recovery comment. Full units,
build/typecheck/lint and architecture guards were run again at `2ded066` after
adding six inventory tests. The isolated scanner lifecycle ran at `2ded066`.
No stale cached test result is presented as a new execution.

Pinned versions: Node **22.16.0**, pnpm **10.34.5**, Next **15.5.22**, TypeScript
**5.9.3**, Vitest **3.2.7**, Prisma **6.19.3**, PostgreSQL **18.3**, pgvector **0.8.1**,
ClamAV **1.4.6**, Stripe SDK **22.6.2**, zxcvbn **4.4.2**. Scanner image/engine/signature
digests and log SHA-256 values are in the machine evidence. pnpm reports ignored
dependency build scripts; existing generated/native prerequisites were verified by
build/tests. Existing Next ESLint integration warning is retained, not suppressed.

Only `127.0.0.1:55540/pellum_adr018_final` was used. Admin connections establish
fixtures/read catalog state; authorization assertions use `app_user` and the existing
restricted worker roles. Cleanup readback finds fixture security/billing/export/job
journals empty. Local PG 18 evidence says nothing about a hosted DB's version/state.

Readback: **24** completed migrations, **0** unfinished/rolled back; all checksums
match Git; **32** forced-RLS tables; **42** policies; **23** privacy fences; **11**
journal audit triggers. Unchanged role and column-grant inventories, no new memberships,
no provider-table grants, no runtime-owned tables, no new SECURITY DEFINER functions,
no `ensure_rls` trigger. Temporary worker login credentials are removed; original
fixture role posture is restored. No migration added in this increment.

## Defects found and resolved

- Typed scope-role optionality initially failed TypeScript; made its explicit
  `undefined` value part of the scope type without weakening role validation.
- A deletion fence detected by the fixed admission SQL surfaced as an untyped 500;
  exact gate SQLSTATE 55000 now maps to a coarse refusal. Arbitrary SQL errors are not
  reclassified or exposed.
- Existing clock-skew quota tests were intercepted by the new JWT/session policy;
  the fixture now changes its clock after real JWT verification, preserving the
  intended downstream 402/409 assertions rather than accepting an earlier 403.
- Local mount/source allowlists needed explicit reviewed entries. No blanket bypass.
- Scanner cleanup throw-in-finally lint defect moved into a cleanup helper, retaining
  fail-closed cleanup semantics.
- The initial route test checked a known layout but not every generated server action;
  the final AST inventory closes that coverage gap.

All failed initial logs are retained alongside successful candidate evidence.

## Risks, decisions and exact next order

1. **Independent local export work:** versioned category evolution, reviewed original
   access/identifier reveal paths, bounded archive composition and full category
   reconciliation before any complete-export notice. Preserve legacy immutable
   artifact readability/cleanup during format evolution. Do not erase omissions in UI.
2. **Deletion:** extend coverage alongside each new durable model; keep ADR-019 trust
   authority/retirement/final receipts gated. A local absence observation does not prove
   downloaded copies, third-party stores or backups were erased.
3. **ADR-020 review required for that subtask:** accept/amend the proposed dedicated TEST
   billing authority before new role/grants/effective-entitlement projection. Then
   implement internal intents and atomic lifecycle/cap races with restricted-role tests.
4. **Plaid local durability:** immutable owner binding, isolated encrypted custody,
   durable authenticated webhook inbox, bounded cursor sync, reconnect/unlink and
   provider-removal reconciliation; include every new row/artifact in export/deletion.
5. **Authenticated UI:** local synthetic backend/browser harness and recovery/export/
   deletion/billing/Plaid controls; keyboard, focus, mobile, contrast and failure matrix.
6. **Hosted work requires separate authorization:** trusted ingress/load/latency,
   provider MFA/recovery/session and stable-staging evidence. Mandatory factor reads
   and additional serialized admission transactions increase provider traffic/latency;
   they have no measured hosted capacity/availability result yet.

There is **no global external blocker to all independent local work**. The remaining
local objectives above are unfinished, not relabeled provider-blocked. ADR-020 is an
architecture decision for billing only. Hosted activation and provider evidence are
separate authorization dependencies.

Supabase diagnosis remains: three September 13 upstream gateway 504 records recovered;
deeper request-linked timeout hop unknown. OAuth revocation/replacement established,
historical management-token invalidation unproven. One-attempt credential behavior,
bounded transport and coarse errors retained; no retries or increased timeouts.
Support packet remains **PREPARED BUT UNSENT**.

Production preflight **NO-GO**: complete export/deletion, billing/Plaid durability,
reviewed authority, authenticated UI/a11y, hosted/provider/operational evidence and
prior legal/provider release gates remain. Local test volume is not full-stack or
launch-readiness evidence.

## Evidence

[Machine receipt and hashes](evidence/whole-app-policy-native-20260921.json).
Raw logs/helpers: `/private/tmp/pellum-wholeapp-20260921` (local, not a permanent
remote archive). Repository evidence contains safe counts, versions and hashes only.
