import { createHash } from "node:crypto";
import { z } from "zod";
import { isVerifiedScan } from "./scan-boundary";

// Public literal fixture only. NOT a redactor, OCR parser or format detector.
export const PUBLIC_REVIEW_FIXTURE = "%PDF-1.7\nPELLUM PUBLIC SYNTHETIC FIXTURE\ndue_date=2026-10-01\n%%EOF";
const contextSchema = z.object({ documentId: z.string().uuid(), householdId: z.string().uuid() }).strict();
const allowed = new WeakSet<object>();
const closed = () => Object.freeze({ status: "blocked" as const, reason: "document-model-egress-disabled" as const, providerDispatchAllowed: false as const });

/** Local review fixture only. No arbitrary text/image/OCR/metadata ever becomes a
 * provider payload. ADR-018 now approves the direction; real-format parser coverage remains unproven. */
export function prepareSyntheticReview(bytes: Uint8Array, scan: unknown, context: unknown) {
  if (!(bytes instanceof Uint8Array) || !isVerifiedScan(scan) || scan.detectedType !== "application/pdf"
    || bytes.byteLength !== scan.size || bytes.byteLength !== Buffer.byteLength(PUBLIC_REVIEW_FIXTURE)) return closed();
  const snapshot = Buffer.from(bytes);
  if (!snapshot.equals(Buffer.from(PUBLIC_REVIEW_FIXTURE)) || createHash("sha256").update(snapshot).digest("hex") !== scan.sha256) return closed();
  const parsed = contextSchema.safeParse(context);
  if (!parsed.success) return closed();
  const date = "2026-10-01", start = PUBLIC_REVIEW_FIXTURE.indexOf(date);
  const proposal = Object.freeze({ status: "needs_review" as const, source: "synthetic" as const,
    providerDispatchAllowed: false as const, suggestedDate: date,
    citation: Object.freeze({ documentId: parsed.data.documentId, householdId: parsed.data.householdId,
      page: 1 as const, start, end: start + date.length, sha256: scan.sha256 }) });
  allowed.add(proposal);
  return proposal;
}

/** Deterministic stub with no injected transport/client or model authority. It
 * produces no domain write, obligation, reminder, provider call or auto-approval. */
export function inspectWithLocalReviewStub(proposal: ReturnType<typeof prepareSyntheticReview>) {
  if (!allowed.has(proposal) || proposal.status !== "needs_review") return closed();
  return Object.freeze({ status: "awaiting-human-review" as const, source: "synthetic" as const,
    providerDispatchAllowed: false as const, suggestedDate: proposal.suggestedDate, citation: proposal.citation });
}
