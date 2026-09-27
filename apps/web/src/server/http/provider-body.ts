/**
 * Auth bodies contain credentials. Bound the bytes we retain and the time spent reading
 * them; a successful HTTP status alone is not a usable provider response. This module
 * deliberately has no logging, retry, provider SDK or persistence dependency.
 */
export const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
// Byte limits alone do not bound a stream of empty chunks. Each read costs CPU,
// and a synchronously producing stream can starve the abort timer's event loop.
export const MAX_PROVIDER_RESPONSE_CHUNKS = MAX_PROVIDER_RESPONSE_BYTES + 1;
export type ProviderBodyFailure = "timeout" | "network" | "invalid-response";

export class ProviderBodyError extends Error {
  override readonly name = "ProviderBodyError";
  constructor(readonly failure: ProviderBodyFailure) {
    // Never attach the original error as a cause: it can contain response content.
    super("the provider response could not be read");
  }
}

/** Cancel without waiting for a remote stream's cancellation acknowledgement. */
export function discardProviderBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/** Read actual decoded-stream bytes, not a potentially absent/incorrect Content-Length. */
/** `maxBytes` defaults to the shared provider bound; a caller with a documented larger
 * response (the k-anonymity breach range) passes its own, still finite, bound. */
export async function readProviderText(response: Response, signal: AbortSignal, maxBytes = MAX_PROVIDER_RESPONSE_BYTES): Promise<string> {
  if (signal.aborted) {
    discardProviderBody(response);
    throw new ProviderBodyError("timeout");
  }
  if (!response.body || response.body.locked) throw new ProviderBodyError("invalid-response");

  const reader = response.body.getReader();
  let complete = false;
  let abortRead: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortRead = () => reject(new ProviderBodyError("timeout"));
    signal.addEventListener("abort", abortRead, { once: true });
  });

  async function consume(): Promise<string> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let chunks = 0;
    let text = "";
    while (true) {
      if (signal.aborted) throw new ProviderBodyError("timeout");
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new ProviderBodyError(signal.aborted ? "timeout" : "network");
      }
      if (signal.aborted) throw new ProviderBodyError("timeout");
      if (chunk.done) {
        complete = true;
        break;
      }
      chunks += 1;
      if (chunks > maxBytes + 1) throw new ProviderBodyError("invalid-response");
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new ProviderBodyError("invalid-response");
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw new ProviderBodyError("invalid-response");
      }
    }
    try {
      return text + decoder.decode();
    } catch {
      throw new ProviderBodyError("invalid-response");
    }
  }

  try {
    // Also bounds Response objects from adapters whose stream is not wired to fetch's
    // signal. Race the whole read, not each chunk (which would accumulate listeners).
    return await Promise.race([consume(), aborted]);
  } finally {
    signal.removeEventListener("abort", abortRead);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** JSON consumers retain the same byte/chunk/time bounds as text protocols. */
export async function readProviderJson(response: Response, signal: AbortSignal, maxBytes = MAX_PROVIDER_RESPONSE_BYTES): Promise<unknown> {
  const text = await readProviderText(response, signal, maxBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ProviderBodyError("invalid-response"); }
}
