-- LOCAL result hardening. No data rewrite. Bounded trigger installation locks.
-- Rollback disables new invocation; preserve source immutability and result evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE FUNCTION app.guard_custodied_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user NOT IN ('app_user','app_document_worker') THEN RETURN NEW; END IF;
 -- Serialize against custody registration BEFORE observing whether a binding exists.
 PERFORM app.assert_household_open(NEW.household_id);
 IF (NEW.storage_path,NEW.sha256,NEW.size_bytes,NEW.mime_type) IS DISTINCT FROM (OLD.storage_path,OLD.sha256,OLD.size_bytes,OLD.mime_type)
  AND EXISTS(SELECT 1 FROM document_custodies WHERE document_id=OLD.id AND household_id=OLD.household_id)
 THEN RAISE EXCEPTION 'Custodied source is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER custodied_source_guard BEFORE UPDATE OF storage_path,sha256,size_bytes,mime_type ON documents FOR EACH ROW EXECUTE FUNCTION app.guard_custodied_source();
CREATE FUNCTION app.check_document_result_intent() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user='app_document_worker' AND (SELECT count(*) FROM outbox_events WHERE household_id=NEW.household_id AND aggregate_id=NEW.document_id
  AND event_type='document.needs_review' AND payload=jsonb_build_object('processing_id',NEW.processing_id::text,'result_id',NEW.id::text))<>1
 THEN RAISE EXCEPTION 'Result review intent missing' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER result_intent_commit AFTER INSERT ON document_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_document_result_intent();
REVOKE ALL ON FUNCTION app.guard_custodied_source(),app.check_document_result_intent() FROM PUBLIC;
COMMIT;
