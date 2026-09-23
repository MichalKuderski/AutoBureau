/** Trusted LOCAL broker adapter. The hostile container receives only bytes. The
 * adapter binds its exact closed status to the nonce/hash and inspected release;
 * raw AV output and stderr never enter application logs or audit. */
import { inspectCanonicalPdf } from '../services/ai/dist/canonical-pdf.js';
import { createHash } from 'node:crypto';
import { localDockerRuntime, runSandboxScanner, sniffScannerType } from './scanner-sandbox.mjs';
export function clamavScannerPort(socket, release) {
  const runtime = localDockerRuntime(socket);
  const adapter = { ...runtime, run: async (spec, encoded, signal) => {
    const request = JSON.parse(encoded.toString()), bytes = Buffer.from(request.data, 'base64');
    const status = (await runtime.run(spec, bytes, signal)).toString('ascii');
    let verdict = { 'CLEAN\n': 'clean', 'REJECTED\n': 'rejected', 'ERROR\n': 'scanner-error' }[status];
    if (!verdict) throw new Error('scanner output refused');
    // AV clean is not format validity. Currently only the byte-complete canonical
    // PDF subset can advance; all other AV-clean formats need local review.
    if (verdict === 'clean' && !inspectCanonicalPdf(bytes)) verdict = 'indeterminate';
    return Buffer.from(JSON.stringify({ version: 2, nonce: request.nonce,
      release: { engine: spec.engine.slice(7), signatures: spec.signatures.slice(7), sandbox: spec.image.slice(7) },
      sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
      detectedType: sniffScannerType(bytes), verdict }));
  } };
  return { scan: async (request, signal) => {
    if (request.version !== 2 || request.release?.engine !== release.engine.slice(7)
      || request.release?.signatures !== release.signatures.slice(7) || request.release?.sandbox !== release.image.slice(7)) throw new Error('scanner release refused');
    return runSandboxScanner(adapter, release, request, signal);
  } };
}
