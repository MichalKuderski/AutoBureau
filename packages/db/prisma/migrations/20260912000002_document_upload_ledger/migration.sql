-- Expand: a content hash is unknown before actual bytes are read. Existing non-null
-- hashes and their tenant uniqueness remain unchanged; multiple pending NULLs are valid.
-- Lock impact: brief ACCESS EXCLUSIVE metadata lock on documents; no heap rewrite.
-- New ledger/FK/indexes start empty. Fail after 5s of lock waiting.
-- At 100k households, 30 live uploads/household would mean 3M rows, roughly 1-2GB
-- including path/expiry indexes. Retention must remove abandoned capabilities.
-- Rollback: deploy old application, leave expansion in place. Do not restore NOT NULL
-- while pending NULL hashes exist and do not invent hashes to satisfy rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE documents ALTER COLUMN sha256 DROP NOT NULL;
CREATE TABLE document_uploads (
  document_id UUID NOT NULL,
  object_key VARCHAR(300) NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  completed_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_uploads_pkey PRIMARY KEY (document_id),
  CONSTRAINT document_uploads_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT document_uploads_expiry_after_issue CHECK (expires_at > created_at),
  CONSTRAINT document_uploads_completion_after_issue CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE UNIQUE INDEX document_uploads_object_key_key ON document_uploads(object_key);
CREATE INDEX document_uploads_expires_at_idx ON document_uploads(expires_at);
ALTER TABLE document_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY document_upload_household ON document_uploads FOR ALL USING (
  EXISTS (SELECT 1 FROM documents d WHERE d.id = document_uploads.document_id AND d.household_id = app.current_household())
) WITH CHECK (
  EXISTS (SELECT 1 FROM documents d WHERE d.id = document_uploads.document_id AND d.household_id = app.current_household())
);
REVOKE ALL ON document_uploads FROM PUBLIC, app_user;
GRANT SELECT, INSERT ON document_uploads TO app_user;
GRANT UPDATE (completed_at) ON document_uploads TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_uploads TO app_dispatcher;
COMMIT;
