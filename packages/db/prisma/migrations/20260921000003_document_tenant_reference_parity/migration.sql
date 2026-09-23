BEGIN;
-- RLS does not enforce tenant parity across FK relationships. Keep the existing
-- single-column referential actions; add SQL-owned composite integrity checks.
-- No row is repaired/deleted. Existing mismatches make this transaction fail.
-- The unique indexes below are also represented in schema.prisma.
-- DEFERRABLE / initially immediate NO ACTION checks run at statement completion,
-- after the original CASCADE / SET NULL actions, preserving valid API behavior.
-- LOCAL ONLY. Index builds and FK validation scan tables and block writes while
-- this transaction holds DDL locks. A hosted apply needs a fresh mismatch/count
-- inventory, measured lock budget, maintenance approval and bounded lock_timeout.
-- At 100k households, size depends on records per household: an illustrative
-- 1m documents + 1m items + 2m obligations adds three UUID-pair indexes, roughly
-- 240-400 MB total at 60-100 bytes/index entry, not a measured capacity promise.
-- Rollback: disable erasure first; remove only these checks/indexes if required.
-- Never enable erasure again without equivalent parity checks; preserve fences.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE UNIQUE INDEX documents_id_household_id_key ON documents(id,household_id);
CREATE UNIQUE INDEX items_id_household_id_key ON items(id,household_id);
CREATE UNIQUE INDEX obligations_id_household_id_key ON obligations(id,household_id);
ALTER TABLE document_chunks ADD CONSTRAINT document_chunks_tenant_document_fk
 FOREIGN KEY(document_id,household_id) REFERENCES documents(id,household_id)
 DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE items ADD CONSTRAINT items_tenant_source_document_fk
 FOREIGN KEY(source_document_id,household_id) REFERENCES documents(id,household_id)
 DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE obligations ADD CONSTRAINT obligations_tenant_item_fk
 FOREIGN KEY(item_id,household_id) REFERENCES items(id,household_id)
 DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE reminders ADD CONSTRAINT reminders_tenant_obligation_fk
 FOREIGN KEY(obligation_id,household_id) REFERENCES obligations(id,household_id)
 DEFERRABLE INITIALLY IMMEDIATE;
COMMIT;
