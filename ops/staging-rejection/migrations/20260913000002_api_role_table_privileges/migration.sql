-- Live staging inspection found residual Supabase default TRUNCATE/REFERENCES/
-- TRIGGER grants after earlier CRUD revocations. TRUNCATE is not filtered by RLS.
-- The application uses app_user, never the provider's anon/authenticated/service_role
-- for these public tables. Remove all provider-role table privileges and prevent
-- the migration owner's defaults from reintroducing them on future tables.
-- Lock impact: bounded catalog ACL updates, no row scan/rewrite, zero growth at
-- 100k households. Rollback: app_user is unchanged; do not restore unnecessary
-- provider authority as a rollback. No hosted or Production apply is implicit.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $revoke_api_tables$
DECLARE
 api_role text;
 app_table text;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
   FOREACH app_table IN ARRAY ARRAY[
    '_prisma_migrations','users','user_profiles','households','household_users',
    'household_members','vendors','documents','document_chunks','document_uploads',
    'items','item_secrets','obligations','reminders','inbound_emails','entitlements',
    'audit_log','outbox_events','idempotency_keys','auth_rate_limits','notifications',
    'notification_preferences','notification_deliveries','job_deliveries','job_inbox'
   ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',app_table,api_role);
   END LOOP;
   EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',api_role);
  END IF;
 END LOOP;
END
$revoke_api_tables$;
COMMIT;
