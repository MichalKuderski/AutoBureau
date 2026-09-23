# Staging job reconciliation foundation — September 20, 2026

`reconcileJobDeliveries` previously counted only existing delivery rows. A routed
event missing one required consumer could therefore appear healthy. It now derives
expected fan-out from `JOB_ROUTES` and observes delivery/routing counts in one SQL
statement snapshot, within the existing short household-scoped transaction.

New counters: `unrouted`, `unknown_events`, `missing_deliveries`,
`unexpected_deliveries`, `expired_leases`, `orphaned_events`. Existing completion,
pending/sent/exhausted and seven-day-overdue counts remain. No payload or identifier
is returned; no repairs, requeue, DLQ replay, provider calls, migrations, permissions,
scheduled invocations or runtime activation are added. This is a diagnostic seam;
its new counters are not yet connected to a deployed alert/reconciliation service.

The disposable PostgreSQL test exposed intentionally retained outbox rows after
household deletion. Those rows are reported as `orphaned_events`, excluded from
active fan-out expectations and remain excluded from dispatcher discovery. They
still require the separate approved retention/deletion-receipt workflow. Zero queue
rows is not proof of full privacy deletion.

Five new real restricted-role integration cases cover missing fan-out/read-only
repeat, unknown events and invalid consumers, expired leases and completed effects,
cross-environment corruption/tenant scope, and retained outbox after deletion.
Fixture corruption is performed only by the disposable local administrator; all
reconciliation observations use the restricted worker role. No schema constraint
or runtime permission was relaxed to create a test.

Verification: 16/16 job cases; 1,370 full units; 452 full integrations (75 DB + 377
web); full build/lint/typecheck; seven architecture guards. Lint retains 13 existing
script console warnings and zero errors. PostgreSQL 18.3 + pgvector on loopback is
local evidence, not CI PostgreSQL 16 or hosted SQS/stable-staging proof. All five new
cases fail against the historical implementation; the reviewed source was restored
byte-for-byte and all 16 job cases passed again. The original 386-file user inventory
is unchanged. No dependency/lockfile change.

Rollback is the local code revert; there is no migrated schema or provider state.
Before enabling any invocation, establish scheduling, cost/lease bounds, effective
runtime authority, alert delivery and synthetic hosted lifecycle under ADR-017.
Scanner, redaction, actual retention cleanup and end-to-end document processing
remain incomplete. Intake, real sensitive documents and model processing remain off.
