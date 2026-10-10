import { mkdtempSync, realpathSync, rmSync } from "node:fs";

/** Ordinary local proof fixtures, not scanner releases or canonical evidence bindings.
 * Use fixed platform roots; TMPDIR must not widen the synthetic storage boundary. */
export function createDocumentProofRoots() {
  const base = process.platform === "linux" ? "/tmp" : "/private/tmp";
  const root = realpathSync(mkdtempSync(`${base}/pellum-document-lifecycle-`));
  try {
    const custodyRoot = realpathSync(mkdtempSync(`${base}/pellum-clean-custody-`));
    return { root, custodyRoot };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
