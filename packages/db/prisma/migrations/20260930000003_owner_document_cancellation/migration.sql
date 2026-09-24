-- Owner/member cancellation of document work that has NOT been reserved or started.
-- A reservation holds a worker lease and may already be calling the processing
-- provider; cancelling custody under it would strand a result that can never commit
-- (and could be charged ambiguously), so the database refuses it rather than trusting
-- the client. Cancellation stops new claims only: bytes, custody accounting and
-- journals are kept (no deletion, no capacity release, no retry) exactly like the
-- existing internal cancellation. Grants/trigger only; no row rewrite; tables are
-- bounded per household (20 custody rows). 5s lock / 60s statement. Rollback: revoke
-- the two column grants and drop the trigger; cancelled rows stay cancelled.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
GRANT UPDATE(state) ON document_custodies,document_processing TO app_user;
CREATE FUNCTION app.guard_owner_document_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE actor uuid:=app.current_user_id();
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 -- Reviewed completion is app_user's other processing transition; guard_reviewed_processing
 -- owns it. Custody had no app_user write path before this migration.
 IF TG_TABLE_NAME='document_processing' AND NEW.state IS DISTINCT FROM 'cancelled' THEN RETURN NEW; END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM household_users hu JOIN users u ON u.id=hu.user_id
   WHERE hu.household_id=NEW.household_id AND hu.user_id=actor AND hu.role IN ('owner','member') AND u.status='active')
  THEN RAISE EXCEPTION 'Document cancellation refused' USING ERRCODE='42501'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 -- Same serialization point as reservation: a claim and a cancellation cannot interleave.
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 IF TG_TABLE_NAME='document_processing' THEN
  IF (to_jsonb(NEW)-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at')
    OR OLD.state<>'waiting' OR NEW.state<>'cancelled' OR OLD.lease_token IS NOT NULL
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
-- The reviewed-completion guard refused every app_user transition except completion.
-- It now also admits waiting->cancelled, which owner_cancel_guard (alphabetically
-- earlier, so it has already run and raised if invalid) validated; the condition is
-- re-stated here so the admission does not depend on trigger order alone.
CREATE OR REPLACE FUNCTION app.guard_reviewed_processing() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp' AS $function$
DECLARE r record; p record; rev integer; n bigint;
BEGIN
 IF current_user NOT IN ('app_user','app_document_worker') THEN RETURN NEW; END IF;
 IF current_user='app_document_worker' AND NEW.state<>'completed' THEN RETURN NEW; END IF;
 IF current_user='app_user' AND OLD.state='waiting' AND NEW.state='cancelled' AND OLD.lease_token IS NULL
  AND (to_jsonb(NEW)-'state'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') THEN RETURN NEW; END IF;
 IF NEW.state<>'completed' OR OLD.state NOT IN ('started','indeterminate') THEN RAISE EXCEPTION 'Reviewed completion required' USING ERRCODE='55000'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT a.* INTO r FROM document_results a JOIN document_result_reviews v ON v.result_id=a.id AND v.household_id=a.household_id
  JOIN household_users u ON u.household_id=v.household_id AND u.user_id=v.owner_id AND u.role='owner'
  WHERE a.id=NEW.result_ref AND a.household_id=NEW.household_id AND a.processing_id=OLD.id
   AND (current_user='app_document_worker' OR u.user_id=app.current_user_id());
 SELECT * INTO p FROM effective_plan WHERE household_id=NEW.household_id;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=NEW.household_id;
 SELECT count(*) INTO n FROM document_processing WHERE household_id=NEW.household_id AND id<>OLD.id AND period_start=OLD.period_start AND state IN ('reserved','started','indeterminate','completed');
 IF r.id IS NULL OR r.period_start IS DISTINCT FROM OLD.period_start OR OLD.period_start IS DISTINCT FROM (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  OR clock_timestamp()>=OLD.period_end OR p.tier IS NULL OR n>=p.documents_per_month
  OR NOT EXISTS(SELECT 1 FROM document_custodies WHERE id=OLD.custody_id AND household_id=NEW.household_id AND state='ready' AND review_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Reviewed result authority unavailable' USING ERRCODE='55000'; END IF;
 IF current_user='app_user' THEN
  NEW.tier:=p.tier; NEW.catalog_version:=p.version; NEW.entitlement_revision:=rev; NEW.limit_snapshot:=p.documents_per_month;
  NEW.lease_until:=least(clock_timestamp()+interval '90 seconds',OLD.period_end); NEW.charged_at:=clock_timestamp(); NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER owner_cancel_guard BEFORE UPDATE ON document_custodies FOR EACH ROW EXECUTE FUNCTION app.guard_owner_document_cancel();
CREATE TRIGGER owner_cancel_guard BEFORE UPDATE ON document_processing FOR EACH ROW EXECUTE FUNCTION app.guard_owner_document_cancel();
COMMIT;
