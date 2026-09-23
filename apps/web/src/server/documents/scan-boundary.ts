import { createHash } from "node:crypto";
import { z } from "zod";
import { ScannerReleaseSchema, type ScannerRelease, UPLOAD_MAX_BYTES, UploadMimeSchema, type UploadMime } from "@autobureau/contracts";

export const SCAN_LIMITS = Object.freeze({ bytes: UPLOAD_MAX_BYTES, replyBytes: 1024, timeoutMs: 46_000, attempts: 1 });
const replySchema = z.object({
  version: z.literal(2), release: ScannerReleaseSchema, nonce: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(1).max(SCAN_LIMITS.bytes),
  verdict: z.enum(["clean", "rejected", "indeterminate", "scanner-error"]),
  detectedType: UploadMimeSchema,
}).strict();
type Reply = z.infer<typeof replySchema>;
export interface ScanRequest {
  readonly version: 2; readonly release: ScannerRelease; readonly nonce: string; readonly bytes: Uint8Array;
}
/** Port to a separately isolated scanner; no DB, URLs, tenant IDs, filenames,
 * cloud credentials or model authority are part of this protocol. No production
 * adapter is wired: the process/container sandbox remains an activation gate. */
export interface ScannerPort {
  scan(request: ScanRequest, signal: AbortSignal): Promise<Uint8Array>;
}
export type ScanResult = Readonly<
  | { verdict: "clean"; sha256: string; size: number; detectedType: UploadMime }
  | { verdict: "rejected" | "indeterminate" | "scanner-error" }
>;
// A JSON object saying "clean" is not permission to advance. The supervisor
// issues a process-local receipt only after binding reply to the exact byte snapshot.
const verified = new WeakSet<object>();
export function isVerifiedScan(result: unknown): result is Extract<ScanResult, { verdict: "clean" }> {
  return typeof result === "object" && result !== null && verified.has(result);
}
const refused = (verdict: "rejected" | "indeterminate" | "scanner-error"): ScanResult => Object.freeze({ verdict });

export async function scanQuarantinedSnapshot(bytes: Uint8Array, declaredType: unknown, port: ScannerPort, context: { nonce: string; release: ScannerRelease }): Promise<ScanResult> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > SCAN_LIMITS.bytes
    || !UploadMimeSchema.safeParse(declaredType).success) return refused("rejected");
  // Buffer.slice aliases memory; two independent copies preserve the authoritative
  // snapshot even if a transport mutates its input while performing I/O.
  const snapshot = new Uint8Array(bytes), digest = createHash("sha256").update(snapshot).digest("hex");
  const parsedRelease = ScannerReleaseSchema.safeParse(context?.release);
  if (!parsedRelease.success || !z.string().uuid().safeParse(context?.nonce).success) return refused("scanner-error");
  const release = Object.freeze(parsedRelease.data), nonce = context.nonce, controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("scan deadline")); }, SCAN_LIMITS.timeoutMs);
    });
    const raw = await Promise.race([Promise.resolve().then(() => port.scan(
      Object.freeze({ version: 2, release, nonce, bytes: new Uint8Array(snapshot) }), controller.signal)), deadline]);
    if (!(raw instanceof Uint8Array) || raw.byteLength > SCAN_LIMITS.replyBytes || controller.signal.aborted) return refused("scanner-error");
    let reply: Reply;
    try { reply = replySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))); }
    catch { return refused("scanner-error"); }
    if (reply.release.engine !== release.engine || reply.release.signatures !== release.signatures || reply.release.sandbox !== release.sandbox
      || reply.nonce !== nonce || reply.sha256 !== digest || reply.size !== snapshot.byteLength) return refused("scanner-error");
    if (reply.verdict !== "clean") return refused(reply.verdict);
    if (reply.detectedType !== declaredType) return refused("rejected");
    const result = Object.freeze({ verdict: "clean" as const, sha256: digest, size: snapshot.byteLength, detectedType: reply.detectedType });
    verified.add(result);
    return result;
  } catch { return refused("scanner-error"); }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
