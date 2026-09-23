# Local TEST billing authority and provisional plan verification

**Production preflight: NO-GO.** This is local implementation and disposable-database
evidence. It is not a hosted Stripe lifecycle, stable-staging acceptance, full-stack
release verification, or authorization to deploy. Document intake remains disabled.

## Source and approval

Worktree: `/private/tmp/pellum-native-review-20260920`, branch
`codex/review-pellum-hardening-v2`. Start: `538bf5ff60f18413c697ad038d23329d32c5c322`.
Git confirms that its difference from the prior tested candidate `2ded066` is five
documentation/evidence files only. All 386 inventoried original-checkout files remain
byte-identical; the original modified `CLAUDE.md` and untracked work were not absorbed.

**Tested implementation: `722e0e9908c9e0f48831d624b4dac0fa12d26c1b`.** The report/evidence
commit following this SHA changes documentation only; use its Git SHA as the final
continuation HEAD, and this SHA for the tested application tree. Nothing was pushed,
PR #5 was not changed or remotely re-read, and no workflow/deployment was dispatched.

Local commits:

| Commit | Change |
|---|---|
| `e7be237` | Reviewed dedicated TEST authority, reconciliation, plan catalog and managed-human enforcement |
| `7809d43` | Strict historical export readability without invented fields |
| `320ab39` | Exact allowlisted disposable endpoint for the existing real-scanner proof |
| `722e0e9` | Explicit account-holder/self declaration, server binding and route/component regressions |

