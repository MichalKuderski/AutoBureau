-- Restore the RLS posture 20260728000001_rls describes, and remove the out-of-band
-- event trigger that silently overrode it in production.
--
-- WHAT WENT WRONG
-- ---------------
-- The production database carried an event trigger, `ensure_rls`, calling
-- `public.rls_auto_enable()` on `ddl_command_end`. It ran
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every table created in `public`.
-- It is created by no migration, appears nowhere in this repository, does not exist in
-- staging, and is owned by `postgres` — unlike Supabase's own six event triggers, which
-- are owned by `supabase_admin` and whose functions live outside `public`. It was
-- introduced out of band.
--
-- The effect was invisible on the tenant tables, because 20260728000001_rls enables RLS,
-- forces it, and attaches policies to those anyway. It landed on the three tables that
-- migration deliberately leaves alone. From its own comment:
--
--     users / user_profiles are not household-scoped; access is enforced in the
--     application's session layer (doc 06 §2). Left without RLS deliberately —
--     adding a policy keyed on a household GUC would be wrong, not safer.
--
-- RLS enabled with zero policies is deny-all for every role that is neither the table
-- owner nor BYPASSRLS — which is exactly `app_user`. The grants were all present; the
-- rows were not. Sign-up writes both tables through the identity mirror and every
-- authenticated request reads them, so production would have refused to register a
-- single user.
--
-- It would not have been caught by the deploy. The smoke suite never signs up, and
-- `POST /v1/auth/sign-in` is answered by the rate limiter — whose table does carry a
-- policy — so the score reads 17/17 either way. Staging could not have caught it either:
-- the trigger was never there, which is the deeper problem this migration closes. A
-- posture that differs between the two makes staging's acceptance run evidence about
-- staging only.
--
-- WHY THE INTENT BELONGS HERE RATHER THAN IN A ONE-OFF STATEMENT
-- -------------------------------------------------------------
-- Applying this by hand would fix one database and leave the intent uncodified. As a
-- migration it is a no-op on staging, corrective on production, reviewable, and survives
-- any future recreation of these tables.

-- 1. Remove the trigger before touching the tables, so nothing re-enables RLS behind us.
--    IF EXISTS throughout: staging never had either object, and this must be a clean
--    no-op there. The trigger depends on the function, so it goes first.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
DROP FUNCTION IF EXISTS public.rls_auto_enable();

-- 2. Restore the documented posture. ALTER TABLE ... DISABLE ROW LEVEL SECURITY is
--    idempotent, so this is a no-op wherever the posture is already correct.
--
--    This deliberately touches ONLY these three. Every household-scoped table keeps the
--    RLS, FORCE ROW LEVEL SECURITY and policies that 20260728000001_rls gave it, and
--    `vendors` keeps its global read policy. Nothing below weakens tenant isolation.
ALTER TABLE IF EXISTS public.users              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_profiles      DISABLE ROW LEVEL SECURITY;

-- Prisma's own bookkeeping table. Harmless either way — migrations run as the owner and
-- FORCE is off — but it is part of the staging posture, and leaving it divergent would
-- leave a difference nobody could later explain.
ALTER TABLE IF EXISTS public._prisma_migrations DISABLE ROW LEVEL SECURITY;
