-- ADR-018 LOCAL migration. No hosted apply is authorized.
-- Six empty journal tables and their indexes; no existing table rewrite/backfill.
-- Installing guards takes brief metadata locks on existing domain tables; 5s lock
-- timeout fails closed. Review actual cardinality/workload before any hosted gate.
-- 100k households: 30 live documents x up to 3 attempts = 3M scan + 9M attempt rows,
-- estimated 6-10GB incl. indexes; 100k active deletion requests x 100 resources x
-- 3 attempts/observations = up to 10M/30M/30M journal rows (~30-60GB). These are
-- sizing assumptions, not measured capacity. Retention and reconciliation required.
-- Indexes support exact household lookup, unique object/attempt claims and latest
-- per-resource observation. All build on new empty tables, no concurrent build needed.
-- Rollback: disable new invocations, retain additive schema, fences and evidence.
-- NEVER drop an active fence or journal as rollback; first reconcile capabilities,
-- jobs, provider deletion and backup restore behavior. No automatic down migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- CreateTable
CREATE TABLE "document_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "seal_id" UUID NOT NULL,
    "sha256" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_scan_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "nonce" UUID NOT NULL,
    "engine_digest" CHAR(64) NOT NULL,
    "signature_digest" CHAR(64) NOT NULL,
    "sandbox_digest" CHAR(64) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "verdict" VARCHAR(16),
    "failure" VARCHAR(16),

    CONSTRAINT "document_scan_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_deletions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undo_until" TIMESTAMPTZ(6) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'grace',
    "fenced_at" TIMESTAMPTZ(6),
    "settle_until" TIMESTAMPTZ(6),
    "manifest_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "household_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deletion_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "component" VARCHAR(32) NOT NULL,
    "resource_ref" UUID NOT NULL,
    "inventory_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "lease_token" UUID NOT NULL,
    "lease_until" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "outcome" VARCHAR(16),

    CONSTRAINT "deletion_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "remaining" INTEGER NOT NULL,
    "retention_until" TIMESTAMPTZ(6),
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_scans_household_id_state_idx" ON "document_scans"("household_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "document_scans_document_id_seal_id_key" ON "document_scans"("document_id", "seal_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_scans_id_household_id_key" ON "document_scans"("id", "household_id");

-- CreateIndex
CREATE INDEX "document_scan_attempts_household_id_idx" ON "document_scan_attempts"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_scan_attempts_scan_id_attempt_key" ON "document_scan_attempts"("scan_id", "attempt");

-- CreateIndex
CREATE INDEX "household_deletions_household_id_state_idx" ON "household_deletions"("household_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "household_deletions_id_household_id_key" ON "household_deletions"("id", "household_id");

-- CreateIndex
CREATE INDEX "deletion_resources_household_id_idx" ON "deletion_resources"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_resources_deletion_id_component_resource_ref_key" ON "deletion_resources"("deletion_id", "component", "resource_ref");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_resources_id_household_id_key" ON "deletion_resources"("id", "household_id");

-- CreateIndex
CREATE INDEX "deletion_attempts_household_id_idx" ON "deletion_attempts"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_attempts_resource_id_attempt_key" ON "deletion_attempts"("resource_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_observations_evidence_id_key" ON "deletion_observations"("evidence_id");

-- CreateIndex
CREATE INDEX "deletion_observations_resource_id_observed_at_idx" ON "deletion_observations"("resource_id", "observed_at");

-- CreateIndex
CREATE INDEX "deletion_observations_household_id_idx" ON "deletion_observations"("household_id");

-- AddForeignKey
ALTER TABLE "document_scan_attempts" ADD CONSTRAINT "document_scan_attempts_scan_id_household_id_fkey" FOREIGN KEY ("scan_id", "household_id") REFERENCES "document_scans"("id", "household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_resources" ADD CONSTRAINT "deletion_resources_deletion_id_household_id_fkey" FOREIGN KEY ("deletion_id", "household_id") REFERENCES "household_deletions"("id", "household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_attempts" ADD CONSTRAINT "deletion_attempts_resource_id_household_id_fkey" FOREIGN KEY ("resource_id", "household_id") REFERENCES "deletion_resources"("id", "household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_observations" ADD CONSTRAINT "deletion_observations_resource_id_household_id_fkey" FOREIGN KEY ("resource_id", "household_id") REFERENCES "deletion_resources"("id", "household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE document_scans ADD CONSTRAINT scan_hash_size CHECK (octet_length(sha256)=32 AND size_bytes BETWEEN 1 AND 26214400),
 ADD CONSTRAINT scan_state CHECK(state IN ('queued','scanning','clean','rejected','exhausted','cancelled','superseded')),
 ADD CONSTRAINT scan_attempt_bound CHECK(attempts BETWEEN 0 AND 3),
 ADD CONSTRAINT scan_lease_pair CHECK((lease_token IS NULL)=(lease_until IS NULL));
ALTER TABLE document_scan_attempts ADD CONSTRAINT scan_attempt_number CHECK(attempt BETWEEN 1 AND 3),
 ADD CONSTRAINT scan_release_digests CHECK(engine_digest ~ '^[a-f0-9]{64}$' AND signature_digest ~ '^[a-f0-9]{64}$' AND sandbox_digest ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT scan_verdict CHECK(verdict IS NULL OR verdict IN ('clean','rejected','indeterminate','scanner-error')),
 ADD CONSTRAINT scan_failure CHECK(failure IS NULL OR failure IN ('none','malware','unsupported','malformed','timeout','resource','binding','unavailable','lease-expired','deletion')),
 ADD CONSTRAINT scan_completion_pair CHECK((completed_at IS NULL)=(verdict IS NULL) AND (verdict IS NULL)=(failure IS NULL)),
 ADD CONSTRAINT scan_clean_failure CHECK((verdict='clean')=(failure='none')),
 ADD CONSTRAINT scan_completion_time CHECK(completed_at IS NULL OR completed_at >= started_at);
ALTER TABLE household_deletions ALTER COLUMN undo_until SET DEFAULT (clock_timestamp()+interval '14 days');
ALTER TABLE household_deletions ADD CONSTRAINT deletion_state CHECK(state IN ('grace','cancelled','fenced','verifying','completed')),
 ADD CONSTRAINT deletion_grace CHECK(undo_until >= requested_at+interval '14 days'),
 ADD CONSTRAINT deletion_fence_pair CHECK((fenced_at IS NULL)=(settle_until IS NULL));
CREATE UNIQUE INDEX household_deletions_active_idx ON household_deletions(household_id) WHERE state<>'cancelled';
ALTER TABLE deletion_resources ADD CONSTRAINT deletion_component CHECK(component IN ('documents','quarantine','derived-records','identifier-secrets','notifications-reminders','outbox-delivery-inbox','job-artifacts','account-household','provider-references','audit','telemetry','backups')),
 ADD CONSTRAINT deletion_inventory_count CHECK(inventory_count>=0);
ALTER TABLE deletion_attempts ADD CONSTRAINT deletion_attempt_bound CHECK(attempt BETWEEN 1 AND 3),
 ADD CONSTRAINT deletion_outcome CHECK(outcome IS NULL OR outcome IN ('acknowledged','failed','lease-expired')),
 ADD CONSTRAINT deletion_attempt_completion CHECK((completed_at IS NULL)=(outcome IS NULL) AND (completed_at IS NULL OR completed_at>=started_at));
ALTER TABLE deletion_observations ADD CONSTRAINT deletion_observation_source CHECK(source IN ('local-db','synthetic','provider','backup-catalog')),
 ADD CONSTRAINT deletion_observation_state CHECK(state IN ('absent','remaining','unknown','retained')),
 ADD CONSTRAINT deletion_observation_count CHECK(remaining>=0 AND (state<>'absent' OR (remaining=0 AND retention_until IS NULL))),
 ADD CONSTRAINT deletion_retention_bound CHECK(retention_until IS NULL OR (state='retained' AND retention_until>observed_at AND retention_until<=observed_at+interval '35 days'));
CREATE ROLE app_document_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE app_retention_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE app_deletion_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,app TO app_document_worker,app_retention_worker,app_deletion_verifier;
DO $security$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['document_scans','document_scan_attempts','household_deletions','deletion_resources','deletion_attempts','deletion_observations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY journal_household ON %I FOR ALL USING (household_id=app.current_household()) WITH CHECK (household_id=app.current_household())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $security$;
GRANT SELECT ON household_deletions TO app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
GRANT INSERT(id,household_id,requested_by), UPDATE(state) ON household_deletions TO app_user;
GRANT SELECT ON deletion_resources,deletion_attempts,deletion_observations TO app_user,app_retention_worker,app_deletion_verifier;
GRANT UPDATE(state,fenced_at,settle_until,manifest_at) ON household_deletions TO app_retention_worker;
GRANT UPDATE(state,completed_at) ON household_deletions TO app_deletion_verifier;
GRANT INSERT ON deletion_resources,deletion_attempts TO app_retention_worker;
GRANT UPDATE(completed_at,outcome) ON deletion_attempts TO app_retention_worker;
GRANT INSERT ON deletion_observations TO app_deletion_verifier;
GRANT SELECT ON document_scans,document_scan_attempts TO app_user,app_document_worker,app_retention_worker,app_deletion_verifier;
GRANT INSERT,UPDATE ON document_scans,document_scan_attempts TO app_document_worker;
GRANT SELECT(id) ON households TO app_document_worker,app_retention_worker,app_deletion_verifier;
GRANT SELECT(household_id,user_id,role) ON household_users TO app_document_worker,app_retention_worker,app_deletion_verifier;
GRANT SELECT(id,household_id,storage_path,sha256,size_bytes,mime_type,status) ON documents TO app_document_worker;
GRANT UPDATE(status,sha256,updated_at) ON documents TO app_document_worker;
GRANT SELECT,INSERT ON outbox_events,audit_log TO app_document_worker;
GRANT INSERT ON audit_log TO app_retention_worker,app_deletion_verifier;
GRANT USAGE ON SEQUENCE outbox_events_id_seq,audit_log_id_seq TO app_document_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_retention_worker,app_deletion_verifier;
-- The independent verifier can count rows/opaque links, never decrypt/read content.
GRANT SELECT(id,household_id) ON documents,document_chunks,items,obligations,reminders,notifications TO app_deletion_verifier;
GRANT SELECT(id,item_id) ON item_secrets TO app_deletion_verifier;
GRANT SELECT(document_id) ON document_uploads TO app_deletion_verifier;
GRANT SELECT(id,household_id) ON job_deliveries,job_inbox,outbox_events,inbound_emails,audit_log TO app_deletion_verifier;

CREATE FUNCTION app.assert_household_open(hh uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF hh IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-fence:'||hh::text,0));
 IF EXISTS(SELECT 1 FROM public.household_deletions WHERE household_id=hh AND state IN ('fenced','verifying','completed')) THEN
  RAISE EXCEPTION 'Household processing is fenced' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app.assert_household_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assert_household_open(uuid) TO app_user,app_dispatcher,app_job_worker,app_document_worker,app_retention_worker,app_deletion_verifier;
CREATE FUNCTION app.guard_household_write() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
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
DO $guards$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['households','household_users','household_members','entitlements','documents','document_chunks','document_uploads','items','item_secrets','obligations','reminders','notifications','notification_deliveries','outbox_events','inbound_emails','idempotency_keys','job_deliveries','job_inbox'] LOOP
  EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_household_write()',t);
 END LOOP;
END $guards$;

CREATE FUNCTION app.guard_deletion_request() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user NOT IN ('app_user','app_retention_worker','app_deletion_verifier') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-fence:'||NEW.household_id::text,0));
 IF TG_OP='INSERT' THEN
  IF current_user<>'app_user' OR NEW.requested_by IS DISTINCT FROM app.current_user_id() OR NOT EXISTS(
   SELECT 1 FROM public.household_users WHERE household_id=NEW.household_id AND user_id=app.current_user_id() AND role='owner') THEN
   RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501';
  END IF;
  NEW.requested_at:=clock_timestamp(); NEW.undo_until:=NEW.requested_at+interval '14 days';
  NEW.state:='grace'; NEW.fenced_at:=NULL; NEW.settle_until:=NULL; NEW.manifest_at:=NULL; NEW.completed_at:=NULL;
 ELSIF current_user='app_user' THEN
  IF OLD.state<>'grace' OR NEW.state<>'cancelled' OR clock_timestamp()>=OLD.undo_until OR OLD.requested_by IS DISTINCT FROM app.current_user_id()
   OR NOT EXISTS(SELECT 1 FROM public.household_users WHERE household_id=OLD.household_id AND user_id=app.current_user_id() AND role='owner') THEN
   RAISE EXCEPTION 'Deletion undo refused' USING ERRCODE='42501'; END IF;
 ELSIF current_user='app_retention_worker' THEN
  IF OLD.state='grace' AND NEW.state='fenced' AND clock_timestamp()>=OLD.undo_until THEN
   NEW.fenced_at:=clock_timestamp(); NEW.settle_until:=NEW.fenced_at+interval '15 minutes';
  ELSIF OLD.state='fenced' AND NEW.state='verifying' AND clock_timestamp()>=OLD.settle_until
    AND (SELECT count(DISTINCT component) FROM public.deletion_resources WHERE deletion_id=OLD.id)=12 THEN
   NEW.manifest_at:=clock_timestamp();
  ELSE RAISE EXCEPTION 'Deletion transition refused' USING ERRCODE='55000'; END IF;
 ELSIF current_user='app_deletion_verifier' THEN
  -- There is intentionally NO final-completion authority in this local foundation.
  -- Provider/account/backup adapters and journal identity-link purge are not proven.
  RAISE EXCEPTION 'Final deletion receipt is not authorized' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deletion_request_guard BEFORE INSERT OR UPDATE ON household_deletions FOR EACH ROW EXECUTE FUNCTION app.guard_deletion_request();

CREATE FUNCTION app.guard_deletion_resource() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.household_deletions WHERE id=NEW.deletion_id AND household_id=NEW.household_id AND state='fenced' AND settle_until<=clock_timestamp()) THEN
  RAISE EXCEPTION 'Manifest admission refused' USING ERRCODE='55000'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER deletion_resource_guard BEFORE INSERT ON deletion_resources FOR EACH ROW EXECUTE FUNCTION app.guard_deletion_resource();
CREATE FUNCTION app.guard_deletion_observation() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.deletion_resources r JOIN public.household_deletions d ON d.id=r.deletion_id
   WHERE r.id=NEW.resource_id AND r.household_id=NEW.household_id AND d.state='verifying') THEN
  RAISE EXCEPTION 'Observation admission refused' USING ERRCODE='55000'; END IF;
 NEW.observed_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER deletion_observation_guard BEFORE INSERT ON deletion_observations FOR EACH ROW EXECUTE FUNCTION app.guard_deletion_observation();

CREATE FUNCTION app.audit_security_journal() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 INSERT INTO public.audit_log(household_id,actor_type,action,target_type,target_id)
 VALUES(NEW.household_id,CASE WHEN app.current_user_id() IS NULL THEN 'system'::public."ActorType" ELSE 'user'::public."ActorType" END,
 TG_TABLE_NAME||'.'||lower(TG_OP),TG_TABLE_NAME,NEW.id);
 RETURN NEW;
END $$;
DO $audit$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['document_scans','document_scan_attempts','household_deletions','deletion_resources','deletion_attempts','deletion_observations'] LOOP
  EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
 END LOOP;
END $audit$;
-- Trigger functions are not RPCs. No SECURITY DEFINER is introduced.
REVOKE ALL ON FUNCTION app.guard_household_write(),app.guard_deletion_request(),app.guard_deletion_resource(),app.guard_deletion_observation(),app.audit_security_journal() FROM PUBLIC;

CREATE FUNCTION app.guard_scan_journal() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
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
    NEW.lease_until:=clock_timestamp()+interval '30 seconds'; NEW.completed_at:=NULL;
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
CREATE TRIGGER scan_journal_guard BEFORE INSERT OR UPDATE ON document_scans FOR EACH ROW EXECUTE FUNCTION app.guard_scan_journal();
CREATE TRIGGER scan_attempt_guard BEFORE INSERT OR UPDATE ON document_scan_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_scan_journal();
REVOKE ALL ON FUNCTION app.guard_scan_journal() FROM PUBLIC;
CREATE FUNCTION app.guard_deletion_attempt() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE previous public.deletion_attempts;
BEGIN
 IF current_user<>'app_retention_worker' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('deletion-resource:'||NEW.resource_id::text,0));
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.deletion_resources r JOIN public.household_deletions d ON d.id=r.deletion_id
    WHERE r.id=NEW.resource_id AND r.household_id=NEW.household_id AND d.state='verifying') THEN
    RAISE EXCEPTION 'Deletion attempt scope refused' USING ERRCODE='55000'; END IF;
  SELECT * INTO previous FROM public.deletion_attempts WHERE resource_id=NEW.resource_id ORDER BY attempt DESC LIMIT 1;
  IF (previous.id IS NOT NULL AND (previous.completed_at IS NULL OR previous.outcome='acknowledged'))
    OR NEW.attempt<>COALESCE(previous.attempt,0)+1 THEN
    RAISE EXCEPTION 'Deletion attempt ownership refused' USING ERRCODE='55000'; END IF;
  NEW.started_at:=clock_timestamp(); NEW.lease_until:=NEW.started_at+interval '30 seconds'; NEW.completed_at:=NULL; NEW.outcome:=NULL;
 ELSE
  IF OLD.completed_at IS NOT NULL OR (NEW.id,NEW.resource_id,NEW.household_id,NEW.attempt,NEW.lease_token,NEW.lease_until,NEW.started_at)
    IS DISTINCT FROM (OLD.id,OLD.resource_id,OLD.household_id,OLD.attempt,OLD.lease_token,OLD.lease_until,OLD.started_at)
    OR ((NEW.outcome='lease-expired') IS DISTINCT FROM (OLD.lease_until<=clock_timestamp())) THEN
    RAISE EXCEPTION 'Deletion result ownership refused' USING ERRCODE='55000'; END IF;
  NEW.completed_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deletion_attempt_guard BEFORE INSERT OR UPDATE ON deletion_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_deletion_attempt();
REVOKE ALL ON FUNCTION app.guard_deletion_attempt() FROM PUBLIC;
COMMIT;
