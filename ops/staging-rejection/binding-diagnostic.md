# Saved staging binding diagnostic

This manual workflow checks the existing `STAGING_MIGRATION_DATABASE_URL` binding
without revealing it or applying migrations. GitHub's empty secret replacement
field is not evidence of its stored value. The Supabase dashboard and the original
configuration source establish intended configuration, not GitHub's current binding.

Publication and CI do not authorize hosted execution. Before a future run, separately
review and approve the exact **main** SHA containing this diagnostic. Only
`MichalKuderski` may dispatch or rerun it, on main, with
`diagnostic:<exact-main-SHA>:kdqnfruwgocfqwpbpuxo`. The checkout is that event SHA.
The existing staging environment is used; it has no independent required reviewer.
The input is an owner attestation, not an independent GitHub approval gate.
Do not dispatch it as part of this PR, approve a preview, or alter the migration hold.

## What it checks

- Exact project direct host with `postgres`, or the previously identified
  `aws-0-us-west-2.pooler.supabase.com` host with `postgres.<project>`, port 5432,
  database `postgres`. Other hosts, transaction-pool port 6543, unknown options,
  duplicate options and permissive TLS settings fail before connection.
- Certificate-verified TLS, one connection, five-second connect/pool limits.
- An explicit connection attempt, then a separately confirmed read-only PostgreSQL transaction.
- Database `postgres`, session/current role `postgres`, login capability.
- All 48 baseline migration names/checksums and successful completion state, with
  no unexpected or rolled-back entry; local migration files must match the manifest.
- Baseline rejection journal posture: no phase columns/constraints yet, forced RLS,
  household policy, enabled guards and restricted application-role privileges.

The role/name/ledger/schema checks corroborate the authenticated routing. They do
not independently establish a globally unique Supabase project identity. This is
posture corroboration, not exhaustive schema tamper detection: trigger function
bodies and every original constraint definition are not compared to a frozen copy.
This is
not a runtime/UI test, backup proof, migration authorization or recovery guarantee.
The fixed baseline intentionally refuses after any migration phase; revise through
review if a different diagnostic becomes necessary. Strict TLS or an unrecognized
valid endpoint may refuse; investigate separately without weakening policy or
replacing the secret just to obtain a pass.

## Write and output boundaries

Every database check runs in one repeatable-read transaction. Its first statement
sets `READ ONLY`; the next setup statements apply local statement (5s), lock (2s)
and idle-transaction (10s) timeouts. The server's read-only setting is checked before
reading identity or catalog metadata. Prisma acquisition is bounded to 5s and the
transaction to 15s; the supervisor kills its driver process after 30s. No retries.
Concurrency is shared with the migration-only workflow to avoid overlapping runs.

There are no migration/deployment commands, household-row queries, arbitrary SQL
inputs, or hosted local-target overrides. PostgreSQL read-only mode prevents
persistent DML/DDL even with a privileged login. It is not a restricted credential:
future malicious code could change transaction mode, and PostgreSQL read-only mode
does not forbid every side effect (for example temporary objects). The fixed reviewed
SQL and code boundary therefore matter; no role/security configuration is changed.

Dependencies and Prisma generation run before the secret-bearing step. That final
step passes only a reconstructed validated URL and `NODE_ENV` to a fixed child, with
no inherited preload/debug flags. Child stdout/stderr are discarded at the OS pipe
boundary, including native failures and disconnect errors. IPC accepts only ordered fixed-length integer events with validated transitions and
closed reason codes; exceptions and received messages are never printed. The parent
emits fixed results for `AUTHORITY`, `ROUTING`, `LOCAL_SETUP`, `CONNECT`,
`READ_ONLY_CONFIRMATION`, `DATABASE_ROLE`, `MIGRATION_CHECKSUMS`, `SCHEMA_POSTURE`,
`TRANSACTION_COMPLETED`, `DISCONNECT` and `PROCESS_COMPLETION`.

Each stage is `PASS`, `FAIL` or `NOT_RUN`. Unreached stages remain `NOT_RUN`.
Completed stages remain passed after a later crash or watchdog failure. An active
stage fails if its worker crashes; a crash between stages fails process completion
without pretending the next stage started. Invalid IPC cannot supply arbitrary log
text. Clean worker exit and all stage passes are required for overall success.
`TRANSACTION_COMPLETED` passes only after Prisma resolves the read-only transaction;
disconnect failure separately prevents overall success.
No connection strings, raw errors, query rows, secret hashes or artifacts are emitted.
GitHub's platform secret masking remains an additional layer for the step environment.

