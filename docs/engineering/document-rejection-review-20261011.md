# Rejection reason for reviewed readings — 2026-10-11

Separate local candidate on frozen source-review b960863; no publication approval yet.
Owner decision: Discard reading also rejects the result, requires a short reason category,
preserves the original, and adds no charge for discarding. It must not refund or rewrite
prior legitimate charges. This implements the rejection-reason portion of PRD F7 alongside
existing §21.3 finished-but-unfiled decisions, not general extraction/correction completion.

## Behavior

The owner selects one fixed category (incorrect reading, wrong document, duplicate,
not needed, other) before confirming. No free text or document contents are collected.
Cancel clears the selection and returns focus. Confirm sends the exact result and reason;
uncertain outcomes retain the original request and idempotency key. Authorization loss
conceals protected content and does not permit replay. New confirmations start blank.

The existing scoped transaction records the immutable decision/category, cancels pending
processing/custody and marks the reading discarded. It does not remove the source row,
change its storage path, call object storage or apply rejected data. An applied result
cannot be discarded through this flow; its charge/accounting remains unchanged. A replay
of a recorded discard returns the first decision without replacing its category or writing
another audit event. Old discarded rows show no invented reason.

The current result surface remains restricted to verified public synthetic deadline
results; this does not enable live AI, arbitrary-document extraction, corrections or intake.

## Database change and rollback

Nullable `rejection_reason` on the existing decision journal, with a closed-category check
requiring a reason on new discard rows and none on apply rows. `NOT VALID` deliberately
preserves historical immutable null-reason decisions, while PostgreSQL enforces it for new
writes. No backfill, row rewrite, data deletion or new privilege scope; the existing app
role gains insert access to that single column under existing RLS/owner/fence guards.

Metadata-only operation; short ACCESS EXCLUSIVE lock with 5-second lock timeout and
60-second statement timeout. At 100k households it does not scan or rewrite the journal.
Rollback: disable the new discard surface first and retain recorded reasons. Old clients
without a reason fail closed after migration; do not remove evidence to restore compatibility.
Only the existing local synthetic database was migrated for tests; no hosted migration.

## Verification

Results recorded after local checks. Database assertions use the restricted app role;
administrator connections create synthetic fixtures only. Tests must preserve historical
accounting, reason immutability and audit counts under repeat requests, plus tenant and
journal-retirement protections. Local UI tests are not hosted browser E2E or launch approval.

Passed: full seven-workspace build and typechecks; focused lint; 54 review UI tests,
57 result/period database tests, 17 restricted HTTP integration tests, and 62 tenancy,
principal/audit, API-role and journal-retirement tests. Keyboard open focuses the reason
selector; cancel returns focus to the original trigger. Initial audit test incorrectly
counted fixture setup events as rejection events; it now measures the audit delta and
proves exactly one added event across repeat requests.

Local database target: existing PostgreSQL 16 container `pellum-audit-20261010`,
127.0.0.1:55432/pellum_audit. Fixture-only values; no hosted database, real documents or
provider calls. Container restored to its initial stopped state after checks.
