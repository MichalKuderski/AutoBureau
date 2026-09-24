-- ADR-022 amendment: account-wide status fence for financial writes. Administrative
-- suspension (or identity deletion) previously did not share any lock with financial
-- publication, so a commit could read 'active' while a suspension was committing.
-- Status/deletion writes on users now take an exclusive per-account advisory lock;
-- financial owner checks take the shared form before reading status. Metadata-only:
-- no row rewrite, 5s lock / 60s statement. Rollback disables callers; dropping the
-- trigger would reopen the race and is not a safe rollback.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE FUNCTION app.lock_account_status() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('account-status:'||OLD.id::text,0));
 RETURN COALESCE(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION app.lock_account_status() FROM PUBLIC;
CREATE TRIGGER account_status_fence BEFORE UPDATE OF status OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION app.lock_account_status();
CREATE OR REPLACE FUNCTION app.assert_plaid_binding(hh uuid,item uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE owner uuid;
BEGIN
 SELECT i.owner_id INTO owner FROM public.plaid_local_items i WHERE i.id=item AND i.household_id=hh;
 IF owner IS NULL THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('account-status:'||owner::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.plaid_local_items i JOIN public.plaid_local_subjects s ON s.id=i.subject_id AND s.household_id=i.household_id AND s.incarnation_id=i.incarnation_id AND s.owner_id=i.owner_id
  JOIN public.household_users h ON h.household_id=i.household_id AND h.user_id=s.owner_id AND h.role='owner' JOIN public.users u ON u.id=h.user_id AND u.status='active'
  WHERE i.id=item AND i.household_id=hh) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
END $$;
CREATE OR REPLACE FUNCTION app.guard_plaid_local() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
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
 -- Shared account-status fence: a concurrent suspension/deletion either commits first
 -- (and is seen below) or waits until this financial write has committed.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('account-status:'||owner::text,0));
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
COMMIT;