This is not isolation against compromised reviewed dependencies or a malicious
runner; the driver must consume the existing credential to authenticate. It does not
retrieve the credential for the operator or agent, or expand persistent access.

## Fixed failure categories

`LOCAL_SETUP` includes local inventory reads/hashes and generated-client loading and
construction. `CONNECT` calls Prisma `$connect()` explicitly. Native engine startup
may still occur inside `$connect()`; a generic failure there remains `UNKNOWN`, not
an invented authentication diagnosis. Transaction acquisition, setup statements and
server read-only confirmation belong to `READ_ONLY_CONFIRMATION`.

Only own data properties `errorCode`/`code` are considered. Conflicting, inherited,
unknown or accessor properties map to `UNKNOWN`. Messages, causes, URLs, provider
metadata and query rows are never parsed or forwarded. The mapping is pinned to
[Prisma ORM v6's error contract](https://www.prisma.io/docs/orm/v6/reference/error-reference):

| Structured code | Fixed category |
| --- | --- |
| P1000 | AUTH_REJECTED |
| P1001 | UNREACHABLE |
| P1002 | SERVER_TIMEOUT |
| P1003 | DATABASE_MISSING |
| P1008 | OPERATION_TIMEOUT |
| P1010 | ACCESS_DENIED |
| P1011 | TLS_FAILURE |
| P1017 | CONNECTION_CLOSED |
| P2024 | POOL_TIMEOUT |
| P2028 | TRANSACTION_FAILURE |

`UNREACHABLE` does not distinguish DNS from network failure. `SERVER_TIMEOUT` is
not a claim that DNS failed. `TRANSACTION_FAILURE` does not mean authentication
failed or necessarily a timeout. Unsupported/raw-query errors stay `UNKNOWN`.
Locally detected invariant failures have fixed `LOCAL_SETUP_FAILURE`,
`READ_ONLY_FAILURE`, `IDENTITY_MISMATCH`, `LEDGER_MISMATCH` or `SCHEMA_MISMATCH`.
The supervisor uses `WORKER_FAILURE`, `PROTOCOL_FAILURE`, `WATCHDOG_TIMEOUT` or
`REPORTED_FAILURE` for process completion. No unknown string is printed as a category.

The first hosted run (38167856233) reported routing pass and a generic authentication
failure in about one second. That earlier marker combined local startup, connection
and read-only setup. Its output cannot establish a wrong password or another root
cause. The refinement does not authorize another hosted attempt; the prior one-run
approval is consumed.

A local reproduction on 2026-10-11 ran the original packaged CLI/worker against the
synthetic baseline using the same local-only constructor adapter described below.
All seven original results passed in about 150ms. Thus the hosted failure was not
reproduced locally; this does not verify hosted networking, TLS, credentials or
GitHub runner-specific initialization. No hosted root cause has been established.

## Local verification

`node scripts/staging-binding.test.mjs` exercises routing, authority, workflow
boundaries, hostile child output/IPC, partial progress, structured error mapping,
local setup failures, process crashes and the supervisor timeout.
`DIAGNOSTIC_TEST_DATABASE_URL` must name a **fresh disposable loopback** PostgreSQL
database `postgres`, user `postgres`. Run
`node scripts/staging-binding.integration.test.mjs` against that fixture only.
The integration suite constructs the 48-migration baseline locally and deliberately
attempts writes to prove server enforcement, with a writable negative control. It
also covers statement/lock/transaction timeouts and ledger/RLS drift. Packaged tests
copy the actual CLI/worker/scripts and inventory unchanged into a temporary tree.
A test-only dependency adapter substitutes the generated-client constructor URL with
a synthetic loopback URL, while using the real Prisma driver. This exercises the
actual process, module resolution, restricted environment and result path without
adding any hosted override. It is not a test of Supabase routing/TLS connectivity.
The packaged tests cover startup/import/constructor/inventory failures, actual
P1000 authentication and P1011 TLS errors, identity mismatch, transaction completion
and disconnect failure, and suppression of synthetic canary output. Destroy the disposable service after testing.
CI uses a separate local PostgreSQL 16 service and no hosted secret/environment.
The hosted project is PostgreSQL 17; CI is not hosted binding evidence.

References: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[PostgreSQL transaction modes](https://www.postgresql.org/docs/current/sql-set-transaction.html).
