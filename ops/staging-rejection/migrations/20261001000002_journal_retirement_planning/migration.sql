-- ADR-019 journal retirement: the LOCALLY SAFE part only. Bounded, leased, crash-recoverable
-- eligibility PLANNING per deleted household, operator-owned holds, and independent
-- retained-row observations. There is deliberately NO purge path: every catalog class has a
-- restore dependency and no independently operated restore authority exists, so the
-- database refuses to record any class as eligible (CHECK NOT eligible). Enabling retirement
-- requires a reviewed migration that removes that CHECK together with a verified ADR-019
-- authority; no runtime role holds DELETE on any journal because of this migration.
-- Empty tables; bounded locks (5s/60s); rollback = revoke grants and drop the empty tables
-- (planning rows are evidence: keep them if any exist).
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE TABLE journal_retirement_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid,                       -- NULL: applies to every household
 class_id text NOT NULL CHECK(class_id IN ('all','scan','custody','processing','results','outbox','account-security','exports','stripe','plaid','deletion','audit')),
 reason text NOT NULL CHECK(reason IN ('incident','legal','security','dispute')),
 reference text NOT NULL CHECK(reference ~ '^[A-Za-z0-9._:-]{1,64}$'),  -- ticket reference, never free text
 placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 review_by timestamptz NOT NULL, released_at timestamptz,
 CHECK(review_by>placed_at), CHECK(released_at IS NULL OR released_at>=placed_at)
);
CREATE INDEX retirement_holds_scope ON journal_retirement_holds(household_id,class_id) WHERE released_at IS NULL;
CREATE TABLE journal_retirement_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL,
 deletion_id uuid NOT NULL UNIQUE REFERENCES household_deletions(id) ON DELETE RESTRICT,
 catalog_version integer NOT NULL CHECK(catalog_version=1),
 state text NOT NULL DEFAULT 'leased' CHECK(state IN ('leased','planned')),
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), planned_at timestamptz,
 plan_sha256 text CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(id,household_id),
 CHECK((state='planned')=(planned_at IS NOT NULL AND plan_sha256 IS NOT NULL)),
 CHECK(state<>'leased' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state<>'planned' OR (lease_token IS NULL AND lease_until IS NULL))
);
CREATE TABLE journal_retirement_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, run_id uuid NOT NULL,
 class_id text NOT NULL CHECK(class_id IN ('scan','custody','processing','results','outbox','account-security','exports','stripe','plaid','deletion','audit')),
 eligible boolean NOT NULL DEFAULT false CHECK(NOT eligible),
 reasons text[] NOT NULL CHECK(cardinality(reasons) BETWEEN 1 AND 9
  AND reasons <@ ARRAY['adr019-restore-authority-absent','deletion-not-verifying','incident-hold','legal-hold','security-hold','dispute-hold','hold-review-overdue','replay-window-open']::text[]
  AND 'adr019-restore-authority-absent'=ANY(reasons)),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(run_id,class_id), UNIQUE(id,household_id),
 FOREIGN KEY(run_id,household_id) REFERENCES journal_retirement_runs(id,household_id) ON DELETE RESTRICT
);
CREATE TABLE journal_retirement_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, run_id uuid NOT NULL,
 class_id text NOT NULL CHECK(class_id IN ('scan','custody','processing','results','outbox','account-security','exports','stripe','plaid','deletion','audit')),
 retained_rows bigint NOT NULL CHECK(retained_rows>=0), observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(run_id,class_id), UNIQUE(id,household_id),
 FOREIGN KEY(run_id,household_id) REFERENCES journal_retirement_runs(id,household_id) ON DELETE RESTRICT
);
ALTER TABLE journal_retirement_holds ENABLE ROW LEVEL SECURITY; ALTER TABLE journal_retirement_holds FORCE ROW LEVEL SECURITY;
CREATE POLICY hold_scope ON journal_retirement_holds FOR SELECT USING(household_id IS NULL OR household_id=app.current_household());
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['journal_retirement_holds','journal_retirement_runs','journal_retirement_decisions','journal_retirement_observations'] LOOP
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_document_worker,app_retention_worker,app_deletion_verifier,app_job_worker,app_dispatcher,app_billing_test,app_plaid_sandbox',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF; END LOOP;
  IF t<>'journal_retirement_holds' THEN
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY household_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
  END IF;
 END LOOP; END $$;
