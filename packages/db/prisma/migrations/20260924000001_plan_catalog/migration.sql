-- PRD 1.2, ADR-020 local catalog. No hosted TEST activation.
-- Metadata locks bounded 5s/60s; small two-row global non-personal config.
-- Rollback disables local TEST projection; retain all members and billing history.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE TABLE plan_catalog (
 tier text PRIMARY KEY CHECK(tier IN ('free','premium')),
 version integer NOT NULL CHECK(version>0),
 documents_per_month integer NOT NULL CHECK(documents_per_month>0),
 document_warning integer NOT NULL CHECK(document_warning>0 AND document_warning<documents_per_month),
 managed_humans integer CHECK(managed_humans>=0)
);
INSERT INTO plan_catalog VALUES('free',1,10,8,1),('premium',1,50,40,NULL);
CREATE TABLE local_plan_activation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 test_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO local_plan_activation DEFAULT VALUES;
REVOKE ALL ON plan_catalog,local_plan_activation FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_billing_test,app_document_worker,app_retention_worker,app_deletion_verifier;
GRANT SELECT ON plan_catalog,local_plan_activation TO app_user;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON plan_catalog,local_plan_activation FROM %I',r); END IF;
END LOOP; END $$;
-- SECURITY INVOKER only. Local activation requires a fixture administrator; the
-- application and billing role cannot enable it. No customer/lease/provider data.
CREATE VIEW effective_plan WITH(security_invoker=true,security_barrier=true) AS
 SELECT e.household_id,c.tier,c.version,c.documents_per_month,c.document_warning,c.managed_humans
 FROM entitlements e CROSS JOIN local_plan_activation a JOIN plan_catalog c ON c.tier=
 CASE WHEN a.test_enabled AND EXISTS(SELECT 1 FROM billing_test_eligibility s WHERE s.household_id=e.household_id AND s.eligible) THEN 'premium' ELSE 'free' END
 WHERE e.household_id=app.current_household();
REVOKE ALL ON effective_plan FROM PUBLIC,app_dispatcher,app_job_worker;
GRANT SELECT ON effective_plan TO app_user;
-- Canonical self binding is the actual household creator, never DOB/name/kind.
-- Existing legacy duplicates are not destructively repaired. New binding/ref changes
-- fail closed; no second self row can be created to bypass the managed-human cap.
CREATE FUNCTION app.guard_member_allowance() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE cap integer; consumes boolean; previous_consumes boolean; owner_id uuid; n bigint;
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||NEW.household_id::text,0));
 SELECT created_by INTO owner_id FROM public.households WHERE id=NEW.household_id;
 IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.household_id<>OLD.household_id) THEN
  RAISE EXCEPTION 'Member identity is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND NEW.user_id IS NOT NULL AND (NEW.user_id IS DISTINCT FROM owner_id OR NOT EXISTS(
  SELECT 1 FROM public.household_users WHERE household_id=NEW.household_id AND user_id=NEW.user_id AND role='owner') OR EXISTS(
  SELECT 1 FROM public.household_members WHERE household_id=NEW.household_id AND user_id=NEW.user_id)) THEN
  RAISE EXCEPTION 'Self binding refused' USING ERRCODE='42501'; END IF;
 consumes:=NEW.archived_at IS NULL AND NEW.kind IN ('adult','child','dependent') AND NEW.user_id IS DISTINCT FROM owner_id;
 previous_consumes:=false;
 IF TG_OP='UPDATE' THEN previous_consumes:=OLD.archived_at IS NULL AND OLD.kind IN ('adult','child','dependent') AND OLD.user_id IS DISTINCT FROM owner_id; END IF;
 IF consumes AND NOT previous_consumes THEN
  SELECT managed_humans INTO cap FROM public.effective_plan WHERE household_id=NEW.household_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='55000'; END IF;
  SELECT count(*) INTO n FROM public.household_members WHERE household_id=NEW.household_id AND archived_at IS NULL
   AND kind IN ('adult','child','dependent') AND user_id IS DISTINCT FROM owner_id AND id<>NEW.id;
  IF cap IS NOT NULL AND n>=cap THEN RAISE EXCEPTION 'Managed member allowance reached' USING ERRCODE='P0001',CONSTRAINT='managed_member_allowance'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_member_allowance() FROM PUBLIC;
CREATE TRIGGER member_allowance BEFORE INSERT OR UPDATE ON household_members FOR EACH ROW EXECUTE FUNCTION app.guard_member_allowance();
-- Expiry can occur after the BEFORE trigger. A deferred check closes that window.
CREATE FUNCTION app.assert_member_allowance_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE cap integer; owner_id uuid; n bigint; previous_consumes boolean:=false;
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 SELECT created_by INTO owner_id FROM public.households WHERE id=NEW.household_id;
 IF TG_OP='UPDATE' THEN previous_consumes:=OLD.archived_at IS NULL AND OLD.kind IN ('adult','child','dependent') AND OLD.user_id IS DISTINCT FROM owner_id; END IF;
 IF NEW.archived_at IS NOT NULL OR NEW.kind NOT IN ('adult','child','dependent') OR NEW.user_id IS NOT DISTINCT FROM owner_id OR previous_consumes THEN RETURN NEW; END IF;
 SELECT managed_humans INTO cap FROM public.effective_plan WHERE household_id=NEW.household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO n FROM public.household_members WHERE household_id=NEW.household_id AND archived_at IS NULL
  AND kind IN ('adult','child','dependent') AND user_id IS DISTINCT FROM owner_id;
 IF cap IS NOT NULL AND n>cap THEN RAISE EXCEPTION 'Managed member allowance reached' USING ERRCODE='P0001',CONSTRAINT='managed_member_allowance'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.assert_member_allowance_commit() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER member_allowance_commit AFTER INSERT OR UPDATE ON household_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.assert_member_allowance_commit();
COMMIT;
