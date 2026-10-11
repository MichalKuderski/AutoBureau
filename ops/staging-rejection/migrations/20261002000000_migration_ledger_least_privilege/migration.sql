-- Runtime roles lose all authority over Prisma's migration ledger.
--
-- 20260728000001_rls granted SELECT/INSERT/UPDATE/DELETE ON ALL TABLES IN SCHEMA public to
-- app_user and app_dispatcher. Prisma creates `_prisma_migrations` before the first migration
-- runs, so the ledger was swept into that grant. No runtime path reads or writes it: deploys,
-- the upgrade preflight and the staging scripts all run as the migration owner. A runtime role
-- that can write the ledger can mark a pending security migration as applied, and
-- `migrate deploy` would then skip it without an error.
--
-- LOCK IMPACT: one catalog ACL update on a small table; no row scan or rewrite. 5s/30s bounds.
-- TABLE SIZE AT 100k HOUSEHOLDS: unchanged (the ledger grows by migration, not by tenant).
-- ROLLBACK: nothing in the application needs these privileges; do not restore runtime
--   authority over the ledger as a rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM app_user, app_dispatcher;
COMMIT;
