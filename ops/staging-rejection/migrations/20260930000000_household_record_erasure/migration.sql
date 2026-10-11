-- Household-record erasure: members, entitlements and idempotency records (whose stored
-- responses can contain personal data) become manifest-bound erasable by the retention
-- worker under the 'account-household' component, exactly like the existing document,
-- derived-record and notification stages. The household row, memberships, account
-- identity and every protected journal (audit, outbox, processing, results, billing,
-- Plaid, deletion) are NOT erasable here: ADR-019 retains them as suppression evidence.
-- Grants/policy/function only; no row rewrite. 5s lock / 60s statement. Rollback:
-- stop erasure invocation before restoring the prior function; deleted rows cannot
-- be recreated by schema rollback.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION app.guard_household_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'pg_temp'
AS $function$
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
    WHEN TG_TABLE_NAME IN ('household_members','entitlements','idempotency_keys') THEN 'account-household'
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
END $function$;
GRANT SELECT(id,household_id),DELETE ON household_members TO app_retention_worker;
GRANT SELECT(household_id),DELETE ON entitlements TO app_retention_worker;
GRANT SELECT(id,household_id),DELETE ON idempotency_keys TO app_retention_worker;
-- The independent verifier counts what remains; identifiers only, no content columns.
GRANT SELECT(id,household_id) ON household_members,idempotency_keys TO app_deletion_verifier;
GRANT SELECT(household_id) ON entitlements TO app_deletion_verifier;
-- Idempotency rows are otherwise visible only to their own user; erasure is household-scoped.
CREATE POLICY idempotency_retention_select ON idempotency_keys FOR SELECT TO app_retention_worker,app_deletion_verifier USING(household_id=app.current_household());
CREATE POLICY idempotency_retention_erasure ON idempotency_keys FOR DELETE TO app_retention_worker USING(household_id=app.current_household());
COMMIT;
