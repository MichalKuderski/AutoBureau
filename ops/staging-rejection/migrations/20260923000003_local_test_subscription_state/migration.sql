-- LOCAL TEST only. No entitlement grants or hosted invocation. New empty ledger;
-- existing notice CHECK swap takes a brief metadata lock and validation scans
-- notices. A binding index build is blocking: bounded local now; use a separately
-- reviewed concurrent rollout at hosted scale. At 100k households, budget ~100MB
-- for state/indexes before audit growth; measure, do not use as capacity proof.
-- Rollback: disable invocation, retain notice/state/audit evidence. Rolling code
-- back cannot process terminal reconciled notices. No destructive down migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE INDEX stripe_test_notices_binding_idx ON stripe_test_notices(binding_id,household_id);
ALTER TABLE stripe_test_notices DROP CONSTRAINT stripe_test_notices_state_check;
ALTER TABLE stripe_test_notices ADD CONSTRAINT stripe_test_notices_state_check CHECK(state IN ('pending','leased','refused','reconciled')) NOT VALID;
ALTER TABLE stripe_test_notices VALIDATE CONSTRAINT stripe_test_notices_state_check;
CREATE TABLE stripe_test_states (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 binding_id uuid NOT NULL UNIQUE,
 account_id text NOT NULL,
 source_notice_id uuid NOT NULL REFERENCES stripe_test_notices(id) ON DELETE RESTRICT,
 source_lease_token uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
 state text NOT NULL CHECK(state IN ('inactive','active','canceling','grace','past_due','canceled','blocked')),
 plan text NOT NULL CHECK(plan IN ('monthly','annual')),
 paid_through bigint CHECK(paid_through BETWEEN 0 AND 8640000000000),
 premium_until bigint CHECK(premium_until BETWEEN 0 AND 8640000000000),
 reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(binding_id,household_id,account_id) REFERENCES stripe_test_bindings(id,household_id,account_id) ON DELETE RESTRICT,
 CHECK ((state IN ('active','canceling','grace') AND premium_until IS NOT NULL AND paid_through IS NOT NULL
   AND premium_until<=paid_through+CASE WHEN state='grace' THEN 604800 ELSE 0 END)
   OR (state NOT IN ('active','canceling','grace') AND premium_until IS NULL))
);
CREATE INDEX stripe_test_states_household_idx ON stripe_test_states(household_id);
ALTER TABLE stripe_test_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_test_states FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_test_state_scope ON stripe_test_states FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household());
REVOKE ALL ON stripe_test_states FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON stripe_test_states FROM %I',r); END IF;
END LOOP; END $$;
GRANT SELECT ON stripe_test_states TO app_job_worker;
GRANT SELECT(id,household_id,state,plan,paid_through,premium_until,reconciled_at,revision) ON stripe_test_states TO app_user;
GRANT SELECT(id,household_id) ON stripe_test_states TO app_retention_worker,app_deletion_verifier;
GRANT INSERT(household_id,binding_id,account_id,source_notice_id,source_lease_token,state,plan,paid_through,premium_until),
 UPDATE(source_notice_id,source_lease_token,revision,state,plan,paid_through,premium_until) ON stripe_test_states TO app_job_worker;
CREATE FUNCTION app.guard_stripe_test_state() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE n public.stripe_test_notices%ROWTYPE;
BEGIN
 IF current_user<>'app_job_worker' THEN RETURN NEW; END IF;
 -- Same exact namespace as the claim path. Collision is refusal, never authority.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||NEW.binding_id::text,0)) THEN
  RAISE EXCEPTION 'Test billing busy' USING ERRCODE='55000';
 END IF;
 SELECT * INTO n FROM public.stripe_test_notices WHERE id=NEW.source_notice_id AND household_id=NEW.household_id FOR UPDATE;
 IF n.id IS NULL OR n.binding_id<>NEW.binding_id OR n.account_id<>NEW.account_id OR n.state<>'leased'
  OR n.lease_token<>NEW.source_lease_token OR n.lease_until<=clock_timestamp()
  OR (TG_OP='UPDATE' AND NEW.source_notice_id=OLD.source_notice_id)
  OR (NEW.premium_until IS NOT NULL AND NEW.premium_until<=extract(epoch FROM clock_timestamp())) THEN
  RAISE EXCEPTION 'Test billing state refused' USING ERRCODE='55000';
 END IF;
 NEW.revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
 NEW.reconciled_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_stripe_test_state() FROM PUBLIC;
CREATE TRIGGER stripe_test_state_guard BEFORE INSERT OR UPDATE ON stripe_test_states FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_test_state();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON stripe_test_states FOR EACH ROW EXECUTE FUNCTION app.guard_household_write();
CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON stripe_test_states FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
CREATE OR REPLACE FUNCTION app.guard_stripe_test_notice() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_job_worker' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.provider_created>extract(epoch FROM clock_timestamp())+300 THEN RAISE EXCEPTION 'Test billing notice refused' USING ERRCODE='55000'; END IF;
  NEW.created_at:=clock_timestamp(); NEW.state:='pending'; NEW.attempts:=0; NEW.lease_token:=NULL; NEW.lease_until:=NULL;
 ELSIF NEW.state='leased' AND OLD.attempts<3 AND NEW.attempts=OLD.attempts+1 AND NEW.lease_token IS NOT NULL
  AND (OLD.state='pending' OR (OLD.state='leased' AND OLD.lease_until<=clock_timestamp())) THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||NEW.binding_id::text,0)) OR EXISTS(
   SELECT 1 FROM public.stripe_test_notices WHERE binding_id=NEW.binding_id AND household_id=NEW.household_id
    AND id<>NEW.id AND state='leased' AND lease_until>clock_timestamp()) THEN
   RAISE EXCEPTION 'Test billing busy' USING ERRCODE='55000';
  END IF;
  NEW.lease_until:=clock_timestamp()+interval '60 seconds';
 ELSIF NEW.state IN ('refused','reconciled') AND OLD.state='leased' AND OLD.lease_until>clock_timestamp()
  AND NEW.attempts=OLD.attempts AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL THEN
  IF NEW.state='reconciled' AND NOT EXISTS(SELECT 1 FROM public.stripe_test_states WHERE binding_id=NEW.binding_id
   AND household_id=NEW.household_id AND source_notice_id=OLD.id AND source_lease_token=OLD.lease_token) THEN
   RAISE EXCEPTION 'Test billing completion refused' USING ERRCODE='55000';
  END IF;
 ELSE RAISE EXCEPTION 'Test billing transition refused' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices','stripe-states','export-artifacts')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
