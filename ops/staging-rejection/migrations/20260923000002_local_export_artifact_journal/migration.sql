-- Local synthetic export publication journal. No hosted activation/key custody.
-- Empty table/index creation; no existing content rewrite. FK takes a brief lock
-- on households; bounded 5s lock/60s statement timeouts. At 100k households and
-- 4 retained requests each, estimate <300MB plus audit; measure actual retention.
-- Rollback: stop builders/downloads, retain journal and deny markers. Do not drop
-- revocation evidence or reinterpret an unjournaled file as downloadable.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE local_export_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 owner_id uuid NOT NULL,
 ciphertext_digest text NOT NULL CHECK(ciphertext_digest ~ '^[a-f0-9]{64}$'),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
 snapshot_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'partial' CHECK(state IN ('partial','revoked')),
 UNIQUE(household_id,request_id),
 CHECK(expires_at>snapshot_at AND expires_at<=snapshot_at+interval '72 hours')
);
ALTER TABLE local_export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_export_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY local_export_scope ON local_export_artifacts FOR ALL
 USING(household_id=app.current_household() AND (current_user IN ('app_retention_worker','app_deletion_verifier') OR owner_id=app.current_user_id()))
 WITH CHECK(household_id=app.current_household() AND owner_id=app.current_user_id());
REVOKE ALL ON local_export_artifacts FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON local_export_artifacts FROM %I',r); END IF;
 END LOOP;
END $$;
GRANT SELECT ON local_export_artifacts TO app_user;
GRANT INSERT(household_id,request_id,owner_id,ciphertext_digest,size_bytes,snapshot_at,expires_at),UPDATE(state) ON local_export_artifacts TO app_user;
GRANT SELECT(id,household_id) ON local_export_artifacts TO app_retention_worker,app_deletion_verifier;
CREATE FUNCTION app.guard_local_export_artifact() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 IF NEW.owner_id IS DISTINCT FROM app.current_user_id() OR NOT EXISTS(SELECT 1 FROM public.household_users h JOIN public.users u ON u.id=h.user_id
  WHERE h.household_id=NEW.household_id AND h.user_id=app.current_user_id() AND h.role='owner' AND u.status='active') THEN
  RAISE EXCEPTION 'Export journal refused' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.snapshot_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.outbox_events e
   WHERE e.household_id=NEW.household_id AND e.event_type='export.requested' AND e.aggregate_type='export' AND e.aggregate_id=NEW.request_id
    AND e.payload=jsonb_build_object('version',1,'requested_by',NEW.owner_id::text) AND e.created_at+interval '72 hours'=NEW.expires_at) THEN
   RAISE EXCEPTION 'Export journal refused' USING ERRCODE='55000';
  END IF;
  NEW.state:='partial'; NEW.created_at:=clock_timestamp();
 ELSIF NOT(OLD.state='partial' AND NEW.state='revoked') THEN
  RAISE EXCEPTION 'Export journal transition refused' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_local_export_artifact() FROM PUBLIC;
CREATE TRIGGER local_export_guard BEFORE INSERT OR UPDATE ON local_export_artifacts FOR EACH ROW EXECUTE FUNCTION app.guard_local_export_artifact();
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON local_export_artifacts FOR EACH ROW EXECUTE FUNCTION app.guard_household_write();
CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON local_export_artifacts FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices','export-artifacts')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
