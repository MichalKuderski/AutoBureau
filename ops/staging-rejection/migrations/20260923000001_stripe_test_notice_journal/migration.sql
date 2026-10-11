-- LOCAL TEST foundation, not payment activation. Two empty tables and indexes;
-- no existing data rewrite. Inventory CHECK validation scans manifests (metadata
-- lock for swap, weaker validation lock). At 100k households / 100 events each,
-- estimate 5-10GB including indexes/audit; measure before hosted retention approval.
-- Rollback: disable invocation; preserve deduplication/binding history until the
-- provider replay/hold horizon is established. Never truncate to fix a replay.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE stripe_test_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL UNIQUE REFERENCES households(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]{1,240}$'),
 customer_id text NOT NULL CHECK(customer_id ~ '^cus_[A-Za-z0-9]{1,240}$'),
 subscription_id text NOT NULL CHECK(subscription_id ~ '^sub_[A-Za-z0-9]{1,240}$'),
 livemode boolean NOT NULL DEFAULT false CHECK(livemode=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,customer_id), UNIQUE(account_id,subscription_id),
 UNIQUE(id,household_id,account_id)
);
CREATE TABLE stripe_test_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 binding_id uuid NOT NULL,
 account_id text NOT NULL,
 event_id text NOT NULL CHECK(event_id ~ '^evt_[A-Za-z0-9]{1,240}$'),
 event_type text NOT NULL CHECK(event_type IN ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed')),
 object_id text NOT NULL CHECK(object_id ~ '^(sub|in)_[A-Za-z0-9]{1,240}$'),
 provider_created bigint NOT NULL CHECK(provider_created BETWEEN 0 AND 8640000000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','refused')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token uuid,
 lease_until timestamptz,
 UNIQUE(account_id,event_id),
 FOREIGN KEY(binding_id,household_id,account_id) REFERENCES stripe_test_bindings(id,household_id,account_id) ON DELETE RESTRICT,
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX stripe_test_notices_household_idx ON stripe_test_notices(household_id);
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['stripe_test_bindings','stripe_test_notices'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY stripe_test_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF;
  END LOOP;
  EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_household_write()',t);
  EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
  EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
 END LOOP;
END $$;
GRANT SELECT ON stripe_test_bindings,stripe_test_notices TO app_user,app_job_worker;
GRANT INSERT(household_id,owner_id,account_id,customer_id,subscription_id) ON stripe_test_bindings TO app_user;
GRANT INSERT(household_id,binding_id,account_id,event_id,event_type,object_id,provider_created),UPDATE(state,attempts,lease_token,lease_until) ON stripe_test_notices TO app_job_worker;
CREATE FUNCTION app.guard_stripe_test_binding() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user='app_user' AND (NEW.owner_id IS DISTINCT FROM app.current_user_id() OR NOT EXISTS(SELECT 1 FROM public.household_users WHERE household_id=NEW.household_id AND user_id=app.current_user_id() AND role='owner')) THEN
  RAISE EXCEPTION 'Test billing binding refused' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_stripe_test_binding() FROM PUBLIC;
CREATE TRIGGER stripe_test_binding_guard BEFORE INSERT ON stripe_test_bindings FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_test_binding();
CREATE FUNCTION app.guard_stripe_test_notice() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_job_worker' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.provider_created>extract(epoch FROM clock_timestamp())+300 THEN RAISE EXCEPTION 'Test billing notice refused' USING ERRCODE='55000'; END IF;
  NEW.created_at:=clock_timestamp(); NEW.state:='pending'; NEW.attempts:=0; NEW.lease_token:=NULL; NEW.lease_until:=NULL;
 ELSIF NEW.state='leased' AND OLD.attempts<3 AND NEW.attempts=OLD.attempts+1 AND NEW.lease_token IS NOT NULL
  AND (OLD.state='pending' OR (OLD.state='leased' AND OLD.lease_until<=clock_timestamp())) THEN
  NEW.lease_until:=clock_timestamp()+interval '60 seconds';
 ELSIF NOT (NEW.state='refused' AND OLD.state='leased' AND OLD.lease_until>clock_timestamp() AND NEW.attempts=OLD.attempts AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL) THEN
  RAISE EXCEPTION 'Test billing transition refused' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_stripe_test_notice() FROM PUBLIC;
CREATE TRIGGER stripe_test_notice_guard BEFORE INSERT OR UPDATE ON stripe_test_notices FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_test_notice();
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
