# ADR-020: Dedicated TEST billing authority and entitlement projection

**Status: APPROVE WITH REQUIRED AMENDMENTS, principal-security review, September 21,
2026.** The founder explicitly authorized this review decision and subsequent local
implementation. The amendments below are normative. No hosted invocation, provider
mutation, Live mode, deployment or Production change is authorized.

## Required amendments and reviewed decision

1. **One narrowly trusted TEST reconciler.** Keep claims, immutable binding reads,
   closed subscription state and its effective projection in one transaction authority.
   Splitting projection into another service adds a durable handoff and still trusts the
   reconciler's provider facts; it does not independently verify Stripe. Do not acquire
   a second principal without an independent attestation mechanism. The dedicated role
   is a trusted verifier of provider facts, not proof against a compromised reconciler.
2. **Remove old authority atomically.** Disable invocation; a single bounded migration
   replaces guards and revokes generic-worker billing SELECT/INSERT/UPDATE before
   granting the dedicated role. Local tests switch connections only after migration.
   No dual-authority compatibility window. Rollback disables invocation and preserves
   journals; do not restore generic-worker grants or reset terminal work.
3. **Invoker enforcement beyond grants.** Review `guard_household_write`, notice/state
   guards, journal audit, and outbox. The new role must hit the privacy fence even though
   older role lists omit it. Pin expected revision in the claimed row, stamped by DB,
   inaccessible to direct role edits. Check lease token, DB-clock expiry, binding and
   revision inside the state guard. Deferred commit checks require terminal work and
   exactly one revision-bound opaque outbox event; neither can commit in isolation.
4. **Narrow admission reads.** Grant household ID and deletion household/state columns.
   Owner continuity uses only household/user UUID and role from `household_users`, with
   an additional restrictive SELECT policy exposing only the immutable binding's owner
   in the selected household. No names, account/profile fields, household members,
   document/secret/Plaid rows, generic inbox, or general household SELECT. This limited
   ownership assertion is essential to preserve existing owner-loss refusal.
5. **Bound journal publication.** Exact column grants; no arbitrary audit/outbox rows.
   Audit inserts must originate inside reviewed billing triggers, use closed table/op
   names, system actor and no payload. Billing outbox is one closed event/revision bound
   to the committed state; no provider IDs, arbitrary metadata, destinations or queue
   publication. No persistent runtime credential, membership or SECURITY DEFINER.
6. **Independent internal intent.** UUID identity and closed reason, exact binding,
   durable deduplication key, three DB-time 60-second claims maximum. No fake Stripe event.
   Notice and intent leases mutually exclude by binding. The source kind remains explicit
   through commit and export/retention classification.
7. **Separate effective projection, no invented caps.** Use a read-only TEST projection
   derived from the same closed state and PostgreSQL time, not mutable `entitlements`
   plan fields. Its eligibility never authorizes a hosted route or paid resource cap
   until separately authorized rollout. PRD §21.2 now ratifies the provisional local
   catalog: Free 10 / Premium 50 processed documents, warnings 8 / 40; self excluded,
   one Free managed human, unlimited Premium humans, pets/entities/archived excluded.
   No trial grant. Safe pending retention remains an intake prerequisite.
8. **Privacy/restore coverage before models.** New intent rows are opaque provider-work
   evidence: inventoried, fenced, export-classified internal (safe state is exportable),
   RESTRICT deletion, protected from runtime retirement. ADR-019 remains unactivated.
   No final deletion receipt or claim of provider/backup erasure.

This is a local architectural approval, not a claim that its implementation or tests
already pass. [Review evidence](../../engineering/adr020-security-review-20260921.md)
records the existing SQL paths, rationale, implementation gates and residual risks.


## Original evidence motivating review (before cutover)

The current `app_job_worker` has SELECT on whole households and memberships, generic
job deliveries/inbox, outbox and audit in addition to TEST billing tables. Billing
needs neither document processing nor generic consumer completion authority. A new
NOLOGIN/NOBYPASSRLS `app_billing_test` role, with no membership in the generic worker,
materially reduces authority. It also becomes a new financial authorization writer;
that trust change warrants an ADR before grants or entitlement projection are added.

