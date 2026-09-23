-- ADR-020 approved amended local TEST authority. Hosted invocation is not authorized.
-- Cutover is atomic with billing disabled. 5s lock / 60s statement bounds; abort on
-- contention. New empty intent table plus metadata/check validation and outbox index
-- scan. Measure actual volume before hosted rollout. Rollback disables invocation,
-- retains all journals and does not restore generic-worker grants or replay work.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Existing journal history requires a separately reviewed compatibility cutover.
-- Never rewrite append-only audits to manufacture an ordinal baseline.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM stripe_test_notices) OR EXISTS(SELECT 1 FROM stripe_test_states) THEN
 RAISE EXCEPTION 'Existing TEST billing journals require reviewed cutover'; END IF; END $$;
CREATE ROLE app_billing_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,app TO app_billing_test;
GRANT EXECUTE ON FUNCTION app.current_household(),app.current_user_id(),app.assert_household_open(uuid) TO app_billing_test;
-- Revoke BOTH table and column privileges; column REVOKE cannot narrow table grants.
REVOKE ALL ON stripe_test_bindings,stripe_test_notices,stripe_test_states FROM app_job_worker;
REVOKE INSERT(household_id,binding_id,account_id,event_id,event_type,object_id,provider_created),UPDATE(state,attempts,lease_token,lease_until) ON stripe_test_notices FROM app_job_worker;
REVOKE INSERT(household_id,binding_id,account_id,source_notice_id,source_lease_token,state,plan,paid_through,premium_until),UPDATE(source_notice_id,source_lease_token,revision,state,plan,paid_through,premium_until) ON stripe_test_states FROM app_job_worker;
ALTER TABLE stripe_test_notices ADD COLUMN expected_revision integer NOT NULL DEFAULT 0 CHECK(expected_revision>=0);
CREATE TABLE stripe_test_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 binding_id uuid NOT NULL,
 account_id text NOT NULL,
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('missed-webhook','scheduled-recheck','operator-reconcile')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','refused','reconciled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token uuid,lease_until timestamptz,
 expected_revision integer NOT NULL DEFAULT 0 CHECK(expected_revision>=0),
 UNIQUE(binding_id,request_key),
 FOREIGN KEY(binding_id,household_id,account_id) REFERENCES stripe_test_bindings(id,household_id,account_id) ON DELETE RESTRICT,
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX stripe_test_intents_scope_idx ON stripe_test_intents(household_id,binding_id);
ALTER TABLE stripe_test_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_test_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_test_intent_scope ON stripe_test_intents FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household());
REVOKE ALL ON stripe_test_intents FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON stripe_test_intents FROM %I',r); END IF;
END LOOP; END $$;
GRANT SELECT(id,household_id) ON stripe_test_intents TO app_retention_worker,app_deletion_verifier;
ALTER TABLE stripe_test_states ADD COLUMN source_lease_until timestamptz;
ALTER TABLE stripe_test_states ALTER COLUMN source_notice_id DROP NOT NULL;
ALTER TABLE stripe_test_states ADD COLUMN source_intent_id uuid REFERENCES stripe_test_intents(id) ON DELETE RESTRICT;
ALTER TABLE stripe_test_states ADD CONSTRAINT billing_one_source CHECK(num_nonnulls(source_notice_id,source_intent_id)=1) NOT VALID;
ALTER TABLE stripe_test_states VALIDATE CONSTRAINT billing_one_source;
GRANT SELECT(id) ON households TO app_billing_test;
GRANT SELECT(household_id,state) ON household_deletions TO app_billing_test;
GRANT SELECT(household_id,user_id,role) ON household_users TO app_billing_test;
CREATE POLICY billing_owner_only ON household_users AS RESTRICTIVE FOR SELECT TO app_billing_test
 USING(household_id=app.current_household() AND EXISTS(SELECT 1 FROM stripe_test_bindings b WHERE b.household_id=household_users.household_id AND b.owner_id=household_users.user_id));
GRANT SELECT(id,household_id,owner_id,account_id,customer_id,subscription_id,livemode,created_at) ON stripe_test_bindings TO app_billing_test;
GRANT SELECT(id,household_id,binding_id,account_id,event_id,event_type,object_id,provider_created,created_at,state,attempts,lease_token,lease_until,expected_revision),
 INSERT(household_id,binding_id,account_id,event_id,event_type,object_id,provider_created),UPDATE(state,attempts,lease_token,lease_until) ON stripe_test_notices TO app_billing_test;
