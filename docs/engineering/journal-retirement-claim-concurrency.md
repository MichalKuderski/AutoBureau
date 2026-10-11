# Journal-retirement claim concurrency

Two initial claims for the same sealed household deletion must return one
`claimed` and one `busy`, sharing a run ID. Previously both transactions could
read absence before the database trigger took its advisory lock during INSERT.
The second insert then raised `journal_retirement_runs_deletion_id_key`
(PostgreSQL 23505 / Prisma P2010). The unique constraint prevented duplicate
leases, but the losing caller received an error instead of `busy`.

The claim now takes the existing transaction advisory lock before its first
read, using the database guard's `retirement:<canonical household UUID>` key.
The trigger lock and unique constraint remain in place. Scope, role grants,
sealed-manifest checks, audit, the 60-second lease, three-attempt ceiling and
no-purge constraints are unchanged. There is no migration or pool/timeout change.
The same lock serializes observations before expired-lease takeover. Other
households use their own lock keys.

The real PostgreSQL integration regression holds the existing lock with a fixture
administrator, starts two restricted retention-worker claims, verifies that both
are waiting on that exact lock, then releases it. It does not mock query results
or run claims as administrator. Old code fails this deterministic test; the fix
returns `claimed`/`busy` and preserves one row at attempt 1. Additional controls
cover an unaffected other household, serial claims leaving the live lease
unchanged, and simultaneous expired takeover advancing exactly once with a new
token. Existing tests retain the live/foreign-token refusal, exhaustion, holds,
immutable evidence and restricted-role checks.

The defect predates the combined staging candidate: the claim, test and migration
are unchanged between preproduction `13766613` and PR10 `92cabd6a`. The repair is
a separate follow-up based on PR10; it does not alter PR10's approved deployment.
This planning-library defect is separate from dashboard P2028 and does not prove
that retirement is wired to a production worker. No purge authority is enabled.
