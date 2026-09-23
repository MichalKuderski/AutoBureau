-- LOCAL ONLY. Add one empty scoped challenge journal; no Auth-provider tables or
-- roles are granted. New-table/index work does not rewrite existing domain tables.
-- Updating the inventory CHECK takes a brief metadata lock and scans manifests;
-- NOT VALID + VALIDATE separates its validation lock. 5s lock/60s statement bound.
-- At 100k households x 10 retained challenges: ~1m rows, estimated 300-500MB with
-- indexes, excluding audit growth. No automatic retention job is activated.
-- Rollback: disable account-security invocations; retain challenge consumption and
-- audit evidence until expiry/hold review. Do not reset consumed state or fences.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE account_security_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL,
 session_id uuid NOT NULL,
 factor_id uuid NOT NULL,
 challenge_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CONSTRAINT account_challenge_time CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes' AND (consumed_at IS NULL OR consumed_at>=created_at))
);
CREATE INDEX account_security_challenges_household_id_idx ON account_security_challenges(household_id);
ALTER TABLE account_security_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_security_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY account_challenge_scope ON account_security_challenges FOR ALL
 USING(household_id=app.current_household() AND (current_user IN ('app_retention_worker','app_deletion_verifier') OR user_id=app.current_user_id()))
 WITH CHECK(household_id=app.current_household() AND user_id=app.current_user_id());
REVOKE ALL ON account_security_challenges FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON account_security_challenges FROM %I',r); END IF;
 END LOOP;
END $$;
GRANT SELECT ON account_security_challenges TO app_user;
GRANT INSERT(household_id,user_id,session_id,factor_id,challenge_id,expires_at),UPDATE(consumed_at) ON account_security_challenges TO app_user;
GRANT SELECT(id,household_id) ON account_security_challenges TO app_retention_worker,app_deletion_verifier;
CREATE FUNCTION app.guard_account_challenge() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 IF NEW.user_id IS DISTINCT FROM app.current_user_id() OR NOT EXISTS(SELECT 1 FROM public.household_users
  WHERE household_id=NEW.household_id AND user_id=app.current_user_id() AND role='owner') THEN
  RAISE EXCEPTION 'Account challenge refused' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN NEW.created_at:=clock_timestamp(); NEW.consumed_at:=NULL;
 ELSE
  IF OLD.consumed_at IS NOT NULL OR OLD.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Account challenge refused' USING ERRCODE='55000'; END IF;
  NEW.consumed_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_account_challenge() FROM PUBLIC;
CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON account_security_challenges FOR EACH ROW EXECUTE FUNCTION app.guard_household_write();
CREATE TRIGGER account_challenge_guard BEFORE INSERT OR UPDATE ON account_security_challenges FOR EACH ROW EXECUTE FUNCTION app.guard_account_challenge();
CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON account_security_challenges FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
COMMIT;