GRANT SELECT(id,household_id,binding_id,account_id,request_key,reason,created_at,state,attempts,lease_token,lease_until,expected_revision),
 INSERT(household_id,binding_id,account_id,request_key,reason),UPDATE(state,attempts,lease_token,lease_until) ON stripe_test_intents TO app_billing_test;
GRANT SELECT(id,household_id,binding_id,account_id,source_notice_id,source_intent_id,source_lease_token,source_lease_until,revision,state,plan,paid_through,premium_until,reconciled_at),
 INSERT(household_id,binding_id,account_id,source_notice_id,source_intent_id,source_lease_token,state,plan,paid_through,premium_until),
 UPDATE(source_notice_id,source_intent_id,source_lease_token,state,plan,paid_through,premium_until) ON stripe_test_states TO app_billing_test;
GRANT INSERT(household_id,actor_type,action,target_type,target_id),SELECT(id,household_id,action,target_type,target_id) ON audit_log TO app_billing_test;
GRANT INSERT(household_id,event_type,aggregate_type,aggregate_id,payload),SELECT(id,household_id,event_type,aggregate_type,aggregate_id,payload) ON outbox_events TO app_billing_test;
GRANT USAGE ON SEQUENCE audit_log_id_seq,outbox_events_id_seq TO app_billing_test;
CREATE POLICY billing_audit_only ON audit_log AS RESTRICTIVE FOR SELECT TO app_billing_test
 USING(action ~ '^stripe_test_(notices|intents|states)\.(insert|update)$');
CREATE POLICY billing_outbox_only ON outbox_events AS RESTRICTIVE FOR SELECT TO app_billing_test
 USING(event_type='billing.test_state_reconciled');
CREATE UNIQUE INDEX billing_outbox_revision_unique ON outbox_events(aggregate_id,(payload->>'revision')) WHERE event_type='billing.test_state_reconciled';
CREATE OR REPLACE FUNCTION app.guard_household_write() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE hh uuid; data jsonb;
BEGIN
 -- Fixture/migration administrator is outside the application authority boundary.
 IF current_user NOT IN ('app_user','app_dispatcher','app_job_worker','app_document_worker','app_retention_worker','app_deletion_verifier','app_billing_test') THEN RETURN COALESCE(NEW,OLD); END IF;
 data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='households' THEN hh:=(data->>'id')::uuid;
 ELSIF TG_TABLE_NAME IN ('document_uploads','item_secrets','notification_deliveries') THEN
  -- RLS already scopes these via their parent. Hold the same transaction-scoped
  -- household fence even during cascades where a parent may already be invisible.
  hh:=app.current_household();
  IF hh IS NULL THEN RAISE EXCEPTION 'Household scope required' USING ERRCODE='42501'; END IF;
 ELSE hh:=(data->>'household_id')::uuid; END IF;
 -- Retention deletion is an explicit, manifest-bound capability, not a fence bypass.
 IF current_user='app_retention_worker' THEN
  IF TG_OP<>'DELETE' OR hh IS DISTINCT FROM app.current_household() OR NOT EXISTS(
   SELECT 1 FROM public.household_deletions d JOIN public.deletion_resources r ON r.deletion_id=d.id
   JOIN public.deletion_attempts a ON a.resource_id=r.id
   WHERE d.household_id=hh AND d.state='verifying' AND d.settle_until<=clock_timestamp()
   AND r.household_id=hh AND a.household_id=hh
   AND a.id=nullif(current_setting('request.erasure_attempt',true),'')::uuid
   AND a.lease_token=nullif(current_setting('request.erasure_token',true),'')::uuid
   AND a.completed_at IS NULL AND a.lease_until>clock_timestamp()
   AND r.component=CASE
    WHEN TG_TABLE_NAME IN ('documents','document_uploads') THEN 'documents'
    WHEN TG_TABLE_NAME IN ('items','obligations','document_chunks') THEN 'derived-records'
    WHEN TG_TABLE_NAME='item_secrets' THEN 'identifier-secrets'
    WHEN TG_TABLE_NAME IN ('reminders','notifications','notification_deliveries') THEN 'notifications-reminders'
    ELSE NULL END) THEN
   RAISE EXCEPTION 'Manifest-bound erasure required' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
 END IF;
 PERFORM app.assert_household_open(hh);
 IF current_user='app_document_worker' AND TG_TABLE_NAME='documents' AND TG_OP='UPDATE' THEN
  IF OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN RAISE EXCEPTION 'Sealed hash is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.status='processing' AND OLD.status IS DISTINCT FROM NEW.status AND NOT EXISTS(
    SELECT 1 FROM public.document_scans WHERE document_id=NEW.id AND household_id=NEW.household_id
      AND state='clean' AND sha256=NEW.sha256 AND size_bytes=NEW.size_bytes
      AND NEW.storage_path='hh/'||household_id::text||'/upload/'||document_id::text||'/sealed/'||seal_id::text) THEN
    RAISE EXCEPTION 'Durable clean scan required' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION app.guard_stripe_test_notice() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE revision_now integer;
