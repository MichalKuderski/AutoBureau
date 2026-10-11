-- ADR-022 durable LOCAL synthetic lifecycle after exchange: non-enumerating Item routing,
-- verified-webhook inbox, accounts/transactions, one per-Item operation lease with atomic
-- cursor+data commit, status projection, reconnect request, envelope rotation, unlink,
-- provider-removal reconciliation and deletion-fence removal. No hosted activation.
-- Fixture grammars (public-fixture-*) keep real provider identifiers out of every column.
-- New tables are empty. Existing Plaid tables were never hosted-activated; the two
-- relaxed CHECKs and added columns are metadata-only (constant defaults, no rewrite).
-- 5s lock / 60s statement bounds. Rollback disables callers and retains journals/fences;
-- do not drop encrypted custody while an external removal is unresolved.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';

ALTER TABLE plaid_local_items DROP CONSTRAINT plaid_local_items_state_check;
ALTER TABLE plaid_local_items DROP CONSTRAINT plaid_local_items_credential_revision_check;
ALTER TABLE plaid_local_items
 ADD CONSTRAINT plaid_local_items_state_check CHECK(state IN ('active','login-required','revoked','unlinking','removal-indeterminate','removed')),
 ADD CONSTRAINT plaid_local_items_credential_revision_check CHECK(credential_revision BETWEEN 1 AND 1000000),
 ADD COLUMN removal_evidence text CHECK(removal_evidence IN ('provider-acknowledged','provider-invalid')),
 ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE plaid_local_items ALTER COLUMN status_changed_at SET DEFAULT clock_timestamp();
-- Acknowledgement, established provider-invalid state and unknown outcome stay distinct.
ALTER TABLE plaid_local_items ADD CONSTRAINT plaid_local_items_removal_evidence CHECK((state='removed')=(removal_evidence IS NOT NULL));
ALTER TABLE plaid_local_credentials ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 1000000);

-- Knows-the-key routing: SHA-256 of environment + exact provider Item ID. A verified webhook
-- can resolve its own Item; the runtime cannot enumerate others (no household GUC, no list).
CREATE TABLE plaid_local_item_routes (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,route_digest text NOT NULL UNIQUE CHECK(route_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(id,household_id) REFERENCES plaid_local_items(id,household_id) ON DELETE RESTRICT
);
-- One row per Item: cursor, its revision and the single operation lease. Leases use DB time.
CREATE TABLE plaid_local_cursors (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,
 cursor text CHECK(char_length(cursor) BETWEEN 1 AND 256 AND cursor ~ '^[A-Za-z0-9+/=_-]+$'),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 op text CHECK(op IN ('sync','remove','reconcile','rotate')),op_token uuid,op_until timestamptz,
 op_credential_revision integer,op_cursor_revision bigint,op_watermark timestamptz,
 last_outcome text NOT NULL DEFAULT 'never' CHECK(last_outcome IN ('never','synced','login-required','revoked','unavailable','exhausted','rotated','removed','removal-indeterminate','still-present')),
 refresh_requested boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(id,household_id) REFERENCES plaid_local_items(id,household_id) ON DELETE RESTRICT,
 CHECK((op IS NULL)=(op_token IS NULL) AND (op IS NULL)=(op_until IS NULL) AND (op IS NULL)=(op_credential_revision IS NULL)
  AND (op IS NULL)=(op_cursor_revision IS NULL) AND (op IS NULL)=(op_watermark IS NULL))
);
CREATE INDEX plaid_cursor_scope ON plaid_local_cursors(household_id,id);
-- Verified ingress stores only the body digest and a closed signal; never the raw body.
CREATE TABLE plaid_local_webhooks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL,item_id uuid NOT NULL,
 signal text NOT NULL CHECK(signal IN ('transactions','item-status')),body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),applied_at timestamptz,
 FOREIGN KEY(item_id,household_id) REFERENCES plaid_local_items(id,household_id) ON DELETE RESTRICT,
 CHECK((state='applied')=(applied_at IS NOT NULL))
);
CREATE UNIQUE INDEX plaid_webhook_pending_digest ON plaid_local_webhooks(item_id,body_digest) WHERE state='pending';
CREATE INDEX plaid_webhook_scope ON plaid_local_webhooks(household_id,item_id,state,received_at);
CREATE TABLE plaid_local_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL,item_id uuid NOT NULL,
 provider_account_id text NOT NULL CHECK(provider_account_id ~ '^public-fixture-account-[a-f0-9-]{36}$'),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
 kind text NOT NULL CHECK(kind IN ('depository','credit','loan','investment','other')),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 current_cents bigint CHECK(current_cents BETWEEN -100000000000000 AND 100000000000000),
 available_cents bigint CHECK(available_cents BETWEEN -100000000000000 AND 100000000000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(item_id,provider_account_id),UNIQUE(id,item_id,household_id),
 FOREIGN KEY(item_id,household_id) REFERENCES plaid_local_items(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX plaid_account_scope ON plaid_local_accounts(household_id,item_id);
CREATE TABLE plaid_local_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL,item_id uuid NOT NULL,account_id uuid NOT NULL,
 provider_transaction_id text NOT NULL CHECK(provider_transaction_id ~ '^public-fixture-txn-[a-f0-9-]{36}$'),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN -100000000000000 AND 100000000000000),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),posted_on date NOT NULL CHECK(posted_on BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 120 AND description !~ '[[:cntrl:]]'),pending boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(item_id,provider_transaction_id),
 FOREIGN KEY(account_id,item_id,household_id) REFERENCES plaid_local_accounts(id,item_id,household_id) ON DELETE RESTRICT
);
CREATE INDEX plaid_transaction_scope ON plaid_local_transactions(household_id,item_id,posted_on);

