-- ADR-021 LOCAL ONLY. Empty journals/indexes; no historical usage conversion.
-- Locks bounded 5s/60s. Rollback disables callers and preserves held/charged work.
-- Capacity estimates and unresolved hosted retention policy are in ADR-021.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
-- Historical upload counts cannot establish successful processing. No implicit reset.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM documents) OR EXISTS(SELECT 1 FROM entitlements WHERE docs_used_this_period<>0)
 THEN RAISE EXCEPTION 'Processing cutover requires empty document inventory and zero legacy usage or a reviewed historical accounting migration'; END IF;
END $$;
CREATE TABLE document_custodies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL,
 document_id uuid NOT NULL, scan_id uuid NOT NULL, object_id uuid NOT NULL UNIQUE,
 sha256 bytea NOT NULL CHECK(octet_length(sha256)=32), size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
 state text NOT NULL DEFAULT 'copying' CHECK(state IN ('copying','ready','held','cancelled','absent')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), review_at timestamptz NOT NULL,
 UNIQUE(document_id), UNIQUE(id,household_id), UNIQUE(household_id,sha256),
 FOREIGN KEY(document_id,household_id) REFERENCES documents(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(scan_id,household_id) REFERENCES document_scans(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX custody_household_state ON document_custodies(household_id,state,created_at,id);
CREATE TABLE document_processing (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL,
 custody_id uuid NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','reserved','started','completed','failed','indeterminate','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 period_start timestamptz, period_end timestamptz, tier text, catalog_version integer,
 entitlement_revision integer, limit_snapshot integer,
 lease_token uuid, lease_until timestamptz, result_ref uuid, charged_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(custody_id,household_id) REFERENCES document_custodies(id,household_id) ON DELETE RESTRICT,
 CHECK((state='completed')=(charged_at IS NOT NULL)),
 CHECK((state='completed')=(result_ref IS NOT NULL)),
 CHECK(state NOT IN ('reserved','started','completed','indeterminate') OR
  (period_start IS NOT NULL AND period_end>period_start AND tier IN ('free','premium') AND catalog_version>0
   AND entitlement_revision>=0 AND limit_snapshot>0 AND lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX processing_household_period ON document_processing(household_id,period_start,state);
DO $$ DECLARE t text; r text; BEGIN FOREACH t IN ARRAY ARRAY['document_custodies','document_processing'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY household_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_document_worker,app_retention_worker,app_deletion_verifier,app_job_worker,app_dispatcher,app_billing_test',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF; END LOOP;
 EXECUTE format('GRANT SELECT ON %I TO app_user,app_document_worker',t);
 EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
 EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_household_write()',t);
 EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
END LOOP; END $$;
GRANT INSERT(household_id,document_id,scan_id,object_id,sha256,size_bytes),UPDATE(state) ON document_custodies TO app_document_worker;
GRANT INSERT(household_id,custody_id),UPDATE(state,lease_token,result_ref) ON document_processing TO app_document_worker;
GRANT SELECT ON plan_catalog,local_plan_activation,effective_plan TO app_document_worker;
GRANT SELECT(household_id) ON entitlements TO app_document_worker;
GRANT SELECT(household_id,state,plan,revision,paid_through,premium_until) ON stripe_test_states TO app_document_worker;
GRANT SELECT ON billing_test_eligibility TO app_document_worker;

CREATE FUNCTION app.guard_clean_custody() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE n bigint; bytes bigint;
BEGIN
 IF current_user<>'app_document_worker' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM document_scans s JOIN documents d ON d.id=s.document_id AND d.household_id=s.household_id
   WHERE s.id=NEW.scan_id AND s.household_id=NEW.household_id AND s.document_id=NEW.document_id AND s.state='clean'
   AND s.sha256=NEW.sha256 AND s.size_bytes=NEW.size_bytes AND d.sha256=s.sha256 AND d.size_bytes=s.size_bytes
   AND d.storage_path='hh/'||s.household_id::text||'/upload/'||s.document_id::text||'/sealed/'||s.seal_id::text)
   THEN RAISE EXCEPTION 'Clean custody binding refused' USING ERRCODE='55000'; END IF;
  SELECT count(*),coalesce(sum(size_bytes),0) INTO n,bytes FROM document_custodies WHERE household_id=NEW.household_id AND state<>'absent';
  IF n>=20 OR bytes+NEW.size_bytes>524288000 THEN RAISE EXCEPTION 'Local custody capacity reached' USING ERRCODE='55000'; END IF;
  NEW.state:='copying'; NEW.created_at:=clock_timestamp(); NEW.review_at:=NEW.created_at+interval '35 days';
 ELSE
  IF (NEW.id,NEW.household_id,NEW.document_id,NEW.scan_id,NEW.object_id,NEW.sha256,NEW.size_bytes,NEW.created_at,NEW.review_at)
    IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.document_id,OLD.scan_id,OLD.object_id,OLD.sha256,OLD.size_bytes,OLD.created_at,OLD.review_at)
   THEN RAISE EXCEPTION 'Custody identity is immutable' USING ERRCODE='42501'; END IF;
  IF NOT ((OLD.state='copying' AND NEW.state='ready' AND NEW.review_at>clock_timestamp())
    OR (OLD.state IN ('copying','ready') AND NEW.state='held' AND NEW.review_at<=clock_timestamp())
    OR (OLD.state IN ('copying','ready','held') AND NEW.state='cancelled'))
   THEN RAISE EXCEPTION 'Custody transition refused' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER custody_guard BEFORE INSERT OR UPDATE ON document_custodies FOR EACH ROW EXECUTE FUNCTION app.guard_clean_custody();

CREATE FUNCTION app.guard_processing() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE p record; rev integer; start_at timestamptz; finish_at timestamptz; n bigint; c record;
BEGIN
 IF current_user<>'app_document_worker' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT * INTO c FROM document_custodies WHERE id=NEW.custody_id AND household_id=NEW.household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Custody missing' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.state:='waiting'; NEW.attempts:=0; NEW.created_at:=clock_timestamp(); NEW.updated_at:=NEW.created_at;
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.household_id,NEW.custody_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.custody_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Processing identity immutable' USING ERRCODE='42501'; END IF;
 IF OLD.state IN ('completed','failed','indeterminate','cancelled') THEN RAISE EXCEPTION 'Processing terminal' USING ERRCODE='55000'; END IF;
 NEW.updated_at:=clock_timestamp();
 IF NEW.state='cancelled' AND OLD.state IN ('waiting','reserved') THEN RETURN NEW; END IF;
 IF OLD.state='reserved' AND OLD.lease_until<=clock_timestamp()
  AND NEW.state=(CASE WHEN OLD.attempts>=3 THEN 'failed' ELSE 'waiting' END) THEN
  NEW.lease_token:=NULL; NEW.lease_until:=NULL; RETURN NEW;
 END IF;
 IF NEW.state='indeterminate' AND OLD.state='started' AND OLD.lease_until<=clock_timestamp() THEN RETURN NEW; END IF;
 IF c.state<>'ready' OR c.review_at<=clock_timestamp() THEN RAISE EXCEPTION 'Custody unavailable' USING ERRCODE='55000'; END IF;
 SELECT * INTO p FROM effective_plan WHERE household_id=NEW.household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan missing' USING ERRCODE='55000'; END IF;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=NEW.household_id;
 start_at:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; finish_at:=((start_at AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC';
 IF NEW.state='reserved' AND OLD.state='waiting' AND OLD.attempts<3 THEN
  IF NEW.lease_token IS NULL OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token THEN RAISE EXCEPTION 'Fresh lease required' USING ERRCODE='55000'; END IF;
  SELECT count(*) INTO n FROM document_processing WHERE household_id=NEW.household_id AND period_start=start_at AND state IN ('reserved','started','completed','indeterminate');
  IF n>=p.documents_per_month THEN RAISE EXCEPTION 'Processing allowance reached' USING ERRCODE='55000'; END IF;
  IF clock_timestamp()+interval '90 seconds'>=finish_at THEN RAISE EXCEPTION 'Period settlement window' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM document_processing w JOIN document_custodies wc ON wc.id=w.custody_id AND wc.household_id=w.household_id
    WHERE w.household_id=NEW.household_id AND w.state='waiting' AND w.attempts<3 AND wc.state='ready' AND wc.review_at>clock_timestamp()
    AND (w.created_at,w.id)<(OLD.created_at,OLD.id)) THEN RAISE EXCEPTION 'Earlier waiting work exists' USING ERRCODE='55000'; END IF;
  NEW.period_start:=start_at; NEW.period_end:=finish_at; NEW.tier:=p.tier; NEW.catalog_version:=p.version;
  NEW.entitlement_revision:=rev; NEW.limit_snapshot:=p.documents_per_month; NEW.attempts:=OLD.attempts+1;
  NEW.lease_until:=clock_timestamp()+interval '90 seconds'; RETURN NEW;
 END IF;
 IF OLD.lease_token IS DISTINCT FROM NEW.lease_token OR OLD.lease_until<=clock_timestamp() OR OLD.period_start<>start_at
  OR (OLD.tier,OLD.catalog_version,OLD.entitlement_revision,OLD.limit_snapshot) IS DISTINCT FROM (p.tier,p.version,rev,p.documents_per_month)
  THEN RAISE EXCEPTION 'Processing authority changed or expired' USING ERRCODE='55000'; END IF;
 IF NEW.state='started' AND OLD.state='reserved' THEN RETURN NEW; END IF;
 IF NEW.state='failed' AND OLD.state='started' THEN RETURN NEW; END IF;
 IF NEW.state='completed' AND OLD.state='started' AND NEW.result_ref IS NOT NULL THEN NEW.charged_at:=clock_timestamp(); RETURN NEW; END IF;
 RAISE EXCEPTION 'Processing transition refused' USING ERRCODE='55000';
END $$;
CREATE TRIGGER processing_guard BEFORE INSERT OR UPDATE ON document_processing FOR EACH ROW EXECUTE FUNCTION app.guard_processing();
-- Re-evaluate immediately before commit: no publication after time/plan/fence loss.
CREATE FUNCTION app.check_processing_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE p record; r record; rev integer;
BEGIN
 IF current_user<>'app_document_worker' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM document_processing WHERE id=NEW.id AND household_id=NEW.household_id;
 IF r.state NOT IN ('reserved','started','completed') THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(r.household_id);
 SELECT * INTO p FROM effective_plan WHERE household_id=r.household_id;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=r.household_id;
 IF r.lease_until<=clock_timestamp() OR clock_timestamp()>=r.period_end
  OR (r.tier,r.catalog_version,r.entitlement_revision,r.limit_snapshot) IS DISTINCT FROM (p.tier,p.version,rev,p.documents_per_month)
  OR NOT EXISTS(SELECT 1 FROM document_custodies WHERE id=r.custody_id AND household_id=r.household_id AND state='ready' AND review_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Processing commit authority lost' USING ERRCODE='55000'; END IF;
 IF r.state='completed' AND (SELECT count(*) FROM outbox_events e JOIN document_custodies c ON c.document_id=e.aggregate_id AND c.household_id=e.household_id WHERE c.id=r.custody_id AND c.household_id=r.household_id AND e.event_type='document.processed' AND e.payload=jsonb_build_object('processing_id',r.id::text))<>1 THEN RAISE EXCEPTION 'Processing result intent missing' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER processing_commit AFTER INSERT OR UPDATE ON document_processing DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_processing_commit();
REVOKE ALL ON FUNCTION app.guard_clean_custody(),app.guard_processing(),app.check_processing_commit() FROM PUBLIC;
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices','stripe-states','stripe-intents','export-artifacts','custodies','processing')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
