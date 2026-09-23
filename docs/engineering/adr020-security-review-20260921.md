# ADR-020 principal-security review

Decision: **APPROVE WITH REQUIRED AMENDMENTS**, under the founder's explicit local
review/implementation delegation. Read with ADR-020's normative amendments.

## Ground truth and decisions

Migration 20260923000001 grants generic `app_job_worker` notice read/insert/update;
20260923000003 grants state read/insert/update. Both notice/state trigger functions
return early for any other role. `app.guard_household_write` in 20260921000004 also
contains a fixed role list omitting a new billing principal. Swapping grants alone
therefore skips both transition and privacy enforcement. The state SQL guard stamps
revision but does not verify expected revision supplied by application code. Completion
requires a state row, but a state write can commit without completing a notice/outbox.
Those are required cutover corrections, not reasons to grant generic worker membership.

`app.audit_security_journal` is invoker-mode and writes through the caller's INSERT
privilege; minimal column grants alone do not constrain action names. Add billing-only
trigger-origin/closed-row checks. Outbox requires a bound event/aggregate/revision,
no arbitrary payload, and deferred atomic consistency. Restrictive RLS for ownership
reads must AND with existing permissive household policies; adding a permissive policy
alone would not narrow access. Table-level SELECT cannot be narrowed by column REVOKE:
first remove table privilege, then grant named columns.

One billing role is the smallest useful authority. Two services sharing the same
provider-derived statement do not independently prove its truth and complicate atomic
commit/recovery. The dedicated reconciler is explicitly trusted for TEST provider
fact verification; SQL cannot authenticate Stripe from an arbitrary JSON argument.
The actual provider seam remains official SDK 22.6.2 with zero automatic retries,
closed account/customer/subscription/invoice/price/product projection, repeated reads
and disagreement refusal. There is no atomic provider/DB snapshot guarantee.

No trial policy is approved. Internal intent uses UUID rather than event identity.
Grace is anchored to the last reconciled paid-through, never delivery time. Effective
eligibility uses DB time even if no worker runs. Existing `entitlements` combines usage
and user-writable legacy cap state; do not make it the new financial authority. A
read-only TEST projection avoids duplicating the ledger or resetting usage on cancel.
PRD §21.2 now records the founder-approved 10/50 processing catalog and self/managed-human semantics. Local TEST projection is explicitly fixture-admin activated, defaults disabled, and never resets the legacy usage period. Safe processing admission and pending-object retention remain separate work; do not reinterpret upload receipt as successful processing.

## Required SQL negatives

Actual restricted role must refuse general accounts, profile/member names, documents,
secrets, Plaid, job inbox/delivery, entitlement edits, role assumption, ownership,
cross-household data, immutable binding edits, identity changes, stale/reused lease,
wrong revision, unowned binding, fence, unrelated audit/outbox and partial commit.
Old generic worker must refuse all billing mutations after atomic cutover. Test both
API composition and direct SQL, including deliberately weakened high-value guards.

## Cutover, rollback and lock bounds

No hosted rollout now. Eventual sequence: disable old billing invocation/drain leases;
back up reviewed journals; run bounded migration atomically; verify new and old roles;
switch the disabled caller to the dedicated credential/runtime; reverify; enable only
through separate rollout approval. Lock timeout 5 seconds, statement timeout 60 seconds.
New empty intent table; state FK/check/index changes acquire locks and validation scans
existing metadata rows. A partial unique billing outbox index scans existing outbox;
measure actual inventory before hosted rollout, and use separately reviewed concurrent
index preparation if it cannot fit the bound. Abort rather than raising lock limits.
Rollback disables invocations and leaves new/old terminal evidence intact. A code
rollback must not restore grants or replay completed work. Measure local row/index
widths; any 100k-household estimate is an assumption, never performance proof.

## Privacy and remaining limits

Intent rows contain opaque binding/work IDs only. Inventory/classification and RLS
must land with the model. No automatic deletion, signed final receipt, provider erase,
external model or backup assertion. Complete export originals/reveal remain separate
reviewed access paths; generic attrs/ciphertext are never bulk-exported.

Sources checked: [PostgreSQL grants](https://www.postgresql.org/docs/current/sql-grant.html),
[row-security composition](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[Stripe subscription event handling](https://docs.stripe.com/billing/subscriptions/webhooks).
Local SQL and pinned SDK code are implementation evidence. Supabase changelog retrieval
failed; no Supabase API/configuration/package changes are being made. No hosted diagnosis
or credential access follows from this review.


## Adversarial review finding: temporary-trigger spoofing

A restricted billing role can create a temporary table/trigger under ordinary
PostgreSQL temporary-schema authority. Its trigger can call the audit INSERT with
`pg_trigger_depth() = 2`. The initial depth-only guard accepted a forged second
notice-insert audit; the new negative test failed against that implementation.
Migration 20260924000002 also binds the audit to the existing scoped journal row,
closed expected action and exact monotonic transition ordinal. The household lock
serializes this count with every billing transition. A complete existing transition
already has its audit, so an extra nested append is refused; removing the automatic
audit trigger is not runtime authority. No SECURITY DEFINER or broad database-wide
TEMP privilege change was introduced. Revalidation must include genuine claim,
retry, refusal, state revision and replay audits as positive controls.

Only audit rows stamped by the new SQL guard with the bounded integer
`billing_transition` participate in its ordinal check. Fixture/admin clock edits
retain their ordinary audits and cannot make a normal retry look like an extra claim.
The role cannot submit that metadata itself. The initial cutover now requires empty
notice/state journals; existing history must stop for a separately reviewed compatibility
plan. No append-only audit is rewritten to manufacture a baseline. This restriction
is a migration precondition, not a claim that existing hosted journals were inspected.

The ordinary application role is also refused the reserved billing target/action
namespace and the SQL-stamped transition metadata. A separate historical regression
demonstrated that omitting this restriction allowed a non-billing caller to spoof
billing evidence. Both attack controls pass with the final guard.

## Measured local migration estimate

PostgreSQL 18.3 `pg_column_size` of a synthetic representative intent composite is
244 bytes; the intent journal has three indexes. This measures neither heap-page
utilization nor index size, TOAST, audits, outbox, WAL, backups or peak lock duration.
For an explicitly hypothetical 12 intents per household per year and 100,000
households, 1.2 million composites are 292.8 MB (about 279.2 MiB) before those costs.
The two-row catalog is global non-personal configuration. Real notice/intent frequency
and journal-retention policy still need measurement; this is not capacity evidence.
Local 27-migration readback matches source checksums, with no failed/rolled-back
migration in the fresh candidate database. Earlier disposable development failures
remain in the private evidence directory; they were not repaired by changing history.

The founder's explicit self declaration now reaches both onboarding and member-create
gateways. Server code binds only the authenticated canonical owner; browser `user_id`
is refused. Existing unbound records are not inferred or silently rebound. A reviewed
existing-record self correction remains work before a hosted compatibility rollout.

See [final local verification](billing-authority-verification-20260921.md) for exact
candidate, role readback, test counts and incomplete document-processing enforcement.