Simply granting existing table privileges to a new role is unsafe. The notice/state
triggers currently return early when `current_user <> 'app_job_worker'`. A role change
must replace those allowlisted guards, not silently bypass lease/revision checks.
Administrative fixture/migration authority remains distinct; no runtime may choose it.

## Reviewed minimum authority

- Exact household-scoped TEST binding IDs only: binding/household/account/customer/
  subscription, without arbitrary metadata or account/profile data.
- Claim/update only bounded TEST notice lease/state/attempt columns, and bounded
  reconciled-state columns; immutable provider identifiers stay immutable.
- A distinct internal reconciliation-intent journal with random UUID identity and a
  closed reason enum; never a fabricated Stripe `evt_` identifier. Both notice and
  internal intent must bind the same immutable TEST subscription.
- SELECT only household existence and deletion-fence columns needed for admission.
- A separate effective-entitlement projection writable only through the reviewed
  TEST transition. No arbitrary plan/cap editing, resource usage resetting or granting
  Premium from application pages. App requests receive SELECT-only projection fields.
- INSERT only required audit/outbox columns and sequence usage, with closed event
  types and content-free bounded payloads. No generic inbox or unrelated job grants.
- No user/profile/member/document/secret/Plaid data, no provider tables, no role
  assumption, no SECURITY DEFINER shortcut and no BYPASSRLS.

RLS predicates must require exact transaction-local household scope on every new
journal/projection. Worker discovery remains the existing reviewed dispatcher;
message delivery is not entitlement authority. Provider SDK calls occur between
short transactions, never inside one.

## Atomic reconciliation and effective caps

One transaction reacquires the privacy lock, binding serialization lock and notice/
intent lease; verifies database-time ownership and expected state revision; commits
closed subscription state, effective entitlement, terminal notice/intent, audit and
outbox together. Provider account/customer/subscription/invoice/price/product are
independently refetched in TEST mode and matched against immutable local bindings.
Metadata and event ordering cannot supply authority. Ambiguous refetch leaves the
previous bounded state unchanged and schedules only a bounded durable retry.

Gateways calculate eligibility on the PostgreSQL clock after serialization, not a
cached `plan` label or delayed worker. Grace ends at the original paid-through plus
seven days and cannot slide on duplicate failures. A stale event triggers current
refetch, not state rollback. Cancellation/expiry cannot reset monthly usage or delete
user records. The exact Free/Premium catalog and managed-human semantics are now
ratified in PRD §21.2; $12/month or $99/year remains provisional pricing. Local member
enforcement is implemented; processed-document accounting and safe pending custody
are separate unfinished gates.

## Migration and verification requirements

New empty journals/projection; explicit column grants and runtime trigger guards.
Do not modify historical migrations. Existing role grant removal and trigger swaps
need a bounded lock-timeout deployment sequence with workers disabled. Measure index
and validation lock cost against the actual row inventory; do not invent a 100k-household
capacity result. A migration review must estimate per-household journal/index growth
using measured row widths and stated retention assumptions. Rollback disables billing
invocation and retains journals; never erase evidence or roll a terminal event back
into replayable pending work. Hosted rollout stays separately gated.

Restricted-role negatives must prove no document/secret/Plaid/general-household access,
no cross-tenant reads/writes, no binding mutation, no direct cap grant, no unfenced
commit, and no stale lease/revision. Prove atomic rollback at each commit stage,
seven-day grace/expiry, duplicate/out-of-order notices, missed-event intent, crash
recovery, price/product/account mismatches, and Live-object refusal. Extend deletion
inventory/export classification before introducing any durable model. ADR-019 journal
retirement and final-receipt gates remain unchanged.

The approved product catalog does not authorize hosted rollout. The TEST projection
remains non-authoritative for hosted Premium resource caps. Independent local auth/export/UI
work continues. Initial migration requires empty notice/state journals; populated
history must stop for a separately reviewed compatibility cutover rather than rewriting
append-only audit evidence. See the [local verification report](../../engineering/billing-authority-verification-20260921.md).
