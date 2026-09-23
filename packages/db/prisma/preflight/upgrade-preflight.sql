-- READ-ONLY upgrade preflight. Run against the target BEFORE `prisma migrate deploy`.
-- Several migrations refuse data they cannot safely convert. When that happens mid-chain,
-- Prisma reports only "current transaction is aborted", the chain stops part-way, the
-- failed migration must be resolved by hand, and the database is left at a schema no
-- build targets. This check surfaces every such precondition up front, by name.
-- It issues one SELECT, takes no locks beyond ordinary reads and changes nothing.
--
-- Registered data refusals (a control test requires every such migration to be listed):
--   20260924000000_dedicated_test_billing  existing TEST billing notices/states
--   20260925000000_processing_custody      any documents or nonzero legacy docs_used_this_period
-- Registered role creations (an existing role of the same name stops the chain):
--   20260913000000_job_delivery_inbox          app_job_worker
--   20260920000000_document_security_journals  app_document_worker, app_retention_worker, app_deletion_verifier
--   20260924000000_dedicated_test_billing      app_billing_test
--   20260927000000_local_plaid_exchange        app_plaid_sandbox
WITH applied AS (
  SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
), pending(name) AS (
  SELECT m FROM unnest(ARRAY['20260913000000_job_delivery_inbox','20260920000000_document_security_journals',
    '20260924000000_dedicated_test_billing','20260925000000_processing_custody','20260927000000_local_plaid_exchange']) m
  WHERE m NOT IN (SELECT migration_name FROM applied)
), role_owner(role,migration) AS (VALUES
  ('app_job_worker','20260913000000_job_delivery_inbox'),('app_document_worker','20260920000000_document_security_journals'),
  ('app_retention_worker','20260920000000_document_security_journals'),('app_deletion_verifier','20260920000000_document_security_journals'),
  ('app_billing_test','20260924000000_dedicated_test_billing'),('app_plaid_sandbox','20260927000000_local_plaid_exchange')
), counts AS (
  SELECT
   (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished,
   (SELECT count(*) FROM applied) AS applied,
   CASE WHEN to_regclass('public.documents') IS NULL THEN 0 ELSE (xpath('/row/c/text()',query_to_xml('SELECT count(*) AS c FROM public.documents',false,true,'')))[1]::text::bigint END AS documents,
   CASE WHEN to_regclass('public.entitlements') IS NULL THEN 0 ELSE (xpath('/row/c/text()',query_to_xml('SELECT count(*) AS c FROM public.entitlements WHERE docs_used_this_period<>0',false,true,'')))[1]::text::bigint END AS legacy_usage,
   CASE WHEN to_regclass('public.stripe_test_notices') IS NULL THEN 0 ELSE (xpath('/row/c/text()',query_to_xml('SELECT (SELECT count(*) FROM public.stripe_test_notices)+(SELECT count(*) FROM public.stripe_test_states) AS c',false,true,'')))[1]::text::bigint END AS billing_journals
), blocking AS (
  SELECT 'unfinished or failed migration rows must be resolved first' AS reason FROM counts WHERE unfinished>0
  UNION ALL SELECT '20260925000000_processing_custody: documents present ('||documents||')' FROM counts,pending p WHERE p.name='20260925000000_processing_custody' AND documents>0
  UNION ALL SELECT '20260925000000_processing_custody: nonzero legacy usage ('||legacy_usage||' entitlements)' FROM counts,pending p WHERE p.name='20260925000000_processing_custody' AND legacy_usage>0
  UNION ALL SELECT '20260924000000_dedicated_test_billing: TEST billing journals present ('||billing_journals||')' FROM counts,pending p WHERE p.name='20260924000000_dedicated_test_billing' AND billing_journals>0
  UNION ALL SELECT r.migration||': role '||r.role||' already exists' FROM role_owner r JOIN pending p ON p.name=r.migration WHERE EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r.role)
)
SELECT jsonb_build_object(
  'appliedMigrations',(SELECT applied FROM counts),
  'pendingRegisteredMigrations',(SELECT coalesce(jsonb_agg(name ORDER BY name),'[]') FROM pending),
  'documents',(SELECT documents FROM counts),'legacyUsageNonzero',(SELECT legacy_usage FROM counts),'testBillingJournals',(SELECT billing_journals FROM counts),
  'blocking',(SELECT coalesce(jsonb_agg(reason ORDER BY reason),'[]') FROM blocking),
  'ok',NOT EXISTS(SELECT 1 FROM blocking)
);
