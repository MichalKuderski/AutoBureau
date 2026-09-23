-- Local authority hardening: temporary tables cannot shadow trusted journal/plan reads.
-- Metadata-only; no tenant-row rewrite. 5s lock/60s statement bounds.
-- Rollback disables callers; removing this boundary would restore a proven bypass.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ DECLARE signature text; target regprocedure; cfg text[]; definer boolean;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'app.assert_billing_atomic_commit()',
  'app.assert_household_open (uuid)',
  'app.assert_member_allowance_commit()',
  'app.audit_security_journal()',
  'app.check_document_result_intent()',
  'app.check_document_review_commit()',
  'app.check_plaid_local_commit()',
  'app.check_processing_commit()',
  'app.guard_account_challenge()',
  'app.guard_billing_publication()',
  'app.guard_clean_custody()',
  'app.guard_custodied_source()',
  'app.guard_deletion_attempt()',
  'app.guard_deletion_observation()',
  'app.guard_deletion_request()',
  'app.guard_deletion_resource()',
  'app.guard_delivery_erasure()',
  'app.guard_document_result()',
  'app.guard_document_review()',
  'app.guard_household_write()',
  'app.guard_local_export_artifact()',
  'app.guard_member_allowance()',
  'app.guard_plaid_effect()',
  'app.guard_plaid_local()',
  'app.guard_processing()',
  'app.guard_reviewed_processing()',
  'app.guard_scan_journal()',
  'app.guard_stripe_test_binding()',
  'app.guard_stripe_test_notice()',
  'app.guard_stripe_test_state()'
 ] LOOP
  target:=to_regprocedure(signature);
  IF target IS NULL THEN RAISE EXCEPTION 'Runtime guard missing';END IF;
  SELECT proconfig,prosecdef INTO cfg,definer FROM pg_proc WHERE oid=target;
  IF definer OR cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, app']::text[] THEN RAISE EXCEPTION 'Runtime guard configuration drift';END IF;
  EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog,public,app,pg_temp',target);
 END LOOP;
END $$;
COMMIT;
