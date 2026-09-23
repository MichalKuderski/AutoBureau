# Staging upgrade compatibility — local, September 23, 2026

**Scope: local evidence only.** No hosted database was read or changed. The last
recorded stable-staging readback (September 13, 22:28 UTC) showed PostgreSQL 17 with
13 completed migrations, 167 households / 167 entitlements, zero documents, zero job
deliveries/inbox rows, 21 forced-RLS tables and 27 policies. This candidate carries
34 migrations. A hosted upgrade therefore applies 21 migrations in one run.

## What was exercised

For each run a brand-new cluster (roles are cluster-global) received exactly the 13
staging migrations through `prisma migrate deploy`, plus emulated Supabase `anon`,
`authenticated` and `service_role` roles. Synthetic staging-shaped rows were then
written at that schema: 167 owners/households/entitlements, profiles with onboarding
state, self members plus 20 households holding more active humans than Free now allows,
children, pets, archived members, items, obligations with outcomes, notifications,
preferences, published and unpublished outbox history, audit history and anonymous
rate-limit rows. Every pre-existing table was fingerprinted by its ORIGINAL columns
(count + ordered row digest) before and after the upgrade.

| Run | Server | Upgrade | Pre-existing data | Suites on the upgraded DB |
| --- | --- | --- | --- | --- |
| Clean | PostgreSQL 18.3 | 21 migrations applied (1.9 s) | 24/24 tables identical | 351 DB + 481 HTTP pass |
| Clean | PostgreSQL 16.15 (CI image) | 21 applied (1.8 s) | 24/24 identical | 351 DB + 481 HTTP pass |
| One nonzero legacy usage counter | PostgreSQL 18.3 | **refused mid-chain** | unchanged | n/a |

The upgraded PostgreSQL 18 schema was compared with a fresh 34-migration install:
tables, owners, RLS flags, policies, table/column/sequence grants, triggers and every
function body are identical. The only differences are environmental (the emulated
Supabase roles inherit the default PUBLIC execute on the two GUC-reading context
functions, and the test harness's `app_user` login state). Over-cap households are
preserved; no member or record is deleted by the upgrade.

PostgreSQL 17 was **not** exercised: no PG17 binary or image is present locally and
downloading one requires operator permission. PG16 and PG18 bracket it; exact-major
evidence must come from the hosted staging run itself.

## Defect found: opaque mid-chain refusal

Migration `20260925000000_processing_custody` deliberately refuses any documents or a
nonzero legacy `docs_used_this_period`. When it fires, Prisma reports only "current
transaction is aborted", the chain stops after 27 migrations with a failed row that
blocks further deploys until manually resolved, and the database sits at a schema no
build targets. The Sept 13 readback does not record legacy usage, so this could not be
ruled out for staging from existing evidence.

Correction: `packages/db/prisma/preflight/upgrade-preflight.sql` is one read-only
statement that reports every registered data refusal and role collision by name before
anything is applied; `scripts/migration-preflight.mjs` runs it in a READ ONLY transaction
and blocks on `ok !== true` or on any connection error (without printing connection
details). Both staging migration steps now run it after the target check and before
`migrate deploy`. A control test requires every future data-refusing or role-creating
migration to be registered, with negative controls. Verified: clean staging shape →
`ok: true`; nonzero usage → `ok: false` naming the migration and count; a bad
credential → refusal. The production migration job was **not** changed (production
configuration requires separate authorization); adding the same step there is
recommended before any production migration.

## Hosted preconditions this implies

1. Run the preflight read-only against stable staging first; it must return `ok: true`.
2. Confirm PostgreSQL 17 applies the same 21 migrations within the 5 s lock / 60 s
   statement bounds, with the exact-SHA readback matching the fresh-install posture.
3. Only then run the staging migration, with before/after fingerprints as in
   `scripts/staging-jobs-migration.mjs`.

Evidence manifests and logs for these runs are in the release receipt for this candidate.
