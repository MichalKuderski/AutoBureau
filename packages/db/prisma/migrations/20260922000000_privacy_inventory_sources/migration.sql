BEGIN;
-- Local-only inventory cursor: manifests themselves are the durable checkpoint.
-- Nullable columns preserve historical aggregate manifests. No payloads are added.
-- At 100k households x 100 local resources: ~10m entries. Two short source/key
-- columns plus unique B-tree can add roughly 1-2GB (estimate, not measured).
-- ADD COLUMN without a default is catalog-only; unique-index build scans existing
-- manifests and blocks writes. Hosted apply needs measured size/maintenance review.
-- Rollback: disable inventory invocation; keep manifested evidence, then remove only
-- this index/check/columns if required. Never drop deletion fences or journals.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE deletion_resources ADD COLUMN inventory_source varchar(32), ADD COLUMN source_key varchar(40);
ALTER TABLE deletion_resources ADD CONSTRAINT inventory_source_pair CHECK (
 (inventory_source IS NULL AND source_key IS NULL) OR
 (inventory_source IS NOT NULL AND inventory_source IN ('documents','uploads','chunks','items','secrets','obligations','reminders','notifications','notification-deliveries','outbox','deliveries','inbox','scans','scan-attempts')
  AND source_key IS NOT NULL AND source_key ~ '^[a-f0-9-]{1,40}$' AND inventory_count=1));
CREATE UNIQUE INDEX deletion_resources_source_key_key ON deletion_resources(deletion_id,inventory_source,source_key);
GRANT SELECT(id,household_id) ON outbox_events,job_deliveries,job_inbox TO app_retention_worker;
COMMIT;
