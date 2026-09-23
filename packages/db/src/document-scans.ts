import { randomUUID } from "node:crypto";
import { JournalScanResultSchema, ScannerReleaseSchema, type ScannerRelease, ScanRegistrationSchema } from "@autobureau/contracts";
import { recordAudit, runAsSystem } from "./audit.js";
import { outbox } from "./outbox.js";
import type { Database, ScopedClient } from "./scoped.js";

export class DocumentJournalError extends Error {
  constructor(readonly code: "invalid" | "binding" | "unavailable") { super(`Document journal: ${code}`); }
}
interface ScanRow { id: string; household_id: string; document_id: string; seal_id: string; sha256: Uint8Array;
  size_bytes: number; state: string; attempts: number; lease_token: string | null; lease_until: Date | null }
const key = (row: { household_id: string; document_id: string; seal_id: string }) => `hh/${row.household_id}/upload/${row.document_id}/sealed/${row.seal_id}`;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const now = async (tx: ScopedClient) => (await tx.$queryRaw<Array<{ at: Date }>>`SELECT clock_timestamp() AS at`)[0]!.at;
export async function assertDocumentWorkOpen(tx: ScopedClient, householdId: string) {
  await tx.$executeRaw`SELECT app.assert_household_open(${householdId}::uuid)`;
}
export async function registerDocumentScan(db: Database, householdId: string, input: unknown) {
  const parsed = ScanRegistrationSchema.safeParse(input); if (!parsed.success) throw new DocumentJournalError("invalid");
  const value = parsed.data, hash = Buffer.from(value.sha256, "hex");
  return runAsSystem("Register immutable quarantined document snapshot", () => db.withHousehold(householdId, async tx => {
    await assertDocumentWorkOpen(tx, householdId);
    const [doc] = await tx.$queryRaw<Array<{ storage_path: string; sha256: Uint8Array | null; size_bytes: bigint; status: string }>>`
      SELECT storage_path,sha256,size_bytes,status FROM documents WHERE id=${value.documentId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
    if (!doc || doc.status !== "scanning" || Number(doc.size_bytes) !== value.size
      || doc.storage_path !== key({ household_id: householdId, document_id: value.documentId, seal_id: value.sealId })
      || (doc.sha256 && hex(doc.sha256) !== value.sha256)) throw new DocumentJournalError("binding");
    if (!doc.sha256) {
      await tx.$executeRaw`UPDATE documents SET sha256=${hash},updated_at=clock_timestamp() WHERE id=${value.documentId}::uuid AND household_id=${householdId}::uuid`;
      await recordAudit(tx, "document.scan_registered", { type: "document", id: value.documentId });
    }
    await tx.$executeRaw`INSERT INTO document_scans(household_id,document_id,seal_id,sha256,size_bytes)
      VALUES(${householdId}::uuid,${value.documentId}::uuid,${value.sealId}::uuid,${hash},${value.size}) ON CONFLICT(document_id,seal_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<ScanRow[]>`SELECT * FROM document_scans WHERE document_id=${value.documentId}::uuid AND seal_id=${value.sealId}::uuid AND household_id=${householdId}::uuid`;
    if (!row || hex(row.sha256) !== value.sha256 || row.size_bytes !== value.size) throw new DocumentJournalError("binding");
    return row.id;
  }));
}
async function boundDocument(tx: ScopedClient, row: ScanRow) {
  const [doc] = await tx.$queryRaw<Array<{ matches: boolean }>>`SELECT (status='scanning' AND storage_path=${key(row)} AND sha256=${row.sha256} AND size_bytes=${row.size_bytes}) AS matches
    FROM documents WHERE id=${row.document_id}::uuid AND household_id=${row.household_id}::uuid`;
  return doc?.matches === true;
}
async function documentState(tx: ScopedClient, row: ScanRow, state: "queued" | "rejected" | "failed") {
  await tx.$executeRaw`UPDATE documents SET status=${state}::"DocStatus",updated_at=clock_timestamp()
    WHERE id=${row.document_id}::uuid AND household_id=${row.household_id}::uuid AND storage_path=${key(row)} AND sha256=${row.sha256}`;
  await recordAudit(tx, "document.scan_transitioned", { type: "document", id: row.document_id });
  await outbox(tx).emit({ event_type: state === "queued" ? "document.scanned" : "document.failed", aggregate_type: "document", aggregate_id: row.document_id, household_id: row.household_id });
}
export interface DocumentScanClaim { scanId: string; nonce: string; attempt: number; documentId: string; sha256: string; size: number; sealId: string; release: ScannerRelease }
export async function claimDocumentScan(db: Database, householdId: string, scanId: string, releaseInput: unknown): Promise<DocumentScanClaim | null> {
  const release = ScannerReleaseSchema.safeParse(releaseInput); if (!release.success) throw new DocumentJournalError("invalid");
  return runAsSystem("Claim one isolated scanner attempt", () => db.withHousehold(householdId, async tx => {
    await assertDocumentWorkOpen(tx, householdId);
    const [row] = await tx.$queryRaw<ScanRow[]>`SELECT * FROM document_scans WHERE id=${scanId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
    if (!row || !["queued", "scanning"].includes(row.state) || (row.lease_until && row.lease_until > await now(tx))) return null;
    if (row.lease_token) await tx.$executeRaw`UPDATE document_scan_attempts SET completed_at=clock_timestamp(),verdict='scanner-error',failure='lease-expired'
      WHERE scan_id=${row.id}::uuid AND household_id=${householdId}::uuid AND nonce=${row.lease_token}::uuid AND completed_at IS NULL`;
    if (!await boundDocument(tx, row) || row.attempts >= 3) {
      const state = await boundDocument(tx, row) ? "exhausted" : "superseded";
      await tx.$executeRaw`UPDATE document_scans SET state=${state},completed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE id=${row.id}::uuid AND household_id=${householdId}::uuid`;
      if (state === "exhausted") await documentState(tx, row, "failed");
      return null;
    }
    const nonce = randomUUID(), attempt = row.attempts + 1;
    await tx.$executeRaw`UPDATE document_scans SET state='scanning',attempts=${attempt},lease_token=${nonce}::uuid,
      lease_until=clock_timestamp()+interval '90 seconds' WHERE id=${row.id}::uuid AND household_id=${householdId}::uuid`;
    await tx.$executeRaw`INSERT INTO document_scan_attempts(scan_id,household_id,attempt,nonce,engine_digest,signature_digest,sandbox_digest)
      VALUES(${row.id}::uuid,${householdId}::uuid,${attempt},${nonce}::uuid,${release.data.engine},${release.data.signatures},${release.data.sandbox})`;
    return { scanId: row.id, nonce, attempt, documentId: row.document_id, sha256: hex(row.sha256), size: row.size_bytes, sealId: row.seal_id, release: Object.freeze(release.data) };
  }));
}
export async function completeDocumentScan(db: Database, householdId: string, scanId: string, resultInput: unknown) {
  const parsed = JournalScanResultSchema.safeParse(resultInput); if (!parsed.success) throw new DocumentJournalError("invalid");
  const result = parsed.data;
  return runAsSystem("Record one bound scanner verdict", () => db.withHousehold(householdId, async tx => {
    // Same ordering as deletion activation and all domain writes; no network under lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${householdId}`},0))`;
    const [row] = await tx.$queryRaw<ScanRow[]>`SELECT * FROM document_scans WHERE id=${scanId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
    if (!row || row.state !== "scanning" || row.lease_token !== result.nonce || !row.lease_until || row.lease_until <= await now(tx)) return "lease-lost" as const;
    if (hex(row.sha256) !== result.sha256) return "binding-refused" as const;
    const fenced = await tx.householdDeletion.count({ where: { householdId, state: { in: ["fenced", "verifying", "completed"] } } });
    const bound = await boundDocument(tx, row);
    const verdict = fenced || !bound ? "scanner-error" : result.verdict;
    const failure = fenced ? "deletion" : !bound ? "binding" : result.failure;
    await tx.$executeRaw`UPDATE document_scan_attempts SET verdict=${verdict},failure=${failure},completed_at=clock_timestamp()
      WHERE scan_id=${row.id}::uuid AND household_id=${householdId}::uuid AND nonce=${result.nonce}::uuid AND completed_at IS NULL`;
    const state = fenced ? "cancelled" : !bound ? "superseded" : verdict === "clean" ? "clean" : verdict === "rejected" ? "rejected" : row.attempts >= 3 ? "exhausted" : "queued";
    await tx.$executeRaw`UPDATE document_scans SET state=${state},lease_token=NULL,lease_until=NULL,
      completed_at=CASE WHEN ${state}='queued' THEN NULL ELSE clock_timestamp() END WHERE id=${row.id}::uuid AND household_id=${householdId}::uuid`;
    if (state === "clean") await documentState(tx, row, "queued");
    if (state === "rejected" || state === "exhausted") await documentState(tx, row, state === "rejected" ? "rejected" : "failed");
    return state;
  }));
}
