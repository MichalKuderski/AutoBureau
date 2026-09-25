-- Household anchor minimization (ADR-019 amendment: retained evidence is content-free).
--
-- Household deletion keeps the household row as the anchor its suppression evidence points at,
-- and that anchor needs only its id. Its name (often a family name) and its inbound email alias
-- are content, and they survived every erasure stage. The retention worker gains exactly one
-- update: replacing the name with the fixed placeholder 'Deleted household' and clearing the
-- alias, bound to the same live, manifest-bound 'account-household' attempt as its deletes, and
-- only once that stage's members, entitlements and idempotency records are gone. Every other
-- column must stay identical, and the worker still holds no SELECT on the content it replaces.
--
-- LOCK IMPACT: one function replacement and one column-level grant; metadata only, no scan or
--   rewrite. TABLE SIZE AT 100k HOUSEHOLDS: unchanged.
-- ROLLBACK: forward-fix. Reverting only stops future minimization; a replaced name is not
--   recoverable by design (the owner's export taken before deletion is their copy).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
GRANT UPDATE (name, email_alias) ON households TO app_retention_worker;
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
 -- Retention may also minimize the household anchor (see the migration header): one UPDATE of
 -- `households`, under the same manifest-bound capability as its deletes.
 IF current_user='app_retention_worker' THEN
  IF NOT (TG_OP='DELETE' OR (TG_OP='UPDATE' AND TG_TABLE_NAME='households'))
   OR hh IS DISTINCT FROM app.current_household() OR NOT EXISTS(
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
    WHEN TG_TABLE_NAME IN ('household_members','entitlements','idempotency_keys','households') THEN 'account-household'
    ELSE NULL END) THEN
   RAISE EXCEPTION 'Manifest-bound erasure required' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN
   -- The anchor keeps its identity and every other column; its name becomes the fixed
   -- placeholder and its alias goes, only once this stage's household records are gone.
   IF (to_jsonb(NEW)-'name'-'email_alias') IS DISTINCT FROM (to_jsonb(OLD)-'name'-'email_alias')
      OR NEW.name IS DISTINCT FROM 'Deleted household' OR NEW.email_alias IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.household_members WHERE household_id=hh)
      OR EXISTS(SELECT 1 FROM public.entitlements WHERE household_id=hh)
      OR EXISTS(SELECT 1 FROM public.idempotency_keys WHERE household_id=hh) THEN
    RAISE EXCEPTION 'Anchor minimization refused' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
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
COMMIT;
