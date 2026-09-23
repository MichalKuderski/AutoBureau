BEGIN;
-- ADR-018 LOCAL online erasure only. No identity, provider, audit, outbox,
-- delivery, inbox or scan-history DELETE grant. Those scopes remain retained and
-- block final receipts until replay horizons and independent evidence are proven.
-- Catalog/function locks only; no heap rewrite or scan at 100k households.
-- Row deletion is bounded in application batches, serialized with the privacy fence.
-- Rollback: stop invocation, revoke these DELETE grants, restore prior guard body.
-- Deleted synthetic data is not restored; journals/fences must never be rolled back.
GRANT SELECT(id,household_id) ON documents,document_chunks,items,obligations,reminders,notifications TO app_retention_worker;
GRANT SELECT(id,item_id) ON item_secrets TO app_retention_worker;
GRANT SELECT(document_id) ON document_uploads TO app_retention_worker;
GRANT SELECT(id,notification_id) ON notification_deliveries TO app_retention_worker,app_deletion_verifier;
GRANT DELETE ON documents,document_uploads,document_chunks,items,item_secrets,obligations,reminders,notifications,notification_deliveries TO app_retention_worker;
CREATE OR REPLACE FUNCTION app.guard_household_write() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE hh uuid; data jsonb;
BEGIN
 -- Fixture/migration administrator is outside the application authority boundary.
 IF current_user NOT IN ('app_user','app_dispatcher','app_job_worker','app_document_worker','app_retention_worker','app_deletion_verifier') THEN RETURN COALESCE(NEW,OLD); END IF;
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
   WHERE d.household_id=hh AND d.state='verifying' AND d.settle_until<=clock_timestamp()
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

COMMIT;
