-- Export v3: the publication journal also records integrity-bound archive artifacts
-- (originals + JSONL + manifest). Format and completeness are immutable once written
-- (app_user has no UPDATE on them); only an archive may claim completeness, and the
-- builder sets it only when no in-scope category or original is missing. Constant
-- defaults and constraint swaps only; existing rows remain 'jsonl-v2', partial.
-- 5s lock / 60s statement. Rollback: stop the v3 builder; v2 rows stay valid.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE local_export_artifacts
 ADD COLUMN format text NOT NULL DEFAULT 'jsonl-v2' CHECK(format IN ('jsonl-v2','archive-v3')),
 ADD COLUMN complete boolean NOT NULL DEFAULT false;
ALTER TABLE local_export_artifacts DROP CONSTRAINT local_export_artifacts_size_bytes_check;
ALTER TABLE local_export_artifacts ADD CONSTRAINT local_export_artifacts_size_bytes_check
 CHECK((format='jsonl-v2' AND size_bytes BETWEEN 1 AND 4194304) OR (format='archive-v3' AND size_bytes BETWEEN 1 AND 629145600));
ALTER TABLE local_export_artifacts ADD CONSTRAINT export_complete_requires_archive CHECK(NOT complete OR format='archive-v3');
GRANT INSERT(format,complete),SELECT(format,complete) ON local_export_artifacts TO app_user;
COMMIT;
