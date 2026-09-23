BEGIN;
-- ADR-018 local scan budget: measured full-signature cold start ~21s.
-- 40s watchdog + 5s cleanup + 5s load + 40s DB/scheduling margin = 90s.
-- Function metadata lock only; no table rewrite/scan/new grants; size-independent at 100k households.
-- Rollback: disable invocations, drain leases, restore prior function body. Preserve journals.
-- No hosted migration or queue-worker timeout changes are authorized.
CREATE OR REPLACE FUNCTION app.guard_scan_journal() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_document_worker' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='document_scans' THEN
  IF TG_OP='INSERT' THEN
   IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.document_id AND household_id=NEW.household_id
    AND status='scanning' AND size_bytes=NEW.size_bytes AND sha256=NEW.sha256
    AND storage_path='hh/'||NEW.household_id::text||'/upload/'||NEW.document_id::text||'/sealed/'||NEW.seal_id::text) THEN
    RAISE EXCEPTION 'Immutable scan binding refused' USING ERRCODE='55000'; END IF;
   NEW.created_at:=clock_timestamp(); NEW.state:='queued'; NEW.attempts:=0; NEW.lease_token:=NULL; NEW.lease_until:=NULL; NEW.completed_at:=NULL;
  ELSE
   IF (NEW.id,NEW.household_id,NEW.document_id,NEW.seal_id,NEW.sha256,NEW.size_bytes,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.document_id,OLD.seal_id,OLD.sha256,OLD.size_bytes,OLD.created_at) THEN
    RAISE EXCEPTION 'Scan identity is immutable' USING ERRCODE='55000'; END IF;
   IF OLD.state IN ('clean','rejected','exhausted','cancelled','superseded') THEN RAISE EXCEPTION 'Scan is terminal' USING ERRCODE='55000'; END IF;
   IF NEW.state='scanning' THEN
    IF NOT (OLD.state='queued' OR (OLD.state='scanning' AND OLD.lease_until<=clock_timestamp()))
      OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_token IS NULL OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token THEN
      RAISE EXCEPTION 'Scan claim refused' USING ERRCODE='55000'; END IF;
    NEW.lease_until:=clock_timestamp()+interval '90 seconds'; NEW.completed_at:=NULL;
   ELSE
    IF NEW.attempts<>OLD.attempts OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL THEN
      RAISE EXCEPTION 'Scan completion identity refused' USING ERRCODE='55000'; END IF;
    NEW.completed_at:=CASE WHEN NEW.state='queued' THEN NULL ELSE clock_timestamp() END;
   END IF;
   IF NEW.state='clean' AND (OLD.state<>'scanning' OR OLD.lease_until<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Clean lease expired' USING ERRCODE='55000'; END IF;
   IF NEW.state='clean' AND NOT EXISTS(SELECT 1 FROM public.document_scan_attempts WHERE scan_id=OLD.id
     AND attempt=OLD.attempts AND nonce=OLD.lease_token AND verdict='clean' AND completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Bound clean verdict required' USING ERRCODE='55000'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF OLD.completed_at IS NOT NULL OR (NEW.id,NEW.scan_id,NEW.household_id,NEW.attempt,NEW.nonce,NEW.engine_digest,NEW.signature_digest,NEW.sandbox_digest,NEW.started_at)
    IS DISTINCT FROM (OLD.id,OLD.scan_id,OLD.household_id,OLD.attempt,OLD.nonce,OLD.engine_digest,OLD.signature_digest,OLD.sandbox_digest,OLD.started_at) THEN
    RAISE EXCEPTION 'Scan attempt is immutable' USING ERRCODE='55000'; END IF;
   NEW.completed_at:=clock_timestamp();
  ELSE NEW.started_at:=clock_timestamp(); NEW.completed_at:=NULL; NEW.verdict:=NULL; NEW.failure:=NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.document_scans WHERE id=NEW.scan_id AND household_id=NEW.household_id
   AND state='scanning' AND attempts=NEW.attempt AND lease_token=NEW.nonce
   AND (lease_until>clock_timestamp() OR (NEW.verdict='scanner-error' AND NEW.failure='lease-expired'))) THEN
   RAISE EXCEPTION 'Scan lease ownership refused' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;

COMMIT;
