-- Local proposal: only after separately approved reason-aware runtime verification.
-- Keep required-reason constraint, all historical rows, RLS, guards and grants intact.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.document_period_decisions'::regclass
 AND conname='document_rejection_reason_valid' AND contype='c') THEN
 RAISE EXCEPTION 'Reason enforcement missing'; END IF;
END $$;
ALTER TABLE document_period_decisions DROP CONSTRAINT document_rejection_rollout_paused;
COMMIT;
