> Superseded locally by [ADR-021](../architecture/adr/ADR-021-processing-reservations-and-clean-custody.md)
> and [the processing/custody verification](processing-custody-verification-20260921.md).
> The original design below records the earlier unresolved state; hosted activation,
> product retention approval and full document lifecycle remain gated.

# Processed-document quota and safe pending custody

Status: **required implementation; storage architecture conflict unresolved**.
PRD §21.2 is approved product policy. This document is not approval to amend ADR-016
or enable intake. Free 10 / Premium 50 and warnings 8 / 40 are now configuration;
member gateways use that policy locally. Document execution does **not** yet do so.

## Observed mismatch

`document-upload.ts` reserves quota from in-flight upload URLs and increments
`docs_used_this_period` on upload completion, before scanning/extraction/review.
That prototype is not “processed documents.” Rejecting completion after sealing can
leave an unselected private object. `document-scans.ts` advances a clean scan to
processing without a durable processing-quota reservation. Neither behavior is an
acceptable activation of §21.2. Intake remains disabled; existing route tests prove
the old prototype only, not this newly approved policy.

ADR-016's approved quarantine lifecycle expires objects after seven days. A file
received after exhaustion may wait until next month, longer than seven days. Removing
that expiration or promising retention without a durable custody path would silently
change the approved storage architecture. No such configuration or infrastructure
change was made. No record is deleted or archived on downgrade.

## Required bounded execution design

1. Separate storage admission (bounded outstanding objects/bytes; refuse before
   accepting bytes when unavailable) from processing allowance. Price is not storage
   safety authority. Once bytes are accepted, never discard due to plan capacity.
2. Preserve an exact immutable object in a reviewed pending-custody namespace before
   any temporary quarantine copy expires. Copy provenance, checksum, selected version,
   ownership and verified independent absence on later erasure must remain available.
   Scanner and model permissions must not expand to namespace administration.
3. A household-scoped processing journal must bind document/version/hash and an opaque
   attempt token. Transactionally reserve on database time under the privacy/quota
   lock. Count successful completions plus live/in-progress reservations; pending
   documents consume storage bounds but no processed-document usage. No consumer may
   treat a duplicate delivery as a new document or completed effect.
4. Complete usage exactly once with the provenance-backed successful processing
   transition, audit and outbox in one transaction. Ambiguous failures retain the
   reservation until reconciled; do not reclaim merely because a message lease expires
   while an external operation may still be running. Rejection is not success.
5. Entitlement months remain UTC calendar months independent of billing cadence.
   Crossing month boundaries requires an explicit completion/admission policy: reserve
   against the completion period or queue safely; never silently charge twice or reset
   on cancel/re-subscribe. Keep existing usage until a reviewed migration can distinguish
   historical upload counts from successful processing (the old column cannot prove it).
6. Re-evaluate effective entitlement at admission and commit using DB time. Expiry or
   downgrade keeps existing objects and derived rows, stops additional consuming work,
   and never silently deletes/archive records. A bounded reconciliation invocation can
   admit safe pending objects after capacity/plan changes, without continuous workers.
7. Before adding the journal: source inventory, RLS, immutable tenant binding, deletion
   fence, retention/restore classification, bounded audit retention and rollback/lock
   analysis. ADR-019 remains disabled; no final receipt or backup/provider erasure claim.

## Specific remaining architecture decision

Review pending-original custody that can outlive seven days: exact namespace/provider,
maximum outstanding byte/object budget, scanner-only read boundary, encryption/access
policy, expiry reconciliation and user-visible handling when safety cannot be guaranteed.
This changes storage lifecycle/authority and therefore needs an ADR and explicit review,
not a flag flip. Local synthetic design/tests can continue; hosted changes remain closed.

Required proof includes simultaneous final-slot admissions, lease/commit crashes,
month transition, plan transition, grace expiry, refused scans, duplicate/reordered
messages, archive/delete races, pending retention beyond quarantine expiry and exact
fixture cleanup. Current member/billing tests do not substitute for those document tests.