DO $$ DECLARE t text;r text;BEGIN FOREACH t IN ARRAY ARRAY['plaid_local_item_routes','plaid_local_cursors','plaid_local_webhooks','plaid_local_accounts','plaid_local_transactions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY household_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier,app_billing_test,app_plaid_sandbox',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
 EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
END LOOP;END $$;
-- The only row visible without a household scope is the one whose digest the caller already holds.
CREATE POLICY plaid_route_lookup ON plaid_local_item_routes FOR SELECT TO app_plaid_sandbox USING(route_digest=current_setting('request.plaid_route',true));

GRANT SELECT(id,household_id,route_digest),INSERT(id,household_id,route_digest) ON plaid_local_item_routes TO app_plaid_sandbox;
GRANT SELECT(id,household_id,cursor,revision,op,op_token,op_until,op_credential_revision,op_cursor_revision,op_watermark,last_outcome,refresh_requested,updated_at),
 INSERT(id,household_id),UPDATE(cursor,revision,op,op_token,last_outcome,refresh_requested) ON plaid_local_cursors TO app_plaid_sandbox;
GRANT SELECT(id,household_id,item_id,signal,body_digest,state,received_at,applied_at),INSERT(household_id,item_id,signal,body_digest),UPDATE(state) ON plaid_local_webhooks TO app_plaid_sandbox;
GRANT SELECT(id,household_id,item_id,provider_account_id,name,kind,currency,current_cents,available_cents,created_at,updated_at),
 INSERT(household_id,item_id,provider_account_id,name,kind,current_cents,available_cents),UPDATE(name,kind,current_cents,available_cents) ON plaid_local_accounts TO app_plaid_sandbox;
GRANT SELECT(id,household_id,item_id,account_id,provider_transaction_id,amount_cents,currency,posted_on,description,pending,created_at,updated_at),
 INSERT(household_id,item_id,account_id,provider_transaction_id,amount_cents,posted_on,description,pending),UPDATE(account_id,amount_cents,posted_on,description,pending),DELETE ON plaid_local_transactions TO app_plaid_sandbox;
GRANT SELECT(removal_evidence,status_changed_at),UPDATE(state,credential_revision,removal_evidence) ON plaid_local_items TO app_plaid_sandbox;
GRANT SELECT(revision),UPDATE(key_version,nonce,wrap_nonce,wrapped_key,ciphertext,revision),DELETE ON plaid_local_credentials TO app_plaid_sandbox;
-- Application: owner requests + safe projection. Never provider IDs, cursor, lease or custody.
GRANT SELECT(status_changed_at),UPDATE(state) ON plaid_local_items TO app_user;
GRANT SELECT(id,household_id,last_outcome,refresh_requested,updated_at),UPDATE(refresh_requested) ON plaid_local_cursors TO app_user;
GRANT SELECT(id,household_id,item_id,name,kind,currency,current_cents,available_cents,updated_at) ON plaid_local_accounts TO app_user;
GRANT SELECT(id,household_id,item_id,account_id,amount_cents,currency,posted_on,description,pending,updated_at) ON plaid_local_transactions TO app_user;

-- Fence state under the shared privacy lock. 'fenced' permits only erasure-direction removal.
CREATE FUNCTION app.plaid_fence_state(hh uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-fence:'||hh::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('plaid-local:'||hh::text,0));
 IF EXISTS(SELECT 1 FROM public.household_deletions WHERE household_id=hh AND state='completed') THEN RETURN 'closed';END IF;
 IF EXISTS(SELECT 1 FROM public.household_deletions WHERE household_id=hh AND state IN ('fenced','verifying')) THEN RETURN 'fenced';END IF;
 RETURN 'open';
END $$;
-- Bound owner and incarnation continuity for ordinary (non-erasure) financial writes.
CREATE FUNCTION app.assert_plaid_binding(hh uuid,item uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.plaid_local_items i JOIN public.plaid_local_subjects s ON s.id=i.subject_id AND s.household_id=i.household_id AND s.incarnation_id=i.incarnation_id AND s.owner_id=i.owner_id
  JOIN public.household_users h ON h.household_id=i.household_id AND h.user_id=s.owner_id AND h.role='owner' JOIN public.users u ON u.id=h.user_id AND u.status='active'
  WHERE i.id=item AND i.household_id=hh) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
END $$;
-- Valid lease held by THIS transaction (token carried in a transaction-local setting).
CREATE FUNCTION app.plaid_op_held(hh uuid,item uuid,kind text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.plaid_local_cursors c WHERE c.id=item AND c.household_id=hh AND c.op=kind AND c.op_until>clock_timestamp()
  AND c.op_token::text=current_setting('request.plaid_op',true))
$$;

CREATE FUNCTION app.index_plaid_item() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 INSERT INTO public.plaid_local_item_routes(id,household_id,route_digest) VALUES(NEW.id,NEW.household_id,encode(sha256(convert_to(NEW.environment||':'||NEW.provider_item_id,'UTF8')),'hex'));
 INSERT INTO public.plaid_local_cursors(id,household_id) VALUES(NEW.id,NEW.household_id);
 RETURN NEW;
END $$;
CREATE TRIGGER plaid_item_index AFTER INSERT ON plaid_local_items FOR EACH ROW EXECUTE FUNCTION app.index_plaid_item();

CREATE FUNCTION app.guard_plaid_index() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE i record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_OP<>'INSERT' OR current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 SELECT * INTO i FROM public.plaid_local_items WHERE id=NEW.id AND household_id=NEW.household_id;
 IF i.id IS NULL OR i.state<>'active' OR i.credential_revision<>1 THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_TABLE_NAME='plaid_local_item_routes' THEN
  IF NEW.route_digest IS DISTINCT FROM encode(sha256(convert_to(i.environment||':'||i.provider_item_id,'UTF8')),'hex') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  NEW.created_at:=clock_timestamp();
 ELSE
  NEW.cursor:=NULL;NEW.revision:=0;NEW.op:=NULL;NEW.op_token:=NULL;NEW.op_until:=NULL;NEW.op_credential_revision:=NULL;NEW.op_cursor_revision:=NULL;NEW.op_watermark:=NULL;
  NEW.last_outcome:='never';NEW.refresh_requested:=true;NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;

-- Item lifecycle: app_user may only request unlink; the runtime transitions under its lease.
CREATE FUNCTION app.guard_plaid_item_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE fence text;c record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF (NEW.id,NEW.household_id,NEW.exchange_id,NEW.subject_id,NEW.owner_id,NEW.incarnation_id,NEW.environment,NEW.provider_item_id,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.exchange_id,OLD.subject_id,OLD.owner_id,OLD.incarnation_id,OLD.environment,OLD.provider_item_id,OLD.created_at) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 fence:=app.plaid_fence_state(OLD.household_id);
 IF fence='closed' THEN RAISE EXCEPTION 'Household processing is fenced' USING ERRCODE='55000';END IF;
 IF current_user='app_user' THEN
  IF fence<>'open' OR NEW.state<>'unlinking' OR OLD.state NOT IN ('active','login-required','revoked','removal-indeterminate')
   OR NEW.credential_revision<>OLD.credential_revision OR NEW.removal_evidence IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM public.household_users h JOIN public.users u ON u.id=h.user_id WHERE h.household_id=OLD.household_id AND h.user_id=app.current_user_id() AND h.role='owner' AND u.status='active')
   THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  -- Owner unlink preempts any in-flight read: its token can no longer commit.
  NEW.status_changed_at:=clock_timestamp();RETURN NEW;
 END IF;
 SELECT * INTO c FROM public.plaid_local_cursors WHERE id=OLD.id AND household_id=OLD.household_id;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF NEW.credential_revision<>OLD.credential_revision THEN
  -- Envelope rotation: compare-and-swap, exactly +1, never with a state change.
  IF fence<>'open' OR NEW.credential_revision<>OLD.credential_revision+1 OR NEW.state<>OLD.state OR NEW.removal_evidence IS DISTINCT FROM OLD.removal_evidence
   OR OLD.state NOT IN ('active','login-required','revoked') OR c.op_credential_revision IS DISTINCT FROM OLD.credential_revision OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'rotate')
   THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  PERFORM app.assert_plaid_binding(OLD.household_id,OLD.id);
  RETURN NEW;
 END IF;
 IF NEW.state=OLD.state AND NEW.removal_evidence IS NOT DISTINCT FROM OLD.removal_evidence THEN RETURN NEW;END IF;
 IF OLD.state IN ('active','login-required','revoked') AND NEW.state IN ('active','login-required','revoked') AND NEW.removal_evidence IS NULL THEN
  -- Status projection only from a current, owner-bound read of the provider.
  IF fence<>'open' OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'sync') OR c.op_credential_revision IS DISTINCT FROM OLD.credential_revision THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  PERFORM app.assert_plaid_binding(OLD.household_id,OLD.id);
 ELSIF OLD.state IN ('active','login-required','revoked') AND NEW.state='unlinking' THEN
  -- Deletion fence implies unlink: the runtime may begin erasure-direction removal only.
  IF fence<>'fenced' OR NEW.removal_evidence IS NOT NULL OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'remove') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 ELSIF OLD.state='unlinking' AND NEW.state='removed' THEN
  IF NEW.removal_evidence IS NULL OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'remove') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 ELSIF OLD.state='unlinking' AND NEW.state='removal-indeterminate' THEN
  -- Either the held attempt reports an unknown outcome, or its lease already expired.
  IF NEW.removal_evidence IS NOT NULL OR NOT (app.plaid_op_held(OLD.household_id,OLD.id,'remove') OR (c.op='remove' AND c.op_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 ELSIF OLD.state='removal-indeterminate' AND NEW.state='removed' THEN
  -- Reconciliation may only establish absence; it never claims an acknowledgement.
  IF NEW.removal_evidence IS DISTINCT FROM 'provider-invalid' OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'reconcile') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 ELSE RAISE EXCEPTION 'Local financial operation refused';
 END IF;
 NEW.status_changed_at:=clock_timestamp();
 RETURN NEW;
END $$;

-- Cursor/lease row: claims, releases and the atomic sync commit.
CREATE FUNCTION app.guard_plaid_cursor() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE fence text;i record;held boolean;st text;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.household_id<>OLD.household_id THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 fence:=app.plaid_fence_state(OLD.household_id);
 IF fence='closed' THEN RAISE EXCEPTION 'Household processing is fenced' USING ERRCODE='55000';END IF;
 NEW.updated_at:=clock_timestamp();
 IF current_user='app_user' THEN
  -- Reconnect request: owner asks for a fresh provider read (idempotent touch; the bumped
  -- timestamp keeps a request made during an in-flight read). Nothing else is writable.
  SELECT state INTO st FROM public.plaid_local_items WHERE id=OLD.id AND household_id=OLD.household_id;
  IF fence<>'open' OR NOT NEW.refresh_requested OR st IS NULL OR st NOT IN ('active','login-required','revoked')
   OR NOT EXISTS(SELECT 1 FROM public.household_users h JOIN public.users u ON u.id=h.user_id WHERE h.household_id=OLD.household_id AND h.user_id=app.current_user_id() AND h.role='owner' AND u.status='active')
   THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO i FROM public.plaid_local_items WHERE id=OLD.id AND household_id=OLD.household_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF NEW.op IS NOT NULL AND (OLD.op IS NULL OR NEW.op_token IS DISTINCT FROM OLD.op_token) THEN
  -- Claim. Tokens are new; DB time sets the lease; revisions are captured, not supplied.
  IF NEW.op_token IS NULL OR NEW.cursor IS DISTINCT FROM OLD.cursor OR NEW.revision<>OLD.revision OR NEW.last_outcome<>OLD.last_outcome THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  IF NEW.op='sync' THEN
   IF fence<>'open' OR i.state NOT IN ('active','login-required','revoked') OR (OLD.op IS NOT NULL AND NOT (OLD.op='sync' AND OLD.op_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   PERFORM app.assert_plaid_binding(OLD.household_id,OLD.id);
  ELSIF NEW.op='rotate' THEN
   IF fence<>'open' OR i.state NOT IN ('active','login-required','revoked') OR (OLD.op IS NOT NULL AND NOT (OLD.op IN ('sync','rotate') AND OLD.op_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   PERFORM app.assert_plaid_binding(OLD.household_id,OLD.id);
  ELSIF NEW.op='remove' THEN
   -- Removal preempts reads/rotation, never another removal or reconciliation attempt.
   IF NOT (i.state='unlinking' OR (fence='fenced' AND i.state IN ('active','login-required','revoked'))) OR OLD.op IN ('remove','reconcile') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  ELSIF NEW.op='reconcile' THEN
   IF i.state<>'removal-indeterminate' OR (OLD.op IS NOT NULL AND NOT (OLD.op='reconcile' AND OLD.op_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  ELSE RAISE EXCEPTION 'Local financial operation refused';
  END IF;
  NEW.refresh_requested:=OLD.refresh_requested;
  NEW.op_until:=clock_timestamp()+interval '60 seconds';NEW.op_credential_revision:=i.credential_revision;NEW.op_cursor_revision:=OLD.revision;NEW.op_watermark:=clock_timestamp();
  RETURN NEW;
 END IF;
 IF NEW.op IS NULL AND OLD.op IS NOT NULL THEN
  held:=OLD.op_until>clock_timestamp() AND OLD.op_token::text=current_setting('request.plaid_op',true);
  NEW.op_until:=NULL;NEW.op_credential_revision:=NULL;NEW.op_cursor_revision:=NULL;NEW.op_watermark:=NULL;
  IF NEW.cursor IS DISTINCT FROM OLD.cursor OR NEW.revision<>OLD.revision THEN
   -- Atomic sync commit: exactly the claimed cursor revision, current credential, open household.
   IF NOT held OR OLD.op<>'sync' OR fence<>'open' OR NEW.revision<>OLD.revision+1 OR OLD.op_cursor_revision<>OLD.revision
    OR OLD.op_credential_revision<>i.credential_revision OR i.state NOT IN ('active','login-required','revoked') OR NEW.cursor IS NULL OR NEW.last_outcome<>'synced'
    THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   PERFORM app.assert_plaid_binding(OLD.household_id,OLD.id);
   NEW.refresh_requested:=EXISTS(SELECT 1 FROM public.plaid_local_webhooks w WHERE w.item_id=OLD.id AND w.household_id=OLD.household_id AND w.state='pending') OR (OLD.refresh_requested AND OLD.updated_at>OLD.op_watermark);
   RETURN NEW;
  END IF;
  NEW.refresh_requested:=OLD.refresh_requested;
  IF held THEN
   IF (OLD.op='sync' AND NEW.last_outcome NOT IN ('login-required','revoked','unavailable','exhausted'))
    OR (OLD.op='rotate' AND NEW.last_outcome NOT IN ('rotated',OLD.last_outcome))
    OR (OLD.op='remove' AND NEW.last_outcome NOT IN ('removed','removal-indeterminate'))
    OR (OLD.op='reconcile' AND NEW.last_outcome NOT IN ('removed','still-present')) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
   IF OLD.op='sync' THEN NEW.refresh_requested:=EXISTS(SELECT 1 FROM public.plaid_local_webhooks w WHERE w.item_id=OLD.id AND w.household_id=OLD.household_id AND w.state='pending' AND w.received_at>OLD.op_watermark) OR (OLD.refresh_requested AND OLD.updated_at>OLD.op_watermark) OR NEW.last_outcome IN ('unavailable','exhausted');END IF;
   RETURN NEW;
  END IF;
  -- Expired lease cleanup records nothing new, except that an expired removal is unknown.
  IF OLD.op_until>clock_timestamp() THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  IF (OLD.op='remove' AND (NEW.last_outcome<>'removal-indeterminate' OR i.state<>'removal-indeterminate')) OR (OLD.op<>'remove' AND NEW.last_outcome<>OLD.last_outcome) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  RETURN NEW;
 END IF;
 -- No lease transition: only a verified webhook may request a refresh.
 IF (NEW.op,NEW.op_token,NEW.cursor,NEW.revision,NEW.last_outcome) IS DISTINCT FROM (OLD.op,OLD.op_token,OLD.cursor,OLD.revision,OLD.last_outcome)
  OR NOT NEW.refresh_requested OR fence<>'open' OR i.state NOT IN ('active','login-required','revoked') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 NEW.op_until:=OLD.op_until;NEW.op_credential_revision:=OLD.op_credential_revision;NEW.op_cursor_revision:=OLD.op_cursor_revision;NEW.op_watermark:=OLD.op_watermark;
 RETURN NEW;
END $$;

CREATE FUNCTION app.guard_plaid_webhook() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE i record;c record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF current_user<>'app_plaid_sandbox' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('plaid-local:'||NEW.household_id::text,0));
 SELECT * INTO i FROM public.plaid_local_items WHERE id=NEW.item_id AND household_id=NEW.household_id;
 IF i.id IS NULL OR i.state NOT IN ('active','login-required','revoked') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='INSERT' THEN
  IF (SELECT count(*) FROM public.plaid_local_webhooks WHERE item_id=NEW.item_id AND household_id=NEW.household_id AND state='pending')>=32 THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  NEW.state:='pending';NEW.received_at:=clock_timestamp();NEW.applied_at:=NULL;RETURN NEW;
 END IF;
 SELECT * INTO c FROM public.plaid_local_cursors WHERE id=OLD.item_id AND household_id=OLD.household_id;
 IF (NEW.id,NEW.household_id,NEW.item_id,NEW.signal,NEW.body_digest,NEW.received_at) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.item_id,OLD.signal,OLD.body_digest,OLD.received_at)
  OR OLD.state<>'pending' OR NEW.state<>'applied' OR NOT app.plaid_op_held(OLD.household_id,OLD.item_id,'sync') OR OLD.received_at>c.op_watermark THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 NEW.applied_at:=clock_timestamp();RETURN NEW;
END $$;

-- Derived financial rows change only inside a held, current sync lease.
CREATE FUNCTION app.guard_plaid_data() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE r record;i record;c record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN r:=OLD;ELSE r:=NEW;END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.household_id,NEW.item_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.item_id,OLD.created_at) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' AND TG_TABLE_NAME<>'plaid_local_transactions' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 PERFORM app.assert_household_open(r.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('plaid-local:'||r.household_id::text,0));
 SELECT * INTO i FROM public.plaid_local_items WHERE id=r.item_id AND household_id=r.household_id;
 SELECT * INTO c FROM public.plaid_local_cursors WHERE id=r.item_id AND household_id=r.household_id;
 IF i.id IS NULL OR c.id IS NULL OR i.state NOT IN ('active','login-required','revoked') OR NOT app.plaid_op_held(r.household_id,r.item_id,'sync')
  OR c.op_credential_revision<>i.credential_revision OR c.op_cursor_revision<>c.revision THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='plaid_local_accounts' THEN
   IF NEW.provider_account_id<>OLD.provider_account_id THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  ELSE
   IF NEW.provider_transaction_id<>OLD.provider_transaction_id THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' THEN NEW.created_at:=clock_timestamp();END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;

-- Custody rotation and destruction. Local deletion is never provider deletion evidence.
CREATE FUNCTION app.guard_plaid_custody_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE i record;fence text;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 fence:=app.plaid_fence_state(OLD.household_id);
 SELECT * INTO i FROM public.plaid_local_items WHERE id=OLD.id AND household_id=OLD.household_id;
 IF i.id IS NULL OR fence='closed' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN
  IF i.state<>'removed' OR NOT (app.plaid_op_held(OLD.household_id,OLD.id,'remove') OR app.plaid_op_held(OLD.household_id,OLD.id,'reconcile')) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  RETURN OLD;
 END IF;
 IF NEW.id<>OLD.id OR NEW.household_id<>OLD.household_id OR NEW.version<>1 OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
  OR i.credential_revision<>NEW.revision OR fence<>'open' OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'rotate') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.audit_plaid_custody_destroyed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 INSERT INTO public.audit_log(household_id,actor_type,action,target_type,target_id) VALUES(OLD.household_id,'system'::public."ActorType",'plaid_local_credentials.delete','plaid_local_credentials',OLD.id);
 RETURN OLD;
END $$;

-- Commit-time completeness: intents for owner requests, custody state after removal,
-- revision agreement after rotation, and a closed event for each committed sync.
CREATE FUNCTION app.check_plaid_lifecycle_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE i record;k record;item uuid;hh uuid;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN NULL;END IF;
 IF TG_OP='DELETE' THEN item:=OLD.id;hh:=OLD.household_id;ELSE item:=NEW.id;hh:=NEW.household_id;END IF;
 IF current_user='app_user' THEN
  -- Owner requests commit only with their exact closed intent written in this transaction.
  IF NOT EXISTS(SELECT 1 FROM public.outbox_events WHERE household_id=hh AND aggregate_type='plaid-local-item' AND aggregate_id=item AND payload='{"version":1}'::jsonb AND created_at>=now()
    AND event_type=CASE TG_TABLE_NAME WHEN 'plaid_local_items' THEN 'plaid.local_unlink_requested' ELSE 'plaid.local_reconnect_requested' END) THEN
   RAISE EXCEPTION 'Local financial intent missing';END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO i FROM public.plaid_local_items WHERE id=item AND household_id=hh;
 SELECT * INTO k FROM public.plaid_local_credentials WHERE id=item AND household_id=hh;
 -- Custody is destroyed exactly when removal evidence exists, and tracks rotation revision.
 IF i.state='removed' AND k.id IS NOT NULL THEN RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 IF i.state<>'removed' AND (k.id IS NULL OR k.revision<>i.credential_revision) THEN RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 IF TG_TABLE_NAME='plaid_local_cursors' THEN
  IF NEW.revision<>OLD.revision AND NOT EXISTS(SELECT 1 FROM public.outbox_events WHERE household_id=hh
    AND event_type='plaid.local_sync_committed' AND aggregate_type='plaid-local-item' AND aggregate_id=item AND payload=jsonb_build_object('version',1,'revision',NEW.revision)) THEN
   RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 END IF;
 RETURN NULL;
END $$;

-- Runtime-owned effects: the existing activation clause is preserved exactly; new events are
-- closed, content-free and bound to an Item of the same household in the matching state.
DROP POLICY plaid_outbox_only ON outbox_events;
CREATE POLICY plaid_outbox_only ON outbox_events AS RESTRICTIVE FOR ALL TO app_plaid_sandbox
 USING(event_type IN ('plaid.local_exchange_requested','plaid.local_item_activated','plaid.local_sync_committed','plaid.local_item_status_changed','plaid.local_item_removed'))
 WITH CHECK((event_type='plaid.local_item_activated' AND aggregate_type='plaid-local-item' AND payload->'version'='1'::jsonb AND (payload-'version'-'operation_id')='{}'::jsonb AND EXISTS(SELECT 1 FROM plaid_local_exchanges e JOIN plaid_local_items i ON i.exchange_id=e.id AND i.household_id=e.household_id WHERE e.household_id=outbox_events.household_id AND e.id::text=payload->>'operation_id' AND e.state='completed' AND i.state='active' AND i.id=outbox_events.aggregate_id))
  OR (event_type='plaid.local_sync_committed' AND aggregate_type='plaid-local-item' AND payload->'version'='1'::jsonb AND jsonb_typeof(payload->'revision')='number' AND (payload-'version'-'revision')='{}'::jsonb
   AND EXISTS(SELECT 1 FROM plaid_local_cursors c WHERE c.household_id=outbox_events.household_id AND c.id=outbox_events.aggregate_id AND c.op='sync'
    AND c.op_until>clock_timestamp() AND c.op_token::text=current_setting('request.plaid_op',true) AND (payload->>'revision')::bigint=c.revision+1))
  OR (event_type IN ('plaid.local_item_status_changed','plaid.local_item_removed') AND aggregate_type='plaid-local-item' AND payload='{"version":1}'::jsonb
   AND EXISTS(SELECT 1 FROM plaid_local_items i WHERE i.household_id=outbox_events.household_id AND i.id=outbox_events.aggregate_id AND (i.state='removed')=(event_type='plaid.local_item_removed'))));
DROP POLICY plaid_audit_only ON audit_log;
CREATE POLICY plaid_audit_only ON audit_log AS RESTRICTIVE FOR INSERT TO app_plaid_sandbox
 WITH CHECK(action ~ '^plaid_local_(exchanges|items|credentials|item_routes|cursors|webhooks)\.(insert|update|delete)$' AND target_type IN ('plaid_local_exchanges','plaid_local_items','plaid_local_credentials','plaid_local_item_routes','plaid_local_cursors','plaid_local_webhooks'));
-- Fenced households: only audit rows for erasure-direction Item/cursor/custody changes.
CREATE OR REPLACE FUNCTION app.guard_plaid_effect() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 IF current_user<>'app_plaid_sandbox' THEN RETURN NEW;END IF;
 -- Separate statements: outbox rows have no target_type column to reference.
 IF TG_TABLE_NAME='audit_log' THEN
  IF NEW.target_type IN ('plaid_local_items','plaid_local_cursors','plaid_local_credentials') AND NEW.household_id IS NOT NULL THEN
   IF app.plaid_fence_state(NEW.household_id)='closed' THEN RAISE EXCEPTION 'Household processing is fenced' USING ERRCODE='55000';END IF;
   RETURN NEW;
  END IF;
 END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 RETURN NEW;
END $$;

-- Existing insert-time guards/commit checks stay unchanged but no longer see later updates.
DROP TRIGGER privacy_write_fence ON plaid_local_items;
CREATE TRIGGER privacy_write_fence BEFORE INSERT ON plaid_local_items FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_local();
DROP TRIGGER privacy_write_fence ON plaid_local_credentials;
CREATE TRIGGER privacy_write_fence BEFORE INSERT ON plaid_local_credentials FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_local();
DROP TRIGGER plaid_commit ON plaid_local_items;
CREATE CONSTRAINT TRIGGER plaid_commit AFTER INSERT ON plaid_local_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_local_commit();
DROP TRIGGER plaid_commit ON plaid_local_credentials;
CREATE CONSTRAINT TRIGGER plaid_commit AFTER INSERT ON plaid_local_credentials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_local_commit();
CREATE TRIGGER plaid_lifecycle_fence BEFORE UPDATE OR DELETE ON plaid_local_items FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_item_lifecycle();
CREATE TRIGGER plaid_lifecycle_fence BEFORE UPDATE OR DELETE ON plaid_local_credentials FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_custody_lifecycle();
CREATE TRIGGER plaid_custody_destroyed AFTER DELETE ON plaid_local_credentials FOR EACH ROW EXECUTE FUNCTION app.audit_plaid_custody_destroyed();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON plaid_local_item_routes FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_index();
CREATE TRIGGER plaid_index_fence BEFORE INSERT ON plaid_local_cursors FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_index();
CREATE TRIGGER privacy_write_fence BEFORE UPDATE OR DELETE ON plaid_local_cursors FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_cursor();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON plaid_local_webhooks FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_webhook();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON plaid_local_accounts FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_data();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON plaid_local_transactions FOR EACH ROW EXECUTE FUNCTION app.guard_plaid_data();
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['plaid_local_item_routes','plaid_local_cursors','plaid_local_webhooks'] LOOP
 EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
END LOOP;END $$;
CREATE CONSTRAINT TRIGGER plaid_lifecycle_commit AFTER UPDATE ON plaid_local_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_lifecycle_commit();
CREATE CONSTRAINT TRIGGER plaid_lifecycle_commit AFTER UPDATE ON plaid_local_cursors DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_lifecycle_commit();
CREATE CONSTRAINT TRIGGER plaid_lifecycle_commit AFTER UPDATE OR DELETE ON plaid_local_credentials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_plaid_lifecycle_commit();
REVOKE ALL ON FUNCTION app.plaid_fence_state(uuid),app.assert_plaid_binding(uuid,uuid),app.plaid_op_held(uuid,uuid,text),app.index_plaid_item(),app.guard_plaid_index(),
 app.guard_plaid_item_lifecycle(),app.guard_plaid_cursor(),app.guard_plaid_webhook(),app.guard_plaid_data(),app.guard_plaid_custody_lifecycle(),
 app.audit_plaid_custody_destroyed(),app.check_plaid_lifecycle_commit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.plaid_fence_state(uuid) TO app_user,app_plaid_sandbox;
GRANT EXECUTE ON FUNCTION app.assert_plaid_binding(uuid,uuid),app.plaid_op_held(uuid,uuid,text) TO app_plaid_sandbox;

ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK((inventory_source IS NULL AND source_key IS NULL) OR (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','stripe-bindings','stripe-states','stripe-intents','stripe-notices','export-artifacts','auth-challenges','custodies','processing','results','result-reviews','plaid-subjects','plaid-exchanges','plaid-items','plaid-credentials','plaid-routes','plaid-cursors','plaid-webhooks','plaid-accounts','plaid-transactions') AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
