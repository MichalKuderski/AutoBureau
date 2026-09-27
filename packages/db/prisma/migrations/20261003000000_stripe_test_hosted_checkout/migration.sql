-- Hosted Stripe TEST checkout and event routing (ADR-020 hosted amendment, founder-approved 2026-09-27).
--
-- Checkout intents: the owner's server-mediated request for a TEST subscription. The web
-- runtime records the intent BEFORE any provider call, then the provider's customer and
-- checkout-session IDs after it (outside any transaction). When the owner returns, the web
-- runtime re-reads the session from Stripe and creates the existing immutable binding through
-- the existing owner guard, then marks the intent bound. The browser's return URL, metadata
-- and webhook arrival are never ownership or payment evidence.
--
-- Event routes: a verified TEST webhook knows only provider IDs. Like ADR-022's Plaid routes,
-- each binding gets knows-the-key rows (SHA-256 of 'stripe-test:' || account || ':' || object)
-- that the billing runtime can read ONLY for the digest it sets in request.stripe_route, so it
-- can resolve its own bindings but cannot list or guess anyone else's.
--
-- Empty new tables; bounded locks (5 s / 60 s); no existing row is rewritten. Rollback: unmount
-- the checkout/portal routes and the billing runtime; keep the journals (provider-work evidence).
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';

CREATE TABLE stripe_test_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]{1,240}$'),
 plan text NOT NULL CHECK(plan IN ('monthly','annual')),
 request_key uuid NOT NULL,
 customer_id text CHECK(customer_id ~ '^cus_[A-Za-z0-9]{1,240}$'),
 session_id text UNIQUE CHECK(session_id ~ '^cs_test_[A-Za-z0-9]{1,240}$'),
 state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','opened','bound','abandoned')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(household_id,request_key), UNIQUE(id,household_id),
 CHECK((state='created' AND customer_id IS NULL AND session_id IS NULL)
   OR (state IN ('opened','bound') AND customer_id IS NOT NULL AND session_id IS NOT NULL) OR state='abandoned')
);
CREATE INDEX stripe_test_checkouts_household_idx ON stripe_test_checkouts(household_id);
-- At most one unresolved checkout per household: a second one is resolved (confirmed or
-- expired at the provider) before another session can exist, so one owner cannot pay twice.
CREATE UNIQUE INDEX stripe_test_checkouts_one_open ON stripe_test_checkouts(household_id) WHERE state IN ('created','opened');

