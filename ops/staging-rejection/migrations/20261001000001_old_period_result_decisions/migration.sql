-- PRD §21.3 (founder decision, September 24 2026): a result produced under a valid
-- reservation in a previous entitlement month is never reprocessed and never silently
-- charged to the closed month or to the current month. It stays held (action required)
-- until the owner records an explicit, immutable decision for that exact work:
--   apply-current-period: reviewed completion in the CURRENT month, consuming exactly one
--     current-month slot if capacity permits (the reviewed-completion guard enforces it);
--   discard: the work is cancelled and never charged; the original upload is kept.
-- The result row (source hash, scan attempt, parser/redactor versions, citation, original
-- period/tier/revision) is immutable and is referenced, never copied or rewritten.
-- Empty journal; bounded locks (5s/60s); no row rewrite. Rollback: unmount the routes,
-- then drop the journal only while empty; completed work keeps its charge evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE TABLE document_period_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL,
 processing_id uuid NOT NULL UNIQUE, result_id uuid NOT NULL UNIQUE, owner_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('apply-current-period','discard')),
 from_period_start timestamptz NOT NULL, to_period_start timestamptz,
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,household_id),
 CHECK((decision='apply-current-period')=(to_period_start IS NOT NULL)),
 CHECK(to_period_start IS NULL OR to_period_start>from_period_start),
 FOREIGN KEY(processing_id,household_id) REFERENCES document_processing(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(result_id,household_id) REFERENCES document_results(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX period_decisions_household ON document_period_decisions(household_id,decided_at,id);
ALTER TABLE document_period_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_period_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY household_scope ON document_period_decisions FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household());
REVOKE ALL ON document_period_decisions FROM PUBLIC,app_user,app_document_worker,app_retention_worker,app_deletion_verifier,app_job_worker,app_dispatcher,app_billing_test,app_plaid_sandbox;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON document_period_decisions FROM %I',r); END IF; END LOOP; END $$;
GRANT SELECT, INSERT(household_id,processing_id,result_id,owner_id,decision) ON document_period_decisions TO app_user;
GRANT SELECT(id,household_id) ON document_period_decisions TO app_retention_worker,app_deletion_verifier;
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON document_period_decisions FOR EACH ROW EXECUTE FUNCTION app.guard_household_write();
CREATE TRIGGER security_journal_audit AFTER INSERT ON document_period_decisions FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();

CREATE FUNCTION app.guard_period_decision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE actor uuid:=app.current_user_id(); r record; w record; start_at timestamptz;
BEGIN
 -- Fixture/migration administrator is outside the application authority boundary.
 IF current_user<>'app_user' THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Period decisions are immutable' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR NEW.owner_id IS DISTINCT FROM actor OR NOT EXISTS(SELECT 1 FROM household_users hu JOIN users u ON u.id=hu.user_id
   WHERE hu.household_id=NEW.household_id AND hu.user_id=actor AND hu.role='owner' AND u.status='active')
  THEN RAISE EXCEPTION 'Period decision refused' USING ERRCODE='42501'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 -- Same serialization point as reservation, completion and cancellation.
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT * INTO r FROM document_results WHERE id=NEW.result_id AND household_id=NEW.household_id;
 SELECT * INTO w FROM document_processing WHERE id=NEW.processing_id AND household_id=NEW.household_id;
 -- Only finished-but-unfiled work: the immutable result exists, belongs to this exact work and
 -- to that work's own reservation period, and nothing has been charged yet.
 IF r.id IS NULL OR w.id IS NULL OR r.processing_id IS DISTINCT FROM w.id OR w.state NOT IN ('started','indeterminate')
  OR w.result_ref IS NOT NULL OR w.charged_at IS NOT NULL OR r.period_start IS DISTINCT FROM w.period_start
  THEN RAISE EXCEPTION 'Period decision refused' USING ERRCODE='55000'; END IF;
 start_at:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 NEW.from_period_start:=w.period_start; NEW.decided_at:=clock_timestamp();
 IF NEW.decision='apply-current-period' THEN
  IF w.period_start>=start_at THEN RAISE EXCEPTION 'Result already belongs to the current month' USING ERRCODE='55000'; END IF;
  NEW.to_period_start:=start_at;
 ELSE
  NEW.to_period_start:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER period_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON document_period_decisions FOR EACH ROW EXECUTE FUNCTION app.guard_period_decision();
REVOKE ALL ON FUNCTION app.guard_period_decision() FROM PUBLIC;

