import { z } from "zod";
import { DELETION_COMPONENTS } from "./deletion-evidence.js";
const id = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ScanRegistrationSchema = z.object({ documentId: id, sealId: id, sha256: digest,
  size: z.number().int().min(1).max(25 * 1024 * 1024) }).strict();
export const ScannerReleaseSchema = z.object({ engine: digest, signatures: digest, sandbox: digest }).strict();
export const JournalScanResultSchema = z.object({ nonce: id, sha256: digest,
  verdict: z.enum(["clean", "rejected", "indeterminate", "scanner-error"]),
  failure: z.enum(["none", "malware", "unsupported", "malformed", "timeout", "resource", "binding", "unavailable"]),
}).strict().refine(v => (v.verdict === "clean") === (v.failure === "none"));
export const DeletionManifestSchema = z.array(z.object({ component: z.enum(DELETION_COMPONENTS),
  resourceRef: id, inventoryCount: z.number().int().min(0).max(1_000_000) }).strict()).min(1).max(250)
  .refine(rows => new Set(rows.map(row => `${row.component}:${row.resourceRef.toLowerCase()}`)).size === rows.length,
    "Duplicate manifest resource");
export const SyntheticAbsenceSchema = z.object({ evidenceId: id, state: z.enum(["absent", "remaining", "unknown", "retained"]),
  remaining: z.number().int().min(0).max(1_000_000), retentionUntil: z.string().datetime().optional(),
}).strict().refine(v => v.state !== "absent" || (v.remaining === 0 && v.retentionUntil === undefined));
export type ScanRegistration = z.infer<typeof ScanRegistrationSchema>;

export type ScannerRelease = z.infer<typeof ScannerReleaseSchema>;