CREATE TABLE stripe_test_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 route_digest text NOT NULL UNIQUE CHECK(route_digest ~ '^[a-f0-9]{64}$'),
 household_id uuid NOT NULL, binding_id uuid NOT NULL, account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('customer','subscription')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(binding_id,kind),
 FOREIGN KEY(binding_id,household_id,account_id) REFERENCES stripe_test_bindings(id,household_id,account_id) ON DELETE RESTRICT
);
CREATE INDEX stripe_test_routes_household_idx ON stripe_test_routes(household_id);

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['stripe_test_checkouts','stripe_test_routes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY stripe_test_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier,app_billing_test',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','app_plaid_sandbox'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF;
  END LOOP;
  EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_household_write()',t);
  EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
  EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
 END LOOP;
END $$;

-- The owner's web session writes intents; nothing else writes them.
GRANT SELECT ON stripe_test_checkouts TO app_user;
GRANT INSERT(household_id,owner_id,account_id,plan,request_key),UPDATE(customer_id,session_id,state) ON stripe_test_checkouts TO app_user;
-- The billing runtime verifies an intent before provider work; it never writes intents.
GRANT SELECT(id,household_id,account_id,plan,state,customer_id,session_id) ON stripe_test_checkouts TO app_billing_test;
-- Routes are written only by the binding trigger (as the owner inserting the binding).
GRANT SELECT(id,household_id,binding_id,kind),INSERT(route_digest,household_id,binding_id,account_id,kind) ON stripe_test_routes TO app_user;
-- The billing runtime may read exactly the route whose digest it holds, and nothing else.
GRANT SELECT(route_digest,household_id,binding_id,kind) ON stripe_test_routes TO app_billing_test;
CREATE POLICY stripe_route_lookup ON stripe_test_routes FOR SELECT TO app_billing_test
 USING(route_digest=current_setting('request.stripe_route',true));

CREATE FUNCTION app.guard_stripe_test_checkout() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE actor uuid:=app.current_user_id();
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.household_users WHERE household_id=NEW.household_id AND user_id=actor AND role='owner') THEN
  RAISE EXCEPTION 'Test checkout refused' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.owner_id IS DISTINCT FROM actor OR NEW.state<>'created' OR NEW.customer_id IS NOT NULL OR NEW.session_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.stripe_test_bindings WHERE household_id=NEW.household_id) THEN
   RAISE EXCEPTION 'Test checkout refused' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'customer_id'-'session_id'-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'customer_id'-'session_id'-'state'-'updated_at')
    OR OLD.owner_id IS DISTINCT FROM actor OR OLD.state IN ('bound','abandoned') THEN
  RAISE EXCEPTION 'Test checkout refused' USING ERRCODE='42501';
 END IF;
 IF NOT (
      (OLD.state='created' AND NEW.state='opened' AND NEW.customer_id IS NOT NULL AND NEW.session_id IS NOT NULL)
   OR (OLD.state='opened' AND NEW.state='bound' AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
       AND EXISTS(SELECT 1 FROM public.stripe_test_bindings b WHERE b.household_id=OLD.household_id AND b.account_id=OLD.account_id AND b.customer_id=OLD.customer_id))
   OR (OLD.state IN ('created','opened') AND NEW.state='abandoned' AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id)) THEN
  RAISE EXCEPTION 'Test checkout refused' USING ERRCODE='42501';
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_stripe_test_checkout() FROM PUBLIC;
CREATE TRIGGER stripe_test_checkout_guard BEFORE INSERT OR UPDATE ON stripe_test_checkouts FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_test_checkout();

-- Knows-the-key routes are derived from the immutable binding itself, never from caller input.
CREATE FUNCTION app.route_stripe_test_binding() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 INSERT INTO public.stripe_test_routes(route_digest,household_id,binding_id,account_id,kind) VALUES
  (encode(sha256(convert_to('stripe-test:'||NEW.account_id||':'||NEW.customer_id,'UTF8')),'hex'),NEW.household_id,NEW.id,NEW.account_id,'customer'),
  (encode(sha256(convert_to('stripe-test:'||NEW.account_id||':'||NEW.subscription_id,'UTF8')),'hex'),NEW.household_id,NEW.id,NEW.account_id,'subscription');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.route_stripe_test_binding() FROM PUBLIC;
CREATE TRIGGER stripe_test_binding_routes AFTER INSERT ON stripe_test_bindings FOR EACH ROW EXECUTE FUNCTION app.route_stripe_test_binding();

-- The owner's return from a TEST checkout is its own closed reconciliation reason: it
-- never relies on webhook arrival, and never pretends to be a missed or scheduled recheck.
ALTER TABLE stripe_test_intents DROP CONSTRAINT stripe_test_intents_reason_check;
ALTER TABLE stripe_test_intents ADD CONSTRAINT stripe_test_intents_reason_check
 CHECK(reason IN ('missed-webhook','scheduled-recheck','operator-reconcile','checkout-return')) NOT VALID;
ALTER TABLE stripe_test_intents VALIDATE CONSTRAINT stripe_test_intents_reason_check;

-- Both journals are household data: the deletion inventory must be able to name them.
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK((inventory_source IS NULL AND source_key IS NULL) OR (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','stripe-bindings','stripe-states','stripe-intents','stripe-notices','stripe-checkouts','stripe-routes','export-artifacts','auth-challenges','custodies','processing','results','result-reviews','period-decisions','plaid-subjects','plaid-exchanges','plaid-items','plaid-credentials','plaid-routes','plaid-cursors','plaid-webhooks','plaid-accounts','plaid-transactions') AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
