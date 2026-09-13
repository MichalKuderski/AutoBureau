-- Index the user FK for account deletion and recipient lookup. The preceding
-- expansion creates this table empty, so this index is built before ingestion.
-- Lock: SHARE on the new notifications table; existing household tables untouched.
-- At 100k households / 3M notices, budget roughly 100MB for this UUID btree.
-- Rollback: keep this additive index when reverting application code; dropping it
-- later affects performance only and must not be bundled with data deletion.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
COMMIT;
