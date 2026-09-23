-- ADR-020 review follow-up: pg_trigger_depth is not an origin proof.
-- Function-only replacement; no table rewrite/data removal. Bounded metadata lock.
-- Rollback disables billing; do not restore forgeable audit acceptance.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
GRANT SELECT(meta) ON audit_log TO app_billing_test;
CREATE OR REPLACE FUNCTION app.guard_billing_publication() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE expected bigint; actual bigint; expected_action text;
BEGIN
 IF current_user='app_billing_test' THEN
  IF TG_TABLE_NAME='audit_log' THEN
   IF pg_trigger_depth()<2 OR NEW.actor_type<>'system' OR NEW.actor_id IS NOT NULL OR NEW.meta<>'{}'::jsonb
    OR NEW.target_type NOT IN ('stripe_test_notices','stripe_test_intents','stripe_test_states') OR NEW.action NOT IN (NEW.target_type||'.insert',NEW.target_type||'.update') THEN
    RAISE EXCEPTION 'TEST audit refused' USING ERRCODE='42501'; END IF;
   PERFORM app.assert_household_open(NEW.household_id);
   -- Nested triggers can be owned by a caller in pg_temp. Depth alone is NOT
   -- origin proof. Bind exactly one append to each immutable transition ordinal.
   IF NEW.target_type='stripe_test_states' THEN
    SELECT revision,CASE WHEN revision=1 THEN 'insert' ELSE 'update' END INTO expected,expected_action
      FROM public.stripe_test_states WHERE id=NEW.target_id AND household_id=NEW.household_id;
   ELSIF NEW.target_type='stripe_test_notices' THEN
    SELECT 1+attempts+CASE WHEN state IN ('refused','reconciled') THEN 1 ELSE 0 END,
      CASE WHEN attempts=0 THEN 'insert' ELSE 'update' END INTO expected,expected_action
      FROM public.stripe_test_notices WHERE id=NEW.target_id AND household_id=NEW.household_id;
   ELSE
    SELECT 1+attempts+CASE WHEN state IN ('refused','reconciled') THEN 1 ELSE 0 END,
      CASE WHEN attempts=0 THEN 'insert' ELSE 'update' END INTO expected,expected_action
      FROM public.stripe_test_intents WHERE id=NEW.target_id AND household_id=NEW.household_id;
   END IF;
   SELECT count(*) INTO actual FROM public.audit_log WHERE household_id=NEW.household_id AND target_type=NEW.target_type AND target_id=NEW.target_id AND meta ? 'billing_transition';
   IF expected IS NULL OR actual<>expected-1 OR NEW.action<>NEW.target_type||'.'||expected_action THEN
    RAISE EXCEPTION 'TEST audit cardinality refused' USING ERRCODE='42501'; END IF;
   NEW.meta:=jsonb_build_object('billing_transition',expected);
  ELSE
   IF NEW.event_type<>'billing.test_state_reconciled' OR NEW.aggregate_type<>'stripe-test-state' OR NEW.transport_scope IS NOT NULL OR NEW.traceparent IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.stripe_test_states s WHERE s.id=NEW.aggregate_id AND s.household_id=NEW.household_id AND NEW.payload=jsonb_build_object('revision',s.revision)) THEN
    RAISE EXCEPTION 'TEST outbox refused' USING ERRCODE='42501'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='audit_log' THEN
  IF current_user IN ('app_user','app_job_worker','app_document_worker','app_retention_worker','app_deletion_verifier','app_dispatcher') AND
   (NEW.target_type IN ('stripe_test_notices','stripe_test_intents','stripe_test_states') OR NEW.action ~ '^stripe_test_(notices|intents|states)\.' OR NEW.meta ? 'billing_transition') THEN
   RAISE EXCEPTION 'TEST audit authority refused' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='outbox_events' THEN
  IF NEW.event_type='billing.test_state_reconciled' AND current_user IN ('app_user','app_job_worker','app_document_worker','app_retention_worker','app_deletion_verifier','app_dispatcher') THEN
  RAISE EXCEPTION 'TEST outbox authority refused' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
