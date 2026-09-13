-- Existing households principal-read RLS references household_users. PostgreSQL
-- checks the referenced table's privilege even when the principal branch is false.
-- Read-only, still forced tenant RLS; no member mutation or BYPASSRLS grant.
-- Metadata grant only, no table rewrite or growth. Rollback: keep while the worker
-- exists; revoke when worker use is disabled. No hosted apply is implicit.
BEGIN;
SET LOCAL lock_timeout = '5s';
GRANT SELECT ON household_users TO app_job_worker;
COMMIT;
