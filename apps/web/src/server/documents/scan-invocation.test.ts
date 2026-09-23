import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const journal = vi.hoisted(() => ({ claimDocumentScan: vi.fn(), completeDocumentScan: vi.fn() }));
vi.mock("@autobureau/db", () => journal);
import { runDocumentScanOnce } from "./scan-invocation";
import type { Database } from "@autobureau/db";
const bytes = Buffer.from("PUBLIC SYNTHETIC FIXTURE"), sha256 = createHash("sha256").update(bytes).digest("hex");
const scanContext = { nonce: "11111111-1111-4111-8111-111111111111", release: { engine: "1".repeat(64), signatures: "2".repeat(64), sandbox: "3".repeat(64) } };
const claim = { scanId: "scan", nonce: scanContext.nonce, release: scanContext.release, attempt: 1, documentId: "doc", sealId: "seal", size: bytes.length, sha256 };
const db = {} as Database;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function ports() {
  journal.claimDocumentScan.mockResolvedValue(claim); journal.completeDocumentScan.mockImplementation(async (_db, _hh, _id, result) => result.verdict);
  return { snapshots: { load: vi.fn(async (_identity: { documentId: string; sealId: string; size: number }, _signal: AbortSignal) => bytes) }, scanner: { scan: vi.fn(async (request: { nonce: string; bytes: Uint8Array }) =>
    Buffer.from(JSON.stringify({ version: 2, release: scanContext.release, nonce: request.nonce, size: bytes.length, sha256, verdict: "clean", detectedType: "application/pdf" }))) } };
}
describe("bounded durable scan invocation", () => {
  it("loads only the claimed immutable identity, then binds the result to the durable nonce", async () => {
    const p = ports(); expect(await runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf")).toBe("clean");
    expect(p.snapshots.load.mock.calls[0]![0]).toEqual({ documentId: "doc", sealId: "seal", size: bytes.length });
    expect(journal.completeDocumentScan).toHaveBeenCalledWith(db, "hh", "scan", { nonce: scanContext.nonce, sha256, verdict: "clean", failure: "none" });
  });
  it("does not load or scan a lease it cannot claim", async () => {
    const p = ports(); journal.claimDocumentScan.mockResolvedValue(null);
    expect(await runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf")).toBe("not-claimed");
    expect(p.snapshots.load).not.toHaveBeenCalled(); expect(p.scanner.scan).not.toHaveBeenCalled();
  });
  it("refuses changed snapshot bytes before scanner work", async () => {
    const p = ports(); p.snapshots.load.mockResolvedValue(Buffer.alloc(bytes.length, 65));
    await runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf");
    expect(p.scanner.scan).not.toHaveBeenCalled(); expect(journal.completeDocumentScan.mock.calls[0]![3]).toMatchObject({ verdict: "scanner-error", failure: "binding" });
  });
  it("does not override DB completion refusal after a concurrent deletion fence", async () => {
    const p = ports(); journal.completeDocumentScan.mockResolvedValue("cancelled");
    expect(await runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf")).toBe("cancelled");
  });
  it("bounds an uncooperative snapshot load and never forwards provider errors", async () => {
    vi.useFakeTimers(); const p = ports(); p.snapshots.load.mockImplementation(() => new Promise(() => {}));
    const result = runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf");
    await vi.advanceTimersByTimeAsync(5001); expect(await result).toBe("scanner-error");
    expect(p.scanner.scan).not.toHaveBeenCalled(); expect(journal.completeDocumentScan.mock.calls[0]![3]).toMatchObject({ failure: "unavailable" });
  });
  it("does not promote malformed scanner output", async () => {
    const p = ports(); p.scanner.scan.mockResolvedValue(Buffer.from('{"verdict":"clean"}'));
    expect(await runDocumentScanOnce(db, "hh", "scan", {}, p.snapshots, p.scanner, "application/pdf")).toBe("scanner-error");
  });
});
