import { createHash } from "node:crypto";
import { claimDocumentScan, completeDocumentScan, type Database } from "@autobureau/db";
import { scanQuarantinedSnapshot, type ScannerPort } from "./scan-boundary";

/** Trusted broker port, outside the hostile scanner. IDs come only from a DB claim;
 * no URL, filename or caller-provided object key is accepted. Adapter activation is
 * deliberately absent. A hosted loader must stream with a 25 MiB enforced cap. */
export interface SealedSnapshotPort {
  load(identity: Readonly<{ documentId: string; sealId: string; size: number }>, signal: AbortSignal): Promise<Uint8Array>;
}
/** One local invocation, never a scheduler. DB claim/completion surround (but do
 * not contain) I/O. The 90s journal lease covers 5s load + 40s scan + 5s sandbox
 * cleanup + bounded DB work/margin; no clock supplied by the caller is authoritative. */
export async function runDocumentScanOnce(db: Database, householdId: string, scanId: string,
  release: unknown, snapshots: SealedSnapshotPort, scanner: ScannerPort, declaredType: unknown) {
  const claim = await claimDocumentScan(db, householdId, scanId, release);
  if (!claim) return "not-claimed" as const;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let verdict: "clean" | "rejected" | "indeterminate" | "scanner-error" = "scanner-error";
  let failure: "none" | "malformed" | "binding" | "unavailable" = "unavailable";
  try {
    const bytes = await Promise.race([
      Promise.resolve().then(() => snapshots.load(Object.freeze({ documentId: claim.documentId, sealId: claim.sealId, size: claim.size }), controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("snapshot deadline")); }, 5000); })
    ]);
    clearTimeout(timer); controller.abort();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== claim.size
      || createHash("sha256").update(bytes).digest("hex") !== claim.sha256) failure = "binding";
    else {
      const result = await scanQuarantinedSnapshot(bytes, declaredType, scanner, { nonce: claim.nonce, release: claim.release });
      verdict = result.verdict; failure = verdict === "clean" ? "none" : "malformed";
    }
  } catch { /* Closed failure only; no upstream message, bytes or metadata escapes. */ }
  finally { clearTimeout(timer); controller.abort(); }
  return completeDocumentScan(db, householdId, scanId, { nonce: claim.nonce, sha256: claim.sha256, verdict, failure });
}
