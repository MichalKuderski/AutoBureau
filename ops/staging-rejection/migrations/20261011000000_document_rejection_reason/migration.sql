-- Owner decision 2026-10-11: discard is rejection with a short reason category.
-- Existing immutable decisions stay truthful; do not invent reasons for historical rows.
-- Metadata-only nullable column and NOT VALID constraint: no table rewrite or scan.
-- Brief ACCESS EXCLUSIVE lock, bounded to 5s; retries belong to the deploy operator.
-- At 100k households the existing journal size does not affect the metadata operation.
-- Rollback: unmount new discard writes first; retain column/reasons for audit. Old clients
-- fail closed on missing reason. Never drop existing decision/accounting evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE document_period_decisions ADD COLUMN rejection_reason text;
ALTER TABLE document_period_decisions ADD CONSTRAINT document_rejection_reason_valid CHECK (
 (decision='discard' AND rejection_reason IS NOT NULL AND rejection_reason IN
  ('incorrect-reading','wrong-document','duplicate','not-needed','other'))
 OR (decision='apply-current-period' AND rejection_reason IS NULL)
) NOT VALID;
GRANT INSERT(rejection_reason) ON document_period_decisions TO app_user;
COMMIT;
