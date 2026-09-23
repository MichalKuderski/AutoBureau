import { describe, expect, it } from "vitest";
import { JournalScanResultSchema, ScannerReleaseSchema, ScanRegistrationSchema, DeletionManifestSchema, SyntheticAbsenceSchema } from "./document-security.js";
import { encodeJobEnvelope } from "./jobs.js";
const id = "00000000-0000-4000-8000-000000000001", sha = "a".repeat(64);
describe("document journal closed contracts", () => {
  it("accepts only a bound clean result with the no-failure category", () => {
    expect(JournalScanResultSchema.safeParse({ nonce: id, sha256: sha, verdict: "clean", failure: "none" }).success).toBe(true);
    for (const [verdict, failure] of [["clean", "malware"], ["indeterminate", "none"], ["unknown", "none"], ["scanner-error", "private error text"]]) {
      expect(JournalScanResultSchema.safeParse({ nonce: id, sha256: sha, verdict, failure }).success).toBe(false);
    }
  });
  it.each(["bytes", "filename", "ocr", "message", "metadata"])("rejects %s in durable verdicts", field => {
    expect(JournalScanResultSchema.safeParse({ nonce: id, sha256: sha, verdict: "clean", failure: "none", [field]: "private" }).success).toBe(false);
  });
  it("bounds snapshot size and pins all three release digests", () => {
    for (const size of [0, 26_214_401, 1.5]) expect(ScanRegistrationSchema.safeParse({ documentId: id, sealId: id, sha256: sha, size }).success).toBe(false);
    expect(ScannerReleaseSchema.safeParse({ engine: sha, signatures: sha, sandbox: sha }).success).toBe(true);
    expect(ScannerReleaseSchema.safeParse({ engine: "latest", signatures: sha, sandbox: sha }).success).toBe(false);
  });
  it("bounds manifest chunks and refuses object paths or arbitrary components", () => {
    const row = { component: "documents", resourceRef: id, inventoryCount: 1 };
    expect(DeletionManifestSchema.safeParse([row]).success).toBe(true);
    for (const rows of [[], Array.from({ length: 251 }, () => row), [{ ...row, resourceRef: "hh/private/path" }], [{ ...row, component: "misc" }]]) {
      expect(DeletionManifestSchema.safeParse(rows).success).toBe(false);
    }
  });
  it("absence cannot contain remaining data or an undisclosed retention exception", () => {
    for (const v of [{ remaining: 1 }, { remaining: 0, retentionUntil: "2026-10-01T00:00:00Z" }]) {
      expect(SyntheticAbsenceSchema.safeParse({ evidenceId: id, state: "absent", ...v }).success).toBe(false);
    }
  });
  it.each(["redacted", "provenance", "source", "capability", "metadata", "signed_url"])("refuses %s in retry/DLQ envelopes", key => {
    expect(() => encodeJobEnvelope({ version: 1, event_id: "1", household_id: id, event_type: "document.scanned", consumer: "pipeline", [key]: {} })).toThrow();
  });
});