ADR-020 decision is **APPROVE WITH REQUIRED AMENDMENTS**, under the founder's delegated
review decision. [Review](adr020-security-review-20260921.md) and the amended
[ADR](../architecture/adr/ADR-020-dedicated-test-billing-authority.md) precede implementation.
[PRD §21.2](../product/PRD-v1.md#212-version-12--provisional-plan-catalog-and-counting-policy)
records the new founder product decision, F2/F14 reconciliation and metric impact.
Prices remain provisional $0 / $12 monthly / $99 yearly. No paid-provider activation.

## Implemented authority and reconciliation

- `app_billing_test` is NOLOGIN/NOBYPASSRLS, owns no tables and has no memberships or
  role-assumption grant. It uses transaction-local household scope and named-column
  privileges. No document/identifier, general user/profile/member, generic job inbox,
  entitlement-write or provider-table authority. Its narrow owner-continuity read
  exposes only UUID/role columns, with an additional restrictive policy.
- Generic `app_job_worker` billing grants, including column privileges, are removed.
  Trigger role checks and privacy admission moved with the authority; no dual-authority
  window. No SECURITY DEFINER function or persistent runtime credential was added.
- Internal reconciliation uses a UUID, closed reason and deduplication key, never a
  fabricated Stripe event. Notice and intent share per-binding serialization, bounded
  three-attempt claims and DB-time 60-second leases. SQL stamps expected revision.
- Official pinned Stripe SDK fixture paths refetch and validate closed TEST account,
  customer, subscription, invoice, price/product and cancellation facts outside DB
  transactions. Live or ambiguous/mismatched evidence is refused. Provider refetch is
  not an atomic provider/DB snapshot, and the reconciler remains a trusted verifier.
- Lease token/expiry, expected revision, binding, ownership and deletion fence are
  rechecked in SQL. State, terminal work, stamped audit and one revision-bound opaque
  outbox event commit atomically. Deferred checks also reject expiry before COMMIT.
  Requests never publish directly to queues. The local runtime factory refuses hosted
  markers, non-loopback targets, incorrect roles and URL-option overrides.
- Seven-day grace stays anchored to paid-through, cannot slide on duplicate failure,
  and expires by DB time even without a worker. Current refetch, not old event order,
  determines state. Cancellation/cadence transitions never reset entitlement usage.

## Plan policy: what is and is not enforced

The read-only, configuration-driven catalog is Free **10/8** and Premium **50/40**
processed-document cap/warning; managed humans are **1/unlimited**. The effective
TEST view is fixture-admin activated and defaults **disabled**. Neither the ordinary
application nor billing role can edit catalog/activation or grant arbitrary Premium.
SSR reads the same effective projection rather than a stale legacy plan label.

Member create/update/restore/onboarding use authoritative DB-time policy. SQL BEFORE
and deferred COMMIT guards cover direct writes, concurrency and expiry. Only active
adult/child/dependent rows beyond explicit self consume quota. Pets, entities and
archived rows do not. Self is declared through a labeled form and bound server-side
to the authenticated household creator. No age/name inference, client principal ID,
second login or invite. Existing overage is retained on downgrade; ordinary
non-consuming edits remain possible. An existing unbound self record is not silently
reclassified; an explicit safe correction path remains a compatibility requirement.

Verified races include simultaneous Free additions, archive/add, human-kind changes,
restore, overage downgrade, a downgrade winning the privacy lock before a queued add,
and grace expiry between mutation and COMMIT. Tests also preserve usage during
monthly/annual price changes and cancellation.

**Document-processing enforcement remains incomplete.** The prototype upload path
counts upload completion before processing; the scanner path has no durable processing
reservation. Seven-day ADR-016 quarantine cannot safely hold an exhausted-cap document
until the next entitlement month. No hidden lifecycle extension, document discard,
counter reset or intake activation was introduced. Configured 10/50 values do not
constitute gateway proof. Document final-slot, month/plan/expiry and pending-custody
races are still required. The [quota/custody design](processed-document-quota-design-20260921.md)
states the specific architecture conflict and implementation order.

## Export, deletion, Plaid and UI

The exporter still writes current V2. Strict readers now accept authentic historical
V1 and early V2 artifacts while preserving their original version and omissions;
missing account/profile/subscription fields are never invented. Unknown versions,
extra fields, claimed completeness and token fields fail closed. Synthetic authenticated
ciphertext exercises publication/read/reuse/revoke/sweep with existing owner, session,
expiry and deletion fences. The six new restricted-role integrations pass.

Export is **partial**: no full original-document ZIP, identifier reveal or complete
account export is claimed. New billing intents are included in inventory, retention,
fencing and export classification; the user export contains only safe state, not raw
provider, work or lease identifiers. ADR-019 is unactivated and
`finalReceiptIssuable=false`; no destructive journal retirement or provider/backup
erasure claim. Original inclusion/identifier reveal needs its narrow security review.

Plaid remains required launch work. Existing Sandbox transport/signature tests run in
the full suite, but this increment adds no token custody, durable Item/account/sync
journal, consent route or actual Sandbox lifecycle. Those are unfinished local work,
not excused by provider access. No real account or financial data was used.

UI changes include corrected 50-document copy, managed-human language, authoritative
plan label and explicit self controls. Route and component tests exercise authenticated
server bindings and payload rejection. They are not authenticated browser E2E or a
complete accessibility audit. Broad keyboard/focus/mobile/contrast/screen-reader and
provider-state matrices remain. The loopback preview at `http://127.0.0.1:4317/` is
running and returned HTTP 200 with Pellum content; that signed-out read is not
authenticated E2E or a hosted release. MFA/recovery policy suites passed without
weakening existing gates.

## Exact native validation

Commands use the pinned local runner, scrub ambient provider credentials, disable
telemetry and target only the isolated worktree. PostgreSQL assertions use `app_user`
or the relevant restricted runtime role; administrative connections only create
fixtures, read catalogs, inject controlled failure and clean fixtures.

| Check | Result |
|---|---|
| Offline frozen-lockfile dependency install | PASS |
| Forced full build and full typecheck | PASS |
| Unit/regression | **1,917**, 106 files: web 1,615, DB 53, contracts 152, AI 89, ops 8 |
| Disposable PostgreSQL/RLS integrations | **707**, 39 files: DB 229 + web 478 |
| Local infrastructure/acceptance controls | **199** |
| Architecture guards | **7** |
| Isolated real ClamAV synthetic lifecycle | **1**, PASS |
| Lint | 0 errors; 13 pre-existing `no-console` warnings |
| High-value deliberate SQL weakenings | 3 detected/restored; 4 assertions fail as intended |
| Historical audit forgery regressions | 2 attack cases reproduced before fix, now refused |
| Original-checkout preservation | 386/386 matching hashes |

Node 22.16.0; pnpm 10.34.5; Next 15.5.22; TypeScript 5.9.3; Vitest 3.2.7;
Prisma 6.19.3; Stripe 22.6.2; PostgreSQL 18.3; pgvector 0.8.1; pinned ClamAV 1.4.6.
Exact scanner image/engine/signature digests and evidence hashes are in the
[machine receipt](evidence/billing-authority-native-20260921.json). Node's experimental
MockTimers warning persists in the controls. No lockfile or package upgrade was needed.

The synthetic scanner proof joins real immutable local storage, isolated ClamAV,
restricted journals, canonical public PDF extraction, a local model stub, simulated
explicit cited review, outbox dispatch and truthful partial erasure. It does not prove
real-format redaction or complete document UX. Controlled CPU contention can still
cause a scanner deadline; the cause of the older `queued` result remains unresolved.
Budgets were not raised to obtain a pass. No external model call occurred.

## Local database posture and migration safety

Fresh disposable cluster: IPv4 loopback port 55541, `pellum_billing_20260921`.
**27 completed migrations**, 0 unfinished/rolled back, every checksum matches source.
**33 forced-RLS tables, 46 policies, 24 privacy fences, 12 journal audit triggers**.
No `ensure_rls`, new SECURITY DEFINER, provider table grants or runtime-owned tables.
Billing has zero memberships; old worker billing grants are zero. All temporary
runtime login/password grants are removed after tests. The pre-existing narrowly
reviewed dispatcher retains BYPASSRLS; this is not a claim that every role lacks it.
The two global non-personal configuration tables are explicit RLS exceptions with
runtime SELECT-only grants. Local TEST activation reads back false. Tested synthetic
scan/deletion/billing/export/job journals are empty after exact fixture cleanup.

Migrations 25–27 are additive local schema/guard changes with explicit old-role grant
revocation. Historical migration files remain unchanged. Lock timeout 5s / statement
timeout 60s. Eventual deployment must disable billing invocation before migration,
inspect real journal sizes, validate the new/old restricted roles, then switch the
caller under separate rollout approval. **Initial cutover requires empty notice/state
journals.** Existing hosted history must stop for a reviewed compatibility cutover;
no append-only history is rewritten. Index/check validation lock costs require live
inventory. Rollback disables billing and preserves terminal journals; it must not
restore generic worker grants or replay completed work. Representative intent tuple
width is 244 bytes with three indexes; [review](adr020-security-review-20260921.md)
explains the limited 100k-household estimate, not a performance claim.

Development failures were retained: initial migration syntax and reused-cluster role
collision, stale legacy-cap test assumptions, a multi-household self-test fixture
missing explicit household selection, and the two audit attacks. Fixes were followed
by clean-cluster and exact-candidate validation. No failed final check is hidden.

## Residual risks, boundaries and next order

1. Review pending-original custody versus ADR-016's seven-day lifetime. Implement
   bounded storage admission, durable processing reservations/completion usage,
   reconciliation and month/plan/grace/retention races before document intake.
2. Complete export original/identifier boundary review, archive/category composition
   and reconciliation. Continue explicit existing-record self correction and UI
   compatibility without inference or hidden cap exemptions.
3. Implement local Plaid encrypted custody and immutable owner binding, durable
   webhook/inbox/cursor/sync/removal journals and privacy coverage; synthetic adapters
   can progress without provider credentials. Then actual authorized Sandbox evidence.
4. Complete authenticated browser/accessibility matrix and full document/review,
   reminder, account-security/privacy and TEST billing lifecycle at the exact candidate.
5. Separately approve hosted cutovers and repeat stable-staging/security/provider
   evidence. ADR-017 live apply/probes, hosted scanner/dispatcher/retention and operational
   alert/cost verification are not established by this local work.

Independent local work remains; the specific custody conflict is not a blanket provider
blocker. The Supabase diagnosis is unchanged: three September 13 upstream gateway
HTTP 504s are confirmed, with no request-linked proof of the deeper timeout-producing
hop. OAuth revocation/replacement is established; historical management-token
invalidation remains unproven. Sanitized support packet **PREPARED BUT UNSENT**.
No credential-operation retries or timeout increases were added.

External/legal prerequisites remain: actual provider end-to-end evidence/permissions,
Supabase deeper diagnosis or defensible provider disposition, complete credential
containment evidence, operational erasure/restore authority, legal operator/jurisdiction/
public contacts, and separately approved rollout. Production, Live Stripe, Plaid
Production, real financial data, real sensitive documents/model processing, DNS,
merge, deployment and public launch remain closed. No provider account was accessed
or changed during this increment. Local test quantity does not change **NO-GO**.
