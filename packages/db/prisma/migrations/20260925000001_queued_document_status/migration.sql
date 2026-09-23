-- ADR-021: scan-clean is queued, never processing authority. Additive enum label;
-- no row rewrite/backfill. 5s lock bound; rollback leaves label and journals intact.
SET lock_timeout='5s';
ALTER TYPE "DocStatus" ADD VALUE 'queued';
RESET lock_timeout;