-- Holds are an operator control OUTSIDE the application authority: no runtime role may write them.
GRANT SELECT ON journal_retirement_holds TO app_retention_worker,app_deletion_verifier;
GRANT SELECT ON journal_retirement_runs,journal_retirement_decisions TO app_retention_worker,app_deletion_verifier;
GRANT INSERT(household_id,deletion_id,catalog_version,lease_token),UPDATE(state,lease_token,lease_until,attempts) ON journal_retirement_runs TO app_retention_worker;
GRANT INSERT(household_id,run_id,class_id,reasons) ON journal_retirement_decisions TO app_retention_worker;
GRANT SELECT ON journal_retirement_observations TO app_deletion_verifier;
GRANT INSERT(household_id,run_id,class_id,retained_rows) ON journal_retirement_observations TO app_deletion_verifier;
-- The owner's deletion status shows which evidence is retained and why (codes and counts only).
GRANT SELECT(class_id,reasons,decided_at,run_id,household_id) ON journal_retirement_decisions TO app_user;
GRANT SELECT(class_id,retained_rows,observed_at,run_id,household_id) ON journal_retirement_observations TO app_user;
GRANT SELECT(id,household_id,deletion_id,state,planned_at) ON journal_retirement_runs TO app_user;

CREATE FUNCTION app.guard_journal_retirement() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE d record; run record; n integer; token uuid:=nullif(current_setting('request.retirement_token',true),'')::uuid;
BEGIN
 -- Fixture/migration administrator is outside the application authority boundary.
 IF current_user NOT IN ('app_retention_worker','app_deletion_verifier','app_user') THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retirement evidence is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.household_id IS DISTINCT FROM app.current_household() THEN RAISE EXCEPTION 'Retirement scope refused' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('retirement:'||NEW.household_id::text,0));
 IF TG_TABLE_NAME='journal_retirement_runs' THEN
  IF current_user<>'app_retention_worker' THEN RAISE EXCEPTION 'Retirement planning refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM household_deletions WHERE id=NEW.deletion_id AND household_id=NEW.household_id;
  IF d.id IS NULL OR d.state<>'verifying' OR d.manifest_at IS NULL THEN RAISE EXCEPTION 'Retirement planning requires a sealed deletion manifest' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.lease_token IS NULL THEN RAISE EXCEPTION 'Retirement lease required' USING ERRCODE='55000'; END IF;
   NEW.state:='leased'; NEW.attempts:=1; NEW.started_at:=clock_timestamp(); NEW.lease_until:=clock_timestamp()+interval '60 seconds';
   NEW.planned_at:=NULL; NEW.plan_sha256:=NULL; RETURN NEW;
  END IF;
  IF (NEW.id,NEW.household_id,NEW.deletion_id,NEW.catalog_version,NEW.started_at) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.deletion_id,OLD.catalog_version,OLD.started_at)
   OR OLD.state<>'leased' THEN RAISE EXCEPTION 'Retirement run transition refused' USING ERRCODE='55000'; END IF;
  IF NEW.state='leased' THEN
   -- Crash recovery: only an EXPIRED lease may be taken over, with a fresh token, at most 3 times.
   IF OLD.lease_until>clock_timestamp() OR OLD.attempts>=3 OR NEW.lease_token IS NULL OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
    THEN RAISE EXCEPTION 'Retirement lease takeover refused' USING ERRCODE='55000'; END IF;
   NEW.attempts:=OLD.attempts+1; NEW.lease_until:=clock_timestamp()+interval '60 seconds'; RETURN NEW;
  END IF;
  -- Completion by the live lease holder, only when every catalog class has a decision.
  IF token IS DISTINCT FROM OLD.lease_token OR OLD.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Retirement lease expired or foreign' USING ERRCODE='55000'; END IF;
  SELECT count(*) INTO n FROM journal_retirement_decisions WHERE run_id=OLD.id AND household_id=OLD.household_id;
  IF n<>11 THEN RAISE EXCEPTION 'Retirement plan incomplete' USING ERRCODE='55000'; END IF;
  NEW.lease_token:=NULL; NEW.lease_until:=NULL; NEW.attempts:=OLD.attempts; NEW.planned_at:=clock_timestamp();
  SELECT encode(sha256(convert_to(string_agg(class_id||':'||array_to_string(ARRAY(SELECT unnest(reasons) ORDER BY 1),','),';' ORDER BY class_id),'UTF8')),'hex')
   INTO NEW.plan_sha256 FROM journal_retirement_decisions WHERE run_id=OLD.id AND household_id=OLD.household_id;
  RETURN NEW;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Retirement evidence is immutable' USING ERRCODE='42501'; END IF;
 SELECT * INTO run FROM journal_retirement_runs WHERE id=NEW.run_id AND household_id=NEW.household_id;
 IF TG_TABLE_NAME='journal_retirement_decisions' THEN
  IF current_user<>'app_retention_worker' OR run.id IS NULL OR run.state<>'leased' OR run.lease_until<=clock_timestamp()
   OR token IS DISTINCT FROM run.lease_token THEN RAISE EXCEPTION 'Retirement decision requires the live lease' USING ERRCODE='55000'; END IF;
  -- Honesty: an open hold covering this class MUST appear in the reasons (a hold past its review
  -- date is still open: expiry is unknown, never clearance).
  IF EXISTS(SELECT 1 FROM journal_retirement_holds h WHERE h.released_at IS NULL AND (h.household_id IS NULL OR h.household_id=NEW.household_id)
    AND h.class_id IN ('all',NEW.class_id) AND NOT (h.reason||'-hold')=ANY(NEW.reasons))
   OR (EXISTS(SELECT 1 FROM journal_retirement_holds h WHERE h.released_at IS NULL AND (h.household_id IS NULL OR h.household_id=NEW.household_id)
    AND h.class_id IN ('all',NEW.class_id) AND h.review_by<=clock_timestamp()) AND NOT 'hold-review-overdue'=ANY(NEW.reasons))
   THEN RAISE EXCEPTION 'Retirement decision omits an open hold' USING ERRCODE='55000'; END IF;
  NEW.eligible:=false; NEW.decided_at:=clock_timestamp(); RETURN NEW;
 END IF;
 -- Observations: the independent verifier, after planning, with its own count.
 IF current_user<>'app_deletion_verifier' OR run.id IS NULL OR run.state<>'planned' THEN RAISE EXCEPTION 'Retirement observation refused' USING ERRCODE='55000'; END IF;
 NEW.observed_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER retirement_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_retirement_runs FOR EACH ROW EXECUTE FUNCTION app.guard_journal_retirement();
CREATE TRIGGER retirement_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_retirement_decisions FOR EACH ROW EXECUTE FUNCTION app.guard_journal_retirement();
CREATE TRIGGER retirement_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_retirement_observations FOR EACH ROW EXECUTE FUNCTION app.guard_journal_retirement();
CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON journal_retirement_runs FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
CREATE TRIGGER security_journal_audit AFTER INSERT ON journal_retirement_decisions FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
CREATE TRIGGER security_journal_audit AFTER INSERT ON journal_retirement_observations FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal();
REVOKE ALL ON FUNCTION app.guard_journal_retirement() FROM PUBLIC;
COMMIT;
