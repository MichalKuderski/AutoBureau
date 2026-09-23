// @vitest-environment node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isVerifiedScan, scanQuarantinedSnapshot, SCAN_LIMITS, type ScannerPort, type ScanRequest } from "./scan-boundary";
const scanContext = { nonce: "11111111-1111-4111-8111-111111111111", release: { engine: "1".repeat(64), signatures: "2".repeat(64), sandbox: "3".repeat(64) } };
const fixture = Buffer.from("%PDF-1.7\nPELLUM PUBLIC SYNTHETIC FIXTURE\ndue_date=2026-10-01\n%%EOF");
function reply(request: ScanRequest, overrides: object = {}) {
  return Buffer.from(JSON.stringify({ version: 2, release: request.release, nonce: request.nonce,
    sha256: createHash("sha256").update(request.bytes).digest("hex"), size: request.bytes.length,
    verdict: "clean", detectedType: "application/pdf", ...overrides }));
}
afterEach(() => vi.useRealTimers());
describe("quarantined scan protocol", () => {
  it("binds a frozen process-local clean receipt to actual bytes; JSON cannot forge it", async () => {
    const result = await scanQuarantinedSnapshot(fixture, "application/pdf", { scan: async r => reply(r) }, scanContext);
    expect(isVerifiedScan(result)).toBe(true); expect(Object.isFrozen(result)).toBe(true);
    expect(isVerifiedScan(JSON.parse(JSON.stringify(result)))).toBe(false);
    expect(isVerifiedScan({ verdict: "clean" })).toBe(false);
  });
  it.each([
    { version: 1 }, { release: { ...scanContext.release, engine: "0".repeat(64) } }, { release: { ...scanContext.release, signatures: "0".repeat(64) } }, { release: { ...scanContext.release, sandbox: "0".repeat(64) } }, { nonce: "00000000-0000-4000-8000-000000000000" }, { sha256: "0".repeat(64) },
    { size: 1 }, { verdict: "CLEAN" }, { verdict: "pass" }, { detectedType: "text/html" },
    { extra: "private-canary" }, { filename: "private-canary" }, { stdout: "clean" },
  ])("rejects malformed, unbound or extra-field reply %j", async overrides => {
    const result = await scanQuarantinedSnapshot(fixture, "application/pdf", { scan: async r => reply(r, overrides) }, scanContext);
    expect(result).toEqual({ verdict: "scanner-error" }); expect(isVerifiedScan(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-canary");
  });
  it.each(["rejected", "indeterminate", "scanner-error"])("never promotes %s", async verdict => {
    const result = await scanQuarantinedSnapshot(fixture, "application/pdf", { scan: async r => reply(r, { verdict }) }, scanContext);
    expect(result).toEqual({ verdict }); expect(isVerifiedScan(result)).toBe(false);
  });
  it.each([Buffer.from("{"), Buffer.from([255]), Buffer.alloc(SCAN_LIMITS.replyBytes + 1)])("bounds and validates reply bytes", async raw => {
    expect(await scanQuarantinedSnapshot(fixture, "application/pdf", { scan: async () => raw }, scanContext)).toEqual({ verdict: "scanner-error" });
  });
  it("rejects empty, oversized and unsupported files before invoking the scanner", async () => {
    const scan = vi.fn();
    for (const [bytes, type] of [[Buffer.alloc(0), "application/pdf"], [Buffer.alloc(SCAN_LIMITS.bytes + 1), "application/pdf"], [fixture, "text/html"]] as const) {
      expect(await scanQuarantinedSnapshot(bytes, type, { scan }, scanContext)).toEqual({ verdict: "rejected" });
    }
    expect(scan).not.toHaveBeenCalled();
  });
  it("rejects detected-type mismatch and mutation of transport bytes", async () => {
    expect(await scanQuarantinedSnapshot(fixture, "image/png", { scan: async r => reply(r) }, scanContext)).toEqual({ verdict: "rejected" });
    const original = Buffer.from(fixture);
    const result = await scanQuarantinedSnapshot(original, "application/pdf", { scan: async r => { r.bytes[0] = 0; return reply(r); } }, scanContext);
    expect(result.verdict).toBe("scanner-error"); expect(original.equals(fixture)).toBe(true);
  });
  it("times out an uncooperative port once; late clean completion cannot issue a receipt", async () => {
    vi.useFakeTimers(); let finish!: () => void; let signal!: AbortSignal;
    const scan = vi.fn((r: ScanRequest, s: AbortSignal) => { signal = s; return new Promise<Uint8Array>(resolve => { finish = () => resolve(reply(r)); }); });
    const pending = scanQuarantinedSnapshot(fixture, "application/pdf", { scan }, scanContext);
    await vi.advanceTimersByTimeAsync(SCAN_LIMITS.timeoutMs);
    const result = await pending; finish(); await Promise.resolve();
    expect(result).toEqual({ verdict: "scanner-error" }); expect(signal.aborted).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1); expect(isVerifiedScan(result)).toBe(false);
  });
  it("does not surface exceptions or provider output", async () => {
    expect(await scanQuarantinedSnapshot(fixture, "application/pdf", { scan: async () => { throw new Error("sensitive-canary"); } }, scanContext)).toEqual({ verdict: "scanner-error" });
  });
  it("uses a separate minimal-env synthetic process with bounded heap, output and lifetime", async () => {
    const port: ScannerPort = { scan: (request, signal) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=32", fileURLToPath(new URL("../../../../../scripts/fixtures/synthetic-document-scanner.mjs", import.meta.url))],
        { env: { LANG: "C", NODE_ENV: "test" }, stdio: ["pipe", "pipe", "ignore"], signal });
      const chunks: Buffer[] = []; let size = 0;
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > SCAN_LIMITS.replyBytes) { child.kill("SIGKILL"); reject(new Error("bounded output")); } else chunks.push(chunk); });
      child.on("error", reject); child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("scanner failed")));
      child.stdin.on("error", reject);
      child.stdin.end(JSON.stringify({ version: request.version, release: request.release, nonce: request.nonce, data: Buffer.from(request.bytes).toString("base64") }));
    }) };
    expect(isVerifiedScan(await scanQuarantinedSnapshot(fixture, "application/pdf", port, scanContext))).toBe(true);
    expect(await scanQuarantinedSnapshot(Buffer.from("unknown hostile bytes"), "application/pdf", port, scanContext)).toEqual({ verdict: "indeterminate" });
  });
});
