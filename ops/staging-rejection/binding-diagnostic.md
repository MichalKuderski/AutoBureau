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
- Successful authentication and an explicitly read-only PostgreSQL transaction.
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
boundary, including native failures and disconnect errors. IPC accepts only ordered
integers; exceptions and received messages are never printed. The parent emits only
seven fixed `PASS`/`FAIL` lines. A failure marks unreached checks `FAIL`; it does not
claim each independently failed. `TRANSACTION_COMPLETED` must pass for overall success.
No connection strings, raw errors, query rows, secret hashes or artifacts are emitted.
GitHub's platform secret masking remains an additional layer for the step environment.

This is not isolation against compromised reviewed dependencies or a malicious
runner; the driver must consume the existing credential to authenticate. It does not
retrieve the credential for the operator or agent, or expand persistent access.

## Local verification

`node scripts/staging-binding.test.mjs` exercises routing, authority, workflow
boundaries, hostile child output/IPC, process failure and the supervisor timeout.
`DIAGNOSTIC_TEST_DATABASE_URL` must name a **fresh disposable loopback** PostgreSQL
database `postgres`, user `postgres`. Run
`node scripts/staging-binding.integration.test.mjs` against that fixture only.
The integration suite constructs the 48-migration baseline locally and deliberately
attempts writes to prove server enforcement, with a writable negative control. It
also covers statement/lock/transaction timeouts, ledger/RLS drift, and real driver
authentication-error suppression. Destroy the disposable service after testing.
CI uses a separate local PostgreSQL 16 service and no hosted secret/environment.
The hosted project is PostgreSQL 17; CI is not hosted binding evidence.

References: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[PostgreSQL transaction modes](https://www.postgresql.org/docs/current/sql-set-transaction.html).
