-- ADR-021 amendment. LOCAL synthetic only. No historical accounting rewrite.
-- Empty journals, bounded locks; rollback disables callers and preserves evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE document_processing ADD CONSTRAINT processing_id_household UNIQUE(id,household_id);
CREATE TABLE document_results (
 id uuid PRIMARY KEY, household_id uuid NOT NULL, processing_id uuid NOT NULL UNIQUE,
 custody_id uuid NOT NULL, document_id uuid NOT NULL, scan_id uuid NOT NULL, scan_attempt_id uuid NOT NULL,
 object_id uuid NOT NULL, source_sha256 bytea NOT NULL CHECK(octet_length(source_sha256)=32),
 engine_digest text NOT NULL, signature_digest text NOT NULL, sandbox_digest text NOT NULL,
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 parser_version text NOT NULL DEFAULT 'canonical-public-deadline-pdf-v1' CHECK(parser_version='canonical-public-deadline-pdf-v1'),
 redactor_version text NOT NULL DEFAULT 'closed-enums-v1' CHECK(redactor_version='closed-enums-v1'),
 review_state text NOT NULL DEFAULT 'requires-human-review' CHECK(review_state='requires-human-review'),
 page integer NOT NULL DEFAULT 1 CHECK(page=1), citation_start integer NOT NULL CHECK(citation_start>=0),
 citation_end integer NOT NULL CHECK(citation_end=citation_start+10 AND citation_end<=4096),
 due_date date NOT NULL CHECK(due_date BETWEEN '2020-01-01' AND '2099-12-31'),
 lease_token uuid NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 original_tier text NOT NULL, original_catalog_version integer NOT NULL, original_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,household_id),
 FOREIGN KEY(processing_id,household_id) REFERENCES document_processing(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(custody_id,household_id) REFERENCES document_custodies(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX results_household ON document_results(household_id,created_at,id);
CREATE TABLE document_result_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL,result_id uuid NOT NULL UNIQUE,
 owner_id uuid NOT NULL,item_id uuid NOT NULL,obligation_id uuid NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,household_id),
 FOREIGN KEY(result_id,household_id) REFERENCES document_results(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(item_id,household_id) REFERENCES items(id,household_id) ON DELETE RESTRICT,
 FOREIGN KEY(obligation_id,household_id) REFERENCES obligations(id,household_id) ON DELETE RESTRICT
);
CREATE INDEX reviews_household ON document_result_reviews(household_id,id);
DO $$ DECLARE t text; r text; BEGIN FOREACH t IN ARRAY ARRAY['document_results','document_result_reviews'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY household_scope ON %I FOR ALL USING(household_id=app.current_household()) WITH CHECK(household_id=app.current_household())',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,app_user,app_document_worker,app_retention_worker,app_deletion_verifier,app_job_worker,app_dispatcher,app_billing_test',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF; END LOOP;
 EXECUTE format('GRANT SELECT ON %I TO app_user,app_document_worker',t);
 EXECUTE format('GRANT SELECT(id,household_id) ON %I TO app_retention_worker,app_deletion_verifier',t);
 EXECUTE format('CREATE TRIGGER privacy_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_household_write()',t);
 EXECUTE format('CREATE TRIGGER security_journal_audit AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_security_journal()',t);
END LOOP; END $$;
GRANT INSERT(id,household_id,processing_id,lease_token,source_sha256,citation_start,citation_end,due_date) ON document_results TO app_document_worker;
GRANT INSERT(household_id,result_id,owner_id,item_id,obligation_id) ON document_result_reviews TO app_user;
GRANT UPDATE(state,result_ref) ON document_processing TO app_user;
CREATE FUNCTION app.guard_document_result() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE w record; c record; a record;
BEGIN
 IF current_user<>'app_document_worker' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT * INTO w FROM document_processing WHERE id=NEW.processing_id AND household_id=NEW.household_id;
 SELECT * INTO c FROM document_custodies WHERE id=w.custody_id AND household_id=NEW.household_id;
 SELECT a0.* INTO a FROM document_scan_attempts a0 JOIN document_scans s ON s.id=a0.scan_id AND s.household_id=a0.household_id
  WHERE a0.scan_id=c.scan_id AND a0.household_id=NEW.household_id AND s.state='clean' AND a0.verdict='clean' AND a0.completed_at IS NOT NULL ORDER BY a0.attempt DESC LIMIT 1;
 IF w.state NOT IN ('started','indeterminate') OR w.id IS NULL OR c.id IS NULL OR a.id IS NULL
  OR w.lease_token IS DISTINCT FROM NEW.lease_token OR c.sha256 IS DISTINCT FROM NEW.source_sha256
  OR c.state NOT IN ('ready','held') OR NEW.citation_end>c.size_bytes
  THEN RAISE EXCEPTION 'Result binding refused' USING ERRCODE='55000'; END IF;
 NEW.custody_id:=c.id; NEW.document_id:=c.document_id; NEW.scan_id:=c.scan_id; NEW.scan_attempt_id:=a.id; NEW.object_id:=c.object_id;
 NEW.engine_digest:=a.engine_digest; NEW.signature_digest:=a.signature_digest; NEW.sandbox_digest:=a.sandbox_digest;
 NEW.period_start:=w.period_start; NEW.period_end:=w.period_end; NEW.original_tier:=w.tier;
 NEW.original_catalog_version:=w.catalog_version; NEW.original_revision:=w.entitlement_revision;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER result_guard BEFORE INSERT ON document_results FOR EACH ROW EXECUTE FUNCTION app.guard_document_result();
CREATE FUNCTION app.guard_document_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE r record;
BEGIN
 IF current_user<>'app_user' THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 PERFORM 1 FROM household_users WHERE household_id=NEW.household_id AND user_id=NEW.owner_id AND role='owner' FOR SHARE;
 SELECT * INTO r FROM document_results WHERE id=NEW.result_id AND household_id=NEW.household_id;
 IF r.id IS NULL OR NEW.owner_id IS DISTINCT FROM app.current_user_id() OR NOT EXISTS(SELECT 1 FROM household_users WHERE household_id=NEW.household_id AND user_id=NEW.owner_id AND role='owner')
  OR NOT EXISTS(SELECT 1 FROM items i JOIN obligations o ON o.item_id=i.id AND o.household_id=i.household_id
   WHERE i.id=NEW.item_id AND o.id=NEW.obligation_id AND i.household_id=NEW.household_id
    AND i.source_document_id=r.document_id AND o.source_document_id=r.document_id
    AND i.attrs=jsonb_build_object('provenance',jsonb_build_object('resultId',r.id::text,'source','synthetic-reviewed','page',1,'start',r.citation_start,'end',r.citation_end))
    AND o.due_at=(r.due_date::timestamp AT TIME ZONE 'UTC') AND o.source='user' AND o.verified_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Cited owner review refused' USING ERRCODE='42501'; END IF;
 NEW.reviewed_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER result_review_guard BEFORE INSERT ON document_result_reviews FOR EACH ROW EXECUTE FUNCTION app.guard_document_review();
-- Ordinary app may ONLY commit reviewed completion, never reserve/start/release slots.
CREATE FUNCTION app.guard_reviewed_processing() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE r record; p record; rev integer; n bigint;
BEGIN
 IF current_user NOT IN ('app_user','app_document_worker') THEN RETURN NEW; END IF;
 IF current_user='app_document_worker' AND NEW.state<>'completed' THEN RETURN NEW; END IF;
 IF NEW.state<>'completed' OR OLD.state NOT IN ('started','indeterminate') THEN RAISE EXCEPTION 'Reviewed completion required' USING ERRCODE='55000'; END IF;
 PERFORM app.assert_household_open(NEW.household_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('processing-quota:'||NEW.household_id::text,0));
 SELECT a.* INTO r FROM document_results a JOIN document_result_reviews v ON v.result_id=a.id AND v.household_id=a.household_id
  JOIN household_users u ON u.household_id=v.household_id AND u.user_id=v.owner_id AND u.role='owner'
  WHERE a.id=NEW.result_ref AND a.household_id=NEW.household_id AND a.processing_id=OLD.id
   AND (current_user='app_document_worker' OR u.user_id=app.current_user_id());
 SELECT * INTO p FROM effective_plan WHERE household_id=NEW.household_id;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=NEW.household_id;
 SELECT count(*) INTO n FROM document_processing WHERE household_id=NEW.household_id AND id<>OLD.id AND period_start=OLD.period_start AND state IN ('reserved','started','indeterminate','completed');
 IF r.id IS NULL OR r.period_start IS DISTINCT FROM OLD.period_start OR OLD.period_start IS DISTINCT FROM (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  OR clock_timestamp()>=OLD.period_end OR p.tier IS NULL OR n>=p.documents_per_month
  OR NOT EXISTS(SELECT 1 FROM document_custodies WHERE id=OLD.custody_id AND household_id=NEW.household_id AND state='ready' AND review_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Reviewed result authority unavailable' USING ERRCODE='55000'; END IF;
 IF current_user='app_user' THEN
  NEW.tier:=p.tier; NEW.catalog_version:=p.version; NEW.entitlement_revision:=rev; NEW.limit_snapshot:=p.documents_per_month;
  NEW.lease_until:=least(clock_timestamp()+interval '90 seconds',OLD.period_end); NEW.charged_at:=clock_timestamp(); NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_processing_guard BEFORE UPDATE ON document_processing FOR EACH ROW EXECUTE FUNCTION app.guard_reviewed_processing();
-- Existing deferred check also covers owner completion, including outbox/expiry.
CREATE OR REPLACE FUNCTION app.check_processing_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
DECLARE p record; r record; rev integer;
BEGIN
 IF current_user NOT IN ('app_document_worker','app_user') THEN RETURN NEW; END IF;
 SELECT * INTO r FROM document_processing WHERE id=NEW.id AND household_id=NEW.household_id;
 IF r.state NOT IN ('reserved','started','completed') THEN RETURN NEW; END IF;
 PERFORM app.assert_household_open(r.household_id);
 SELECT * INTO p FROM effective_plan WHERE household_id=r.household_id;
 SELECT coalesce(max(revision),0) INTO rev FROM stripe_test_states WHERE household_id=r.household_id;
 IF r.lease_until<=clock_timestamp() OR clock_timestamp()>=r.period_end
  OR (r.tier,r.catalog_version,r.entitlement_revision,r.limit_snapshot) IS DISTINCT FROM (p.tier,p.version,rev,p.documents_per_month)
  OR NOT EXISTS(SELECT 1 FROM document_custodies WHERE id=r.custody_id AND household_id=r.household_id AND state='ready' AND review_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Processing commit authority lost' USING ERRCODE='55000'; END IF;
 IF r.state='completed' AND (SELECT count(*) FROM outbox_events e JOIN document_custodies c ON c.document_id=e.aggregate_id AND c.household_id=e.household_id WHERE c.id=r.custody_id AND c.household_id=r.household_id AND e.event_type='document.processed' AND e.payload=jsonb_build_object('processing_id',r.id::text))<>1 THEN RAISE EXCEPTION 'Processing result intent missing' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE deletion_resources DROP CONSTRAINT inventory_source_pair;
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts','auth-challenges','stripe-bindings','stripe-notices','stripe-states','stripe-intents','export-artifacts','custodies','processing','results','result-reviews')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1)) NOT VALID;
ALTER TABLE deletion_resources VALIDATE CONSTRAINT inventory_source_pair;
CREATE FUNCTION app.check_document_review_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user='app_user' AND NOT EXISTS(SELECT 1 FROM document_processing w
 JOIN document_results r ON r.processing_id=w.id AND r.household_id=w.household_id
 JOIN items i ON i.id=NEW.item_id AND i.household_id=r.household_id
 JOIN obligations o ON o.id=NEW.obligation_id AND o.household_id=r.household_id AND o.item_id=i.id
 WHERE r.id=NEW.result_id AND r.household_id=NEW.household_id AND w.state='completed' AND w.result_ref=r.id
 AND i.source_document_id=r.document_id AND o.source_document_id=r.document_id
 AND i.attrs=jsonb_build_object('provenance',jsonb_build_object('resultId',r.id::text,'source','synthetic-reviewed','page',1,'start',r.citation_start,'end',r.citation_end))
 AND o.due_at=(r.due_date::timestamp AT TIME ZONE 'UTC') AND o.source='user' AND o.verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Review charge commit missing' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER review_commit AFTER INSERT ON document_result_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_document_review_commit();
REVOKE ALL ON FUNCTION app.check_document_review_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guard_document_result(),app.guard_document_review(),app.guard_reviewed_processing() FROM PUBLIC;
COMMIT;