-- Reviewed completion: an old-period result completes only IN THE CURRENT MONTH and only with
-- the owner's recorded apply decision for this exact work and result. The slot check counts
-- the current month. A discard decision admits exactly started|indeterminate -> cancelled.
CREATE OR REPLACE FUNCTION app.guard_reviewed_processing() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp' AS $function$
DECLARE r record; p record; rev integer; n bigint; d record; target_start timestamptz; target_end timestamptz;
BEGIN
 IF current_user NOT IN ('app_user','app_document_worker') THEN RETURN NEW; END IF;
 IF current_user='app_document_worker' AND NEW.state<>'completed' THEN RETURN NEW; END IF;
 IF current_user='app_user' AND OLD.state='waiting' AND NEW.state='cancelled' AND OLD.lease_token IS NULL
  AND (to_jsonb(NEW)-'state'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') THEN RETURN NEW; END IF;
 IF current_user='app_user' AND NEW.state='cancelled' AND OLD.state IN ('started','indeterminate') AND OLD.result_ref IS NULL
  AND (to_jsonb(NEW)-'state'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') THEN
  IF NOT EXISTS(SELECT 1 FROM document_period_decisions x WHERE x.processing_id=OLD.id AND x.household_id=OLD.household_id
    AND x.decision='discard' AND x.owner_id=app.current_user_id())
   THEN RAISE EXCEPTION 'Reviewed completion required' USING ERRCODE='55000'; END IF;
  PERFORM app.assert_household_open(NEW.household_id);
  NEW.updated_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF NEW.state<>'completed' OR OLD.state NOT IN ('started','indeterminate') THEN RAISE EXCEPTION 'Reviewed completion required' USING ERRCODE='55000'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT a.* INTO r FROM document_results a JOIN document_result_reviews v ON v.result_id=a.id AND v.household_id=a.household_id
  JOIN household_users u ON u.household_id=v.household_id AND u.user_id=v.owner_id AND u.role='owner'
  WHERE a.id=NEW.result_ref AND a.household_id=NEW.household_id AND a.processing_id=OLD.id
   AND (current_user='app_document_worker' OR u.user_id=app.current_user_id());
 -- A suspended or deletion-pending owner cannot complete (charge) anything. Separate,
 -- nested statement: the document worker holds no grant on users, and privileges are
 -- checked for every table a statement names, even in a branch that never runs.
 IF current_user='app_user' THEN
  IF NOT EXISTS(SELECT 1 FROM users uu WHERE uu.id=app.current_user_id() AND uu.status='active') THEN
   RAISE EXCEPTION 'Reviewed result authority unavailable' USING ERRCODE='55000'; END IF;
 END IF;
 SELECT * INTO p FROM effective_plan WHERE household_id=NEW.household_id;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=NEW.household_id;
 target_start:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 target_end:=((target_start AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC';
 IF OLD.period_start IS DISTINCT FROM target_start THEN
  SELECT * INTO d FROM document_period_decisions x WHERE x.processing_id=OLD.id AND x.household_id=NEW.household_id
   AND x.result_id=NEW.result_ref AND x.decision='apply-current-period' AND x.from_period_start=OLD.period_start
   AND x.to_period_start=target_start AND current_user='app_user' AND x.owner_id=app.current_user_id();
  IF d.id IS NULL THEN RAISE EXCEPTION 'Reviewed result authority unavailable' USING ERRCODE='55000'; END IF;
 END IF;
 SELECT count(*) INTO n FROM document_processing WHERE household_id=NEW.household_id AND id<>OLD.id AND period_start=target_start AND state IN ('reserved','started','indeterminate','completed');
 IF r.id IS NULL OR r.period_start IS DISTINCT FROM OLD.period_start
  OR clock_timestamp()>=target_end OR p.tier IS NULL OR n>=p.documents_per_month
  OR NOT EXISTS(SELECT 1 FROM document_custodies WHERE id=OLD.custody_id AND household_id=NEW.household_id AND state='ready' AND review_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Reviewed result authority unavailable' USING ERRCODE='55000'; END IF;
 IF current_user='app_user' THEN
  NEW.period_start:=target_start; NEW.period_end:=target_end;
  NEW.tier:=p.tier; NEW.catalog_version:=p.version; NEW.entitlement_revision:=rev; NEW.limit_snapshot:=p.documents_per_month;
  NEW.lease_until:=least(clock_timestamp()+interval '90 seconds',target_end); NEW.charged_at:=clock_timestamp(); NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $function$;

-- Owner cancellation also admits the owner's recorded discard of finished-but-unfiled work.
CREATE OR REPLACE FUNCTION app.guard_owner_document_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE actor uuid:=app.current_user_id();
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 -- Reviewed completion is app_user's other processing transition; guard_reviewed_processing
 -- owns it. Custody had no app_user write path before 20260930000003.
 IF TG_TABLE_NAME='document_processing' AND NEW.state IS DISTINCT FROM 'cancelled' THEN RETURN NEW; END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM household_users hu JOIN users u ON u.id=hu.user_id
   WHERE hu.household_id=NEW.household_id AND hu.user_id=actor AND hu.role IN ('owner','member') AND u.status='active')
  THEN RAISE EXCEPTION 'Document cancellation refused' USING ERRCODE='42501'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 -- Same serialization point as reservation: a claim and a cancellation cannot interleave.
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 IF TG_TABLE_NAME='document_processing' THEN
  IF (to_jsonb(NEW)-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') OR NEW.state<>'cancelled'
    OR NOT ((OLD.state='waiting' AND OLD.lease_token IS NULL)
     OR (OLD.state IN ('started','indeterminate') AND OLD.result_ref IS NULL AND EXISTS(SELECT 1 FROM document_period_decisions x
       WHERE x.processing_id=OLD.id AND x.household_id=OLD.household_id AND x.decision='discard' AND x.owner_id=actor)))
   THEN RAISE EXCEPTION 'Document work has started and cannot be cancelled' USING ERRCODE='55000'; END IF;
  NEW.updated_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')
    OR OLD.state NOT IN ('copying','ready','held') OR NEW.state<>'cancelled'
    OR EXISTS(SELECT 1 FROM document_processing w WHERE w.custody_id=OLD.id AND w.household_id=OLD.household_id
     AND w.state NOT IN ('cancelled','failed'))
   THEN RAISE EXCEPTION 'Document work has started and cannot be cancelled' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- The decision journal is household data: the deletion inventory must be able to name it.
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK((inventory_source IS NULL AND source_key IS NULL) OR (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','stripe-bindings','stripe-states','stripe-intents','stripe-notices','export-artifacts','auth-challenges','custodies','processing','results','result-reviews','period-decisions','plaid-subjects','plaid-exchanges','plaid-items','plaid-credentials','plaid-routes','plaid-cursors','plaid-webhooks','plaid-accounts','plaid-transactions') AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
