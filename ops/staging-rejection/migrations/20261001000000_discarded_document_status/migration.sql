-- PRD §21.3: an owner-discarded reading leaves the review queue without implying it was
-- filed ("processed") or failed. Additive enum label; no row rewrite/backfill. 5s lock
-- bound. Rollback leaves the label (enum labels cannot be dropped) and all journals intact.
SET lock_timeout='5s';
ALTER TYPE "DocStatus" ADD VALUE 'discarded';
RESET lock_timeout;
