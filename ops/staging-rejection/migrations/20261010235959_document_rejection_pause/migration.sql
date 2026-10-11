-- Local proposal: separately approved pause and drain, never an application flag.
-- Metadata-only, no backfill; historical rows intentionally remain unvalidated.
-- ACCESS EXCLUSIVE drains earlier journal writers before commit (5-second lock bound).
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE document_period_decisions ADD CONSTRAINT document_rejection_rollout_paused
 CHECK (decision <> 'discard') NOT VALID;
COMMIT;
