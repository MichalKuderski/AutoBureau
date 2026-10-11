import { createHash } from "node:crypto";
import { canonicalDeadlinePdf } from "@autobureau/contracts";

/** Reconstruct the existing PUBLIC synthetic grammar, never parse arbitrary input.
 * Equality to the immutable source hash proves these exact canonical bytes, not
 * current retained-object availability or the meaning of a real document. */
export function canonicalResultEvidence(row: {
  due_date: Date | null; source_sha256: Uint8Array | null; source_size: number | null;
  page: number | null; citation_start: number | null; citation_end: number | null;
}) {
  if (!row.due_date || !row.source_sha256) return null;
  try {
    const dueDate = row.due_date.toISOString().slice(0, 10);
    const pdf = canonicalDeadlinePdf(dueDate), start = pdf.indexOf(`(Due: ${dueDate})`) + 6;
    if (row.page !== 1 || row.citation_start !== start || row.citation_end !== start + 10
      || row.source_size !== Buffer.byteLength(pdf)
      || !createHash("sha256").update(pdf).digest().equals(Buffer.from(row.source_sha256))) return null;
    // No raw offsets, hash, storage reference, lease or scan internals cross HTTP.
    // The UI highlights the date in this known text, not at PDF-byte coordinates.
    return { kind: "public-synthetic-deadline" as const, dueDate, page: 1 as const };
  } catch { return null; }
}