BEGIN
 IF current_user<>'app_billing_test' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 IF NOT EXISTS(SELECT 1 FROM public.stripe_test_bindings b JOIN public.household_users h ON h.household_id=b.household_id AND h.user_id=b.owner_id AND h.role='owner'
  WHERE b.id=NEW.binding_id AND b.household_id=NEW.household_id AND b.account_id=NEW.account_id AND b.livemode=false) THEN
  RAISE EXCEPTION 'TEST binding admission refused' USING ERRCODE='55000';
 END IF;
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='stripe_test_notices' THEN
   IF NEW.provider_created>extract(epoch FROM clock_timestamp())+300 THEN RAISE EXCEPTION 'TEST notice refused' USING ERRCODE='55000'; END IF;
  END IF;
  NEW.created_at:=clock_timestamp();NEW.state:='pending';NEW.attempts:=0;NEW.lease_token:=NULL;NEW.lease_until:=NULL;NEW.expected_revision:=0;
 ELSIF NEW.state='leased' AND OLD.attempts<3 AND NEW.attempts=OLD.attempts+1 AND NEW.lease_token IS NOT NULL AND NEW.lease_token IS DISTINCT FROM OLD.lease_token
  AND (OLD.state='pending' OR (OLD.state='leased' AND OLD.lease_until<=clock_timestamp())) THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||NEW.binding_id::text,0)) OR EXISTS(
   SELECT 1 FROM public.stripe_test_notices WHERE binding_id=NEW.binding_id AND household_id=NEW.household_id AND id<>NEW.id AND state='leased' AND lease_until>clock_timestamp()
   UNION ALL SELECT 1 FROM public.stripe_test_intents WHERE binding_id=NEW.binding_id AND household_id=NEW.household_id AND id<>NEW.id AND state='leased' AND lease_until>clock_timestamp()) THEN
   RAISE EXCEPTION 'TEST billing busy' USING ERRCODE='55000';
  END IF;
  SELECT revision INTO revision_now FROM public.stripe_test_states WHERE binding_id=NEW.binding_id AND household_id=NEW.household_id;
  NEW.expected_revision:=coalesce(revision_now,0);NEW.lease_until:=clock_timestamp()+interval '60 seconds';
 ELSIF NEW.state IN ('refused','reconciled') AND OLD.state='leased' AND OLD.lease_until>clock_timestamp()
  AND NEW.attempts=OLD.attempts AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL THEN
  IF NEW.state='reconciled' AND NOT EXISTS(SELECT 1 FROM public.stripe_test_states WHERE binding_id=NEW.binding_id AND household_id=NEW.household_id
    AND source_lease_token=OLD.lease_token AND revision=OLD.expected_revision+1
    AND (CASE WHEN TG_TABLE_NAME='stripe_test_notices' THEN source_notice_id=OLD.id ELSE source_intent_id=OLD.id END)) THEN
   RAISE EXCEPTION 'TEST billing completion refused' USING ERRCODE='55000';
  END IF;
 ELSE RAISE EXCEPTION 'TEST billing transition refused' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stripe_test_intent_guard BEFORE INSERT OR UPDATE ON stripe_test_intents FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_test_notice();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON stripe_test_intents FOR EACH ROW EXECUTE FUNCTION app.guard_household_write();
CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON stripe_test_intents FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
CREATE OR REPLACE FUNCTION app.guard_stripe_test_state() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE n record;
BEGIN
 IF current_user<>'app_billing_test' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||NEW.binding_id::text,0)) THEN RAISE EXCEPTION 'TEST billing busy' USING ERRCODE='55000'; END IF;
 IF NEW.source_notice_id IS NOT NULL THEN SELECT binding_id,account_id,state,lease_token,lease_until,expected_revision INTO n FROM public.stripe_test_notices WHERE id=NEW.source_notice_id AND household_id=NEW.household_id FOR UPDATE;
 ELSE SELECT binding_id,account_id,state,lease_token,lease_until,expected_revision INTO n FROM public.stripe_test_intents WHERE id=NEW.source_intent_id AND household_id=NEW.household_id FOR UPDATE; END IF;
 IF n.binding_id IS NULL OR n.binding_id<>NEW.binding_id OR n.account_id<>NEW.account_id OR n.state<>'leased' OR n.lease_token IS DISTINCT FROM NEW.source_lease_token OR n.lease_until<=clock_timestamp()
  OR n.expected_revision<>(CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.revision END)
  OR (NEW.premium_until IS NOT NULL AND NEW.premium_until<=extract(epoch FROM clock_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM public.stripe_test_bindings b JOIN public.household_users h ON h.household_id=b.household_id AND h.user_id=b.owner_id AND h.role='owner' WHERE b.id=NEW.binding_id AND b.household_id=NEW.household_id) THEN
  RAISE EXCEPTION 'TEST billing state refused' USING ERRCODE='55000'; END IF;
 NEW.source_lease_until:=n.lease_until;NEW.revision:=n.expected_revision+1;NEW.reconciled_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION app.guard_billing_publication() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user='app_billing_test' THEN
  IF TG_TABLE_NAME='audit_log' THEN
   IF pg_trigger_depth()<2 OR NEW.actor_type<>'system' OR NEW.actor_id IS NOT NULL OR NEW.meta<>'{}'::jsonb
    OR NEW.target_type NOT IN ('stripe_test_notices','stripe_test_intents','stripe_test_states') OR NEW.action NOT IN (NEW.target_type||'.insert',NEW.target_type||'.update') THEN
    RAISE EXCEPTION 'TEST audit refused' USING ERRCODE='42501'; END IF;
  ELSE
   IF NEW.event_type<>'billing.test_state_reconciled' OR NEW.aggregate_type<>'stripe-test-state' OR NEW.transport_scope IS NOT NULL OR NEW.traceparent IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.stripe_test_states s WHERE s.id=NEW.aggregate_id AND s.household_id=NEW.household_id AND NEW.payload=jsonb_build_object('revision',s.revision)) THEN
    RAISE EXCEPTION 'TEST outbox refused' USING ERRCODE='42501'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='outbox_events' THEN
  IF NEW.event_type='billing.test_state_reconciled' AND current_user IN ('app_user','app_job_worker','app_document_worker','app_retention_worker','app_deletion_verifier','app_dispatcher') THEN
  RAISE EXCEPTION 'TEST outbox authority refused' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_billing_publication() FROM PUBLIC;
CREATE TRIGGER billing_publication_guard BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION app.guard_billing_publication();
CREATE TRIGGER billing_publication_guard BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION app.guard_billing_publication();
CREATE FUNCTION app.assert_billing_atomic_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_billing_test' THEN RETURN NEW; END IF;
 IF NEW.source_lease_until IS NULL OR NEW.source_lease_until<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.stripe_test_notices WHERE id=NEW.source_notice_id AND household_id=NEW.household_id AND state='reconciled' AND expected_revision=NEW.revision-1
  UNION ALL SELECT 1 FROM public.stripe_test_intents WHERE id=NEW.source_intent_id AND household_id=NEW.household_id AND state='reconciled' AND expected_revision=NEW.revision-1)
  OR (SELECT count(*) FROM public.outbox_events WHERE household_id=NEW.household_id AND aggregate_id=NEW.id AND event_type='billing.test_state_reconciled' AND payload=jsonb_build_object('revision',NEW.revision))<>1 THEN
  RAISE EXCEPTION 'TEST billing atomic commit refused' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.assert_billing_atomic_commit() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER billing_atomic_commit AFTER INSERT OR UPDATE ON stripe_test_states DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.assert_billing_atomic_commit();
-- Eligibility is a read-only projection, not permission to change the product cap catalog.
CREATE VIEW billing_test_eligibility WITH(security_invoker=true,security_barrier=true) AS
 SELECT household_id,state,plan,revision,paid_through,premium_until,
 (state IN ('active','canceling','grace') AND premium_until>extract(epoch FROM clock_timestamp())) AS eligible
 FROM stripe_test_states WHERE household_id=app.current_household();
REVOKE ALL ON billing_test_eligibility FROM PUBLIC,app_user,app_dispatcher;
GRANT SELECT(household_id,state,plan,revision,paid_through,premium_until,eligible) ON billing_test_eligibility TO app_user,app_billing_test;
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices','stripe-states','stripe-intents','export-artifacts')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
