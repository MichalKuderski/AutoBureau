# Notification persistence rollout — staging only

This is an additive schema foundation for PRD F13 and architecture 02 §8 / 08. It does not establish notification delivery readiness.

## Scope and deployment order

Target Supabase project: `kdqnfruwgocfqwpbpuxo`. Production is excluded.

1. Publish the tested schema foundation on `codex/launch-foundations` and wait for CI and Preview acceptance.
2. Read back the staging migration registry, legacy policy/ownership fingerprints, role flags, household/entitlement totals and controlled confirmation identity.
3. Temporarily allow exactly `codex/launch-foundations` in the GitHub staging environment; preserve the existing `main` rule.
4. Dispatch Deploy with `environment=staging`, `stage=migrate`. The new guard checks the configured project and direct/session endpoint before Prisma connects. The job applies migrations and skips Vercel install/configuration, build, deployment and application test writes. Production job definitions are unchanged.
5. Read back the new registry/security state and compare all legacy fingerprints and counts. Remove the temporary launch-branch allowance.
6. Only then publish application code that queries the new tables. Final stable-staging candidate deployment remains a separate required gate.

No hosted migration has run when this plan is authored. Preview continues to use existing routes while this foundation is introduced.

## Migrations and expected posture

- `20260912000000_notification_ledger`: three empty tables, two enums, four forced-RLS policies. Includes notice deduplication, per-channel uniqueness, security-preference protection and bounded field sizes.
- `20260912000001_notification_recipient_index`: indexes recipient lookup/account-deletion cascading. The first migration was already applied to the disposable local database, so this correction is a forward migration rather than rewriting its SQL.
- Expected staging registry: 9 completed migrations, 0 rolled back (the original 7 plus these 2).
- Expected RLS: 18 forced-RLS tables, 24 policies (original 15/20 plus 3/4), no `ensure_rls` trigger.
- No existing policy, role flags or table owner changes. New objects belong to the migration owner, never `app_user`.
- Request role: own notices/deliveries read only; only notice `read_at` is updatable; own preference changes allowed. Notice composition and delivery status changes require the trusted dispatcher.
- No user, profile, household, entitlement or controlled-auth row is changed by this DDL. Quiet-hours configuration will use the profile JSON namespace specified by architecture 02, with the same principal lock as onboarding.

## Lock, size and rollback

The new tables/indexes start empty. Foreign-key creation briefly locks existing users/households; a 5-second lock timeout prevents waiting indefinitely, and each migration is transactional. Index creation locks only the new notification table. At 100k households and an assumed 30 retained notices each, plan for roughly 3M notifications (several GB including text/indexes), up to three deliveries per notice and bounded preference rows. These are planning estimates; retention enforcement and worker load evidence remain release requirements.

Rollback application code first and leave the additive objects in place. Once notices exist, preserve/export them before any later approved table drop. The recipient index can remain on an application rollback. No rollback or cleanup of the controlled identity is part of this operation.

## Evidence

Local PostgreSQL 18: both migrations apply, Prisma schema diff is empty, database integration passes 54 checks, web integration passes 353 checks, and repository units pass 1,004 checks. Build/lint/typecheck pass. The migration target guard has eight acceptance/refusal/redaction cases. A final recipient-index isolation rerun is recorded with the rollout evidence. GitHub CI uses PostgreSQL 16 and must pass before hosted mutation.

The endpoint guard follows [Supabase Prisma connection guidance](https://supabase.com/docs/guides/database/prisma): direct or session connections on port 5432, excluding transaction-pooler port 6543. Credentials are never printed.
