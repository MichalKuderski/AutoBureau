import { z } from "zod";
import { HttpProblem, fieldErrorsFrom } from "./problem";

/** Bound actual streamed bytes, not just the client-controlled Content-Length. */
export async function jsonBody<S extends z.ZodTypeAny>(
  request: Request, schema: S, maxBytes = 8_192,
): Promise<z.infer<S>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpProblem("unsupported-media-type", "Send a JSON request.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpProblem("validation", "A JSON object is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpProblem("payload-too-large", "This request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpProblem("validation", "A valid JSON object is required."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpProblem("validation", "Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  return parsed.data;
}
