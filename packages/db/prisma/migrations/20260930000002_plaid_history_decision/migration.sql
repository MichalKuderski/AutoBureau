-- ADR-022 product/privacy decision (September 30 local amendment): what happens to
-- imported financial history after disconnect is the owner's explicit choice at unlink,
-- defaulting to deletion (data minimization). Deletion happens in the same transaction
-- that records established provider removal (acknowledged or provider-invalid); an
-- unknown removal outcome keeps history until reconciled. 'retain' keeps it visible
-- under the removed connection until household deletion. Existing Items default to
-- 'delete' (none exist hosted). Metadata-only; 5s lock / 60s statement.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE plaid_local_items ADD COLUMN history_after_removal text NOT NULL DEFAULT 'delete' CHECK(history_after_removal IN ('delete','retain'));
GRANT SELECT(history_after_removal) ON plaid_local_items TO app_user,app_plaid_sandbox;
GRANT UPDATE(history_after_removal) ON plaid_local_items TO app_user;
GRANT DELETE ON plaid_local_accounts TO app_plaid_sandbox;
CREATE OR REPLACE FUNCTION app.guard_plaid_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp'
AS $function$
DECLARE r record;i record;c record;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN r:=OLD;ELSE r:=NEW;END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.household_id,NEW.item_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.item_id,OLD.created_at) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN
  -- Owner-chosen history deletion, only after provider removal is established and only
  -- inside the held removal/reconciliation lease (open or deletion-fenced household).
  SELECT * INTO i FROM public.plaid_local_items WHERE id=r.item_id AND household_id=r.household_id;
  IF i.id IS NOT NULL AND i.state='removed' AND i.history_after_removal='delete' AND app.plaid_fence_state(r.household_id)<>'closed'
   AND (app.plaid_op_held(r.household_id,r.item_id,'remove') OR app.plaid_op_held(r.household_id,r.item_id,'reconcile')) THEN RETURN OLD;END IF;
  IF TG_TABLE_NAME<>'plaid_local_transactions' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 END IF;
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
END $function$;
CREATE OR REPLACE FUNCTION app.guard_plaid_item_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp'
AS $function$
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
 -- The history choice belongs to the owner's unlink request; the runtime never changes it.
 IF NEW.history_after_removal IS DISTINCT FROM OLD.history_after_removal THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
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
END $function$;
CREATE OR REPLACE FUNCTION app.check_plaid_lifecycle_commit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp'
AS $function$
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
 -- A 'delete' choice is honoured in the same transaction that records removal.
 IF i.state='removed' AND i.history_after_removal='delete' AND (EXISTS(SELECT 1 FROM public.plaid_local_transactions WHERE item_id=item AND household_id=hh)
  OR EXISTS(SELECT 1 FROM public.plaid_local_accounts WHERE item_id=item AND household_id=hh)) THEN RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 IF TG_TABLE_NAME='plaid_local_cursors' THEN
  IF NEW.revision<>OLD.revision AND NOT EXISTS(SELECT 1 FROM public.outbox_events WHERE household_id=hh
    AND event_type='plaid.local_sync_committed' AND aggregate_type='plaid-local-item' AND aggregate_id=item AND payload=jsonb_build_object('version',1,'revision',NEW.revision)) THEN
   RAISE EXCEPTION 'Local financial commit incomplete';END IF;
 END IF;
 RETURN NULL;
END $function$;
COMMIT;
