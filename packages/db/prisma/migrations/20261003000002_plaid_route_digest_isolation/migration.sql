-- ADR-022: permissive policies combine with OR. Household scope must not
-- admit SELECT by app_plaid_sandbox alongside its digest-only route lookup.
-- Preserve the runtime's existing INSERT authority separately for index_plaid_item;
-- its invoker guard still verifies the exact Item, derived digest and privacy fence.
-- Forward fix only: the original lifecycle migration is already applied on staging.
-- No row rewrite, grant, runtime identity, trigger or function change. At 100k
-- households this alters one policy catalog row and adds one policy; no data scan.
-- Lock acquisition is bounded to 5s and statements to 60s. Rollback disables Plaid
-- callers and retains custody/journals; never restore the overly broad policy.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
-- Keep concurrent policy DDL outside the checked old posture and the fix.
LOCK TABLE public.plaid_local_item_routes IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='plaid_local_item_routes'
     AND c.relrowsecurity AND c.relforcerowsecurity
 ) OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='plaid_local_item_routes') <> 2
 OR NOT EXISTS (
   SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plaid_local_item_routes'
     AND policyname='household_scope' AND permissive='PERMISSIVE' AND cmd='ALL'
     AND roles=ARRAY['public']::name[]
     AND qual='(household_id = app.current_household())'
     AND with_check='(household_id = app.current_household())'
 ) OR NOT EXISTS (
   SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plaid_local_item_routes'
     AND policyname='plaid_route_lookup' AND permissive='PERMISSIVE' AND cmd='SELECT'
     AND roles=ARRAY['app_plaid_sandbox']::name[]
     AND qual='(route_digest = current_setting(''request.plaid_route''::text, true))'
     AND with_check IS NULL
 ) THEN
   RAISE EXCEPTION 'Plaid route policy preflight refused: unexpected posture';
 END IF;
END $$;

-- Privacy readers retain their existing household-scoped ID inventory. They gain
-- no digest, mutation or token authority; existing column grants stay unchanged.
ALTER POLICY household_scope ON public.plaid_local_item_routes
 TO app_retention_worker,app_deletion_verifier;
-- An INSERT-only policy cannot OR-widen the runtime's digest-keyed SELECT policy.
-- The Item's invoker indexing trigger inserts without RETURNING; its existing
-- guard and audit triggers continue to run under app_plaid_sandbox authority.
CREATE POLICY plaid_route_insert ON public.plaid_local_item_routes
 FOR INSERT TO app_plaid_sandbox WITH CHECK(household_id=app.current_household());
COMMIT;
