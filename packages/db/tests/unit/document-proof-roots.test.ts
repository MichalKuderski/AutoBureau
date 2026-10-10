import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createDocumentProofRoots } from "../local/document-proof-roots.js";
import { localCleanCustody } from "../../src/local-clean-custody.js";
import { syntheticObjectStore } from "../../../../scripts/synthetic-object-store.mjs";

it("creates private canonical lifecycle roots accepted by the real local adapters, ignoring TMPDIR", () => {
  vi.stubEnv("TMPDIR", "/not-an-approved-proof-root");
  let roots: ReturnType<typeof createDocumentProofRoots> | undefined;
  try {
    roots = createDocumentProofRoots();
    const base = process.platform === "linux" ? "/tmp" : "/private/tmp";
    expect(roots.root).toMatch(new RegExp(`^${base}/pellum-document-lifecycle-[^/]+$`));
    expect(roots.custodyRoot).toMatch(new RegExp(`^${base}/pellum-clean-custody-[^/]+$`));
    for (const path of Object.values(roots)) {
      const stat = lstatSync(path);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(stat.mode & 0o077).toBe(0);
      expect(stat.uid).toBe(process.getuid?.());
      expect(realpathSync(path)).toBe(path);
    }
    const householdId = randomUUID(), objectId = randomUUID();
    const bytes = Buffer.from(`PUBLIC SYNTHETIC ${randomUUID()}`);
    const store = syntheticObjectStore(roots.root);
    store.put("quarantine", householdId, objectId, bytes);
    expect(store.inventory("quarantine", householdId).count).toBe(1);
    const custody = localCleanCustody(roots.custodyRoot);
    const ref = { householdId, objectId, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
    custody.copy(ref, bytes);
    expect(custody.readVerified(ref)).toEqual(bytes);
  } finally {
    vi.unstubAllEnvs();
    if (roots) for (const path of Object.values(roots)) rmSync(path, { recursive: true, force: true });
  }
});
