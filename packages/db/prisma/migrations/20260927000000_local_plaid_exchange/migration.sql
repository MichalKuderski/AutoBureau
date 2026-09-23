-- ADR-022 LOCAL synthetic exchange only. Empty tables; no hosted activation.
-- 5s metadata locks, 60s statement bound. Rollback stops callers, retains evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE ROLE app_plaid_sandbox NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,app TO app_plaid_sandbox;
GRANT EXECUTE ON FUNCTION app.current_household(),app.current_user_id(),app.assert_household_open(uuid) TO app_plaid_sandbox;
CREATE TABLE plaid_local_subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL UNIQUE REFERENCES households(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL, incarnation_id uuid NOT NULL DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,household_id),UNIQUE(household_id,incarnation_id)
);
CREATE TABLE plaid_local_exchanges (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,subject_id uuid NOT NULL,owner_id uuid NOT NULL,
 consent_version integer NOT NULL CHECK(consent_version=1),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','started','indeterminate','completed')),
 lease_token uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,household_id),FOREIGN KEY(subject_id,household_id) REFERENCES plaid_local_subjects(id,household_id) ON DELETE RESTRICT,
 CHECK((state='pending' AND lease_token IS NULL AND lease_until IS NULL) OR (state<>'pending' AND lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX plaid_exchange_scope ON plaid_local_exchanges(household_id,id);
CREATE TABLE plaid_local_items (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,exchange_id uuid NOT NULL UNIQUE,subject_id uuid NOT NULL,owner_id uuid NOT NULL,
 incarnation_id uuid NOT NULL,environment text NOT NULL DEFAULT 'local-synthetic-sandbox' CHECK(environment='local-synthetic-sandbox'),
 provider_item_id text NOT NULL UNIQUE CHECK(provider_item_id ~ '^public-fixture-item-[a-f0-9-]{36}$'),
 credential_revision integer NOT NULL DEFAULT 1 CHECK(credential_revision=1),state text NOT NULL DEFAULT 'active' CHECK(state='active'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,household_id),
 FOREIGN KEY(exchange_id,household_id) REFERENCES plaid_local_exchanges(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(subject_id,household_id) REFERENCES plaid_local_subjects(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(household_id,incarnation_id) REFERENCES plaid_local_subjects(household_id,incarnation_id) ON DELETE RESTRICT
);
CREATE INDEX plaid_item_scope ON plaid_local_items(household_id,id);
CREATE TABLE plaid_local_credentials (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,version integer NOT NULL CHECK(version=1),key_version integer NOT NULL CHECK(key_version>0),
 nonce text NOT NULL CHECK(nonce ~ '^[A-Za-z0-9_-]{16}$'),wrap_nonce text NOT NULL CHECK(wrap_nonce ~ '^[A-Za-z0-9_-]{16}$'),
 wrapped_key text NOT NULL CHECK(wrapped_key ~ '^[A-Za-z0-9_-]{64}$'),ciphertext text NOT NULL CHECK(length(ciphertext) BETWEEN 24 AND 683 AND ciphertext ~ '^[A-Za-z0-9_-]+$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(id,household_id) REFERENCES plaid_local_items(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX plaid_credential_scope ON plaid_local_credentials(household_id,id);
DO $$ DECLARE t text;r text;BEGIN FOREACH t IN ARRAY ARRAY['plaid_local_subjects','plaid_local_exchanges','plaid_local_items','plaid_local_credentials'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY household_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier,app_billing_test,app_plaid_sandbox',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
 EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
 EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
END LOOP;END $$;
GRANT SELECT(id,household_id,owner_id,incarnation_id,created_at),INSERT(household_id) ON plaid_local_subjects TO app_user;
GRANT SELECT(id,household_id,subject_id,owner_id,consent_version,state,created_at),INSERT(id,household_id,subject_id,consent_version) ON plaid_local_exchanges TO app_user;
GRANT SELECT(id,household_id,state,created_at) ON plaid_local_items TO app_user;
GRANT SELECT(id,household_id,owner_id,incarnation_id,created_at) ON plaid_local_subjects TO app_plaid_sandbox;
GRANT SELECT(id,household_id,subject_id,owner_id,consent_version,state,lease_token,lease_until,created_at),UPDATE(state,lease_token) ON plaid_local_exchanges TO app_plaid_sandbox;
GRANT SELECT(id,household_id,exchange_id,subject_id,owner_id,incarnation_id,environment,provider_item_id,credential_revision,state,created_at),INSERT(id,household_id,exchange_id,provider_item_id) ON plaid_local_items TO app_plaid_sandbox;
GRANT SELECT(id,household_id,version,key_version,nonce,wrap_nonce,wrapped_key,ciphertext,created_at),INSERT(id,household_id,version,key_version,nonce,wrap_nonce,wrapped_key,ciphertext) ON plaid_local_credentials TO app_plaid_sandbox;
GRANT SELECT(id) ON households TO app_plaid_sandbox;
GRANT SELECT(household_id,state) ON household_deletions TO app_plaid_sandbox;
GRANT SELECT(household_id,user_id,role) ON household_users TO app_plaid_sandbox;
CREATE POLICY plaid_bound_owner_only ON household_users AS RESTRICTIVE FOR SELECT TO app_plaid_sandbox USING(EXISTS(SELECT 1 FROM plaid_local_subjects s WHERE s.household_id=household_users.household_id AND s.owner_id=household_users.user_id));
-- Preserve the identity mirror's application authority while bounding this NEW role.
-- A policy on the historically RLS-disabled users table alone would be ineffective.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_mirror_application ON users FOR ALL TO app_user USING(true) WITH CHECK(true);
GRANT SELECT(id,status) ON users TO app_plaid_sandbox;
CREATE POLICY plaid_bound_user ON users FOR SELECT TO app_plaid_sandbox USING(EXISTS(SELECT 1 FROM plaid_local_subjects s WHERE s.household_id=app.current_household() AND s.owner_id=users.id));
GRANT INSERT(household_id,actor_type,action,target_type,target_id) ON audit_log TO app_plaid_sandbox;
CREATE POLICY plaid_audit_only ON audit_log AS RESTRICTIVE FOR INSERT TO app_plaid_sandbox WITH CHECK(action ~ '^plaid_local_(exchanges|items|credentials)\.(insert|update)$' AND target_type IN ('plaid_local_exchanges','plaid_local_items','plaid_local_credentials'));
GRANT SELECT(id,household_id,event_type,aggregate_type,aggregate_id,payload),INSERT(household_id,event_type,aggregate_type,aggregate_id,payload) ON outbox_events TO app_plaid_sandbox;
CREATE POLICY plaid_outbox_only ON outbox_events AS RESTRICTIVE FOR ALL TO app_plaid_sandbox USING(event_type IN ('plaid.local_exchange_requested','plaid.local_item_activated')) WITH CHECK(event_type='plaid.local_item_activated' AND aggregate_type='plaid-local-item' AND payload->'version'='1'::jsonb AND (payload-'version'-'operation_id')='{}'::jsonb AND EXISTS(SELECT 1 FROM plaid_local_exchanges e JOIN plaid_local_items i ON i.exchange_id=e.id AND i.household_id=e.household_id WHERE e.household_id=outbox_events.household_id AND e.id::text=payload->>'operation_id' AND e.state='completed' AND i.state='active' AND i.id=outbox_events.aggregate_id));
GRANT USAGE ON SEQUENCE audit_log_id_seq,outbox_events_id_seq TO app_plaid_sandbox;
CREATE FUNCTION app.guard_plaid_local() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE s record;e record;owner uuid;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('plaid-local:'||NEW.household_id::text,0));
 IF TG_TABLE_NAME='plaid_local_subjects' THEN
  IF current_user<>'app_user' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  owner:=app.current_user_id();NEW.owner_id:=owner;NEW.incarnation_id:=gen_random_uuid();NEW.created_at:=clock_timestamp();
 ELSE
  IF TG_TABLE_NAME='plaid_local_exchanges' THEN SELECT * INTO s FROM plaid_local_subjects WHERE id=NEW.subject_id AND household_id=NEW.household_id;
  ELSIF TG_TABLE_NAME='plaid_local_items' THEN SELECT * INTO e FROM plaid_local_exchanges WHERE id=NEW.exchange_id AND household_id=NEW.household_id;
  ELSE SELECT x.* INTO e FROM plaid_local_items i JOIN plaid_local_exchanges x ON x.id=i.exchange_id AND x.household_id=i.household_id WHERE i.id=NEW.id AND i.household_id=NEW.household_id;
  END IF;
  IF TG_TABLE_NAME IN ('plaid_local_items','plaid_local_credentials') THEN SELECT * INTO s FROM plaid_local_subjects WHERE id=e.subject_id AND household_id=NEW.household_id;END IF;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Local financial operation refused';END IF;owner:=s.owner_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM household_users h JOIN users u ON u.id=h.user_id WHERE h.household_id=NEW.household_id AND h.user_id=owner AND h.role='owner' AND u.status='active') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 -- The household privacy lock also fences ordinary membership mutation.
 IF TG_TABLE_NAME='plaid_local_subjects' THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='plaid_local_exchanges' THEN
  IF TG_OP='INSERT' THEN
   IF current_user<>'app_user' OR s.owner_id IS DISTINCT FROM app.current_user_id() THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   NEW.owner_id:=s.owner_id;NEW.state:='pending';NEW.lease_token:=NULL;NEW.lease_until:=NULL;NEW.created_at:=clock_timestamp();
  ELSE
   IF current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   IF OLD.state='pending' AND NEW.state='started' AND NEW.lease_token IS NOT NULL THEN NEW.lease_until:=clock_timestamp()+interval '60 seconds';
   ELSIF OLD.state='started' AND NEW.state='indeterminate' AND OLD.lease_until<=clock_timestamp() THEN NEW.lease_token:=OLD.lease_token;
   ELSIF OLD.state='started' AND NEW.state='completed' AND OLD.lease_until>clock_timestamp() AND OLD.lease_token::text=current_setting('request.plaid_lease',true) THEN NEW.lease_token:=OLD.lease_token;
   ELSE RAISE EXCEPTION 'Local financial operation refused';END IF;
  END IF;
 ELSE
  IF current_user<>'app_plaid_sandbox' OR TG_OP<>'INSERT' OR e.state IS DISTINCT FROM 'started' OR e.lease_until<=clock_timestamp() OR e.lease_token::text IS DISTINCT FROM current_setting('request.plaid_lease',true) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  IF TG_TABLE_NAME='plaid_local_items' THEN
   IF NEW.id<>e.id THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   NEW.subject_id:=s.id;NEW.owner_id:=s.owner_id;NEW.incarnation_id:=s.incarnation_id;NEW.created_at:=clock_timestamp();
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['plaid_local_subjects','plaid_local_exchanges','plaid_local_items','plaid_local_credentials'] LOOP
 EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_local()',t);
END LOOP;END $$;
CREATE FUNCTION app.check_plaid_local_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE e record;i record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN NEW;END IF;
 IF current_user='app_user' THEN
  IF NOT EXISTS(SELECT 1 FROM outbox_events WHERE household_id=NEW.household_id AND event_type='plaid.local_exchange_requested' AND aggregate_type='plaid-local-exchange' AND aggregate_id=NEW.id AND payload='{"version":1}'::jsonb) THEN RAISE EXCEPTION 'Local financial intent missing';END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='plaid_local_exchanges' THEN SELECT * INTO e FROM plaid_local_exchanges WHERE id=NEW.id AND household_id=NEW.household_id;
 ELSIF TG_TABLE_NAME='plaid_local_items' THEN SELECT * INTO e FROM plaid_local_exchanges WHERE id=NEW.exchange_id AND household_id=NEW.household_id;
 ELSE SELECT x.* INTO e FROM plaid_local_exchanges x JOIN plaid_local_items i0 ON i0.exchange_id=x.id AND i0.household_id=x.household_id WHERE i0.id=NEW.id AND i0.household_id=NEW.household_id;END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 IF e.state='pending' AND NOT EXISTS(SELECT 1 FROM outbox_events WHERE household_id=e.household_id AND event_type='plaid.local_exchange_requested' AND aggregate_type='plaid-local-exchange' AND aggregate_id=e.id AND payload='{"version":1}'::jsonb) THEN RAISE EXCEPTION 'Local financial intent missing';END IF;
 IF current_user='app_plaid_sandbox' AND (TG_TABLE_NAME<>'plaid_local_exchanges' OR e.state='completed') THEN
  SELECT * INTO i FROM plaid_local_items WHERE exchange_id=e.id AND household_id=e.household_id;
  IF e.state IS DISTINCT FROM 'completed' OR e.lease_until<=clock_timestamp() OR i.id IS NULL OR NOT EXISTS(SELECT 1 FROM plaid_local_credentials WHERE id=i.id AND household_id=e.household_id)
   OR NOT EXISTS(SELECT 1 FROM outbox_events WHERE household_id=e.household_id AND event_type='plaid.local_item_activated' AND aggregate_type='plaid-local-item' AND aggregate_id=i.id AND payload=jsonb_build_object('version',1,'operation_id',e.id::text)) THEN RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['plaid_local_exchanges','plaid_local_items','plaid_local_credentials'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER plaid_commit AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_local_commit()',t);
END LOOP;END $$;
CREATE FUNCTION app.guard_plaid_effect() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN IF current_user='app_plaid_sandbox' THEN PERFORM app.assert_household_open(NEW.household_id);END IF;RETURN NEW;END $$;
CREATE TRIGGER plaid_effect_fence BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_effect();
CREATE TRIGGER plaid_effect_fence BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_effect();
CREATE UNIQUE INDEX plaid_local_intent_unique ON outbox_events(event_type,aggregate_id) WHERE event_type IN ('plaid.local_exchange_requested','plaid.local_item_activated');
REVOKE ALL ON FUNCTION app.guard_plaid_local(),app.check_plaid_local_commit(),app.guard_plaid_effect() FROM PUBLIC;
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK((inventory_source IS NULL AND source_key IS NULL) OR (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','stripe-bindings','stripe-states','stripe-intents','stripe-notices','export-artifacts','auth-challenges','custodies','processing','results','result-reviews','plaid-subjects','plaid-exchanges','plaid-items','plaid-credentials') AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
