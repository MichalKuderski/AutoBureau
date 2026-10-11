-- ADR-020: permissive policies combine with OR. The household policy must not
-- admit app_billing_test alongside its digest-only route lookup policy.
-- Forward fix: the hosted-checkout migration is already applied on staging.
-- Metadata only: no row rewrite, grant, runtime identity or function change.
-- At 100k households the same two policy catalog rows are inspected; the table
-- lock is bounded to 5s and the statement to 60s. Rollback disables billing;
-- retain both journals and never restore the overly broad policy.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
-- Hold the same lock required by ALTER POLICY while checking the old definition.
LOCK TABLE public.stripe_test_routes IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='stripe_test_routes'
     AND c.relrowsecurity AND c.relforcerowsecurity
 ) OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='stripe_test_routes') <> 2
 OR NOT EXISTS (
   SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stripe_test_routes'
     AND policyname='stripe_test_scope' AND permissive='PERMISSIVE' AND cmd='ALL'
     AND roles=ARRAY['public']::name[]
     AND qual='(household_id = app.current_household())'
     AND with_check='(household_id = app.current_household())'
 ) OR NOT EXISTS (
   SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stripe_test_routes'
     AND policyname='stripe_route_lookup' AND permissive='PERMISSIVE' AND cmd='SELECT'
     AND roles=ARRAY['app_billing_test']::name[]
     AND qual='(route_digest = current_setting(''request.stripe_route''::text, true))'
     AND with_check IS NULL
 ) THEN
   RAISE EXCEPTION 'Stripe route policy preflight refused: unexpected posture';
 END IF;
END $$;

-- Owner binding publication and privacy inventory remain household-scoped.
-- The billing runtime can now satisfy only stripe_route_lookup, even when it
-- sets request.household_id itself. Existing column grants remain unchanged.
ALTER POLICY stripe_test_scope ON public.stripe_test_routes
 TO app_user,app_retention_worker,app_deletion_verifier;
COMMIT;
