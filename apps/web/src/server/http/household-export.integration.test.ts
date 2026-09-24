import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, chmod, rm } from "node:fs/promises";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let exports_: typeof import("@/app/v1/households/[id]/exports/route");
let revoke: typeof import("@/app/v1/households/[id]/exports/revoke/route");
let download: typeof import("@/app/v1/households/[id]/exports/[requestId]/route");
let base: string, vault: string, custody: string;
const mounted = () => Object.assign(process.env, { LOCAL_PRIVACY_STORAGE: "synthetic-only", LOCAL_EXPORT_VAULT: vault, LOCAL_CLEAN_CUSTODY_ROOT: custody, LOCAL_EXPORT_KEY: randomBytes(32).toString("hex") });
beforeAll(async () => {
  h = await domainHarness(); base = `/v1/households/${h.household}/exports`;
  vault = await mkdtemp("/private/tmp/pellum-export-vault-"); await chmod(vault, 0o700);
  custody = await mkdtemp("/private/tmp/pellum-clean-custody-"); await chmod(custody, 0o700);
  [exports_, revoke, download] = await Promise.all([import("@/app/v1/households/[id]/exports/route"), import("@/app/v1/households/[id]/exports/revoke/route"), import("@/app/v1/households/[id]/exports/[requestId]/route")]);
});
afterEach(() => { for (const k of ["LOCAL_PRIVACY_STORAGE", "LOCAL_EXPORT_VAULT", "LOCAL_CLEAN_CUSTODY_ROOT", "LOCAL_EXPORT_KEY"]) delete process.env[k]; });
afterAll(async () => {
  if (h) { await h.admin.localExportArtifact.deleteMany({ where: { householdId: h.household } }); await h.close(); }
  await rm(vault, { recursive: true, force: true }); await rm(custody, { recursive: true, force: true });
});
const names = (zip: Buffer) => { const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), out: string[] = [];
  for (let i = 0, p = zip.readUInt32LE(end + 16); i < zip.readUInt16LE(end + 10); i++) { const n = zip.readUInt16LE(p + 28); out.push(zip.subarray(p + 46, p + 46 + n).toString()); p += 46 + n; } return out; };

describe("owner export routes", () => {
  it("say plainly that export is unavailable where no reviewed storage is mounted, creating nothing", async () => {
    const status = await exports_.GET(await h.request(base));
    expect(await status.json()).toEqual({ available: false, latest: null });
    const post = await exports_.POST(await h.request(base, { method: "POST", body: { requestId: randomUUID() } }));
    expect(post.status).toBe(503);
    expect((await post.json()).detail).toBe("Export isn't available on this deployment yet.");
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household, eventType: "export.requested" } })).toBe(0);
  });
  it("refuse viewers, sessions without step-up and foreign households", async () => {
    mounted();
    expect((await exports_.POST(await h.request(base, { method: "POST", body: { requestId: randomUUID() }, user: h.viewer }))).status).toBe(403);
    expect((await exports_.POST(await h.request(base, { method: "POST", body: { requestId: randomUUID() }, assurance: "aal1" }))).status).toBe(403);
    expect((await exports_.POST(await h.request(`/v1/households/${h.foreignHousehold}/exports`, { method: "POST", body: { requestId: randomUUID() } }))).status).toBe(404);
    expect(await h.admin.outboxEvent.count({ where: { householdId: { in: [h.household, h.foreignHousehold] }, eventType: "export.requested" } })).toBe(0);
  });
  it("prepare, download a verifiable archive, then revoke it", async () => {
    mounted();
    const requestId = randomUUID();
    const prepared = await exports_.POST(await h.request(base, { method: "POST", body: { requestId } }));
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({ requestId, state: "ready", complete: true });
    const file = await download.GET(await h.request(`${base}/${requestId}`));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/zip");
    expect(file.headers.get("cache-control")).toBe("no-store, private");
    const zip = Buffer.from(await file.arrayBuffer());
    expect(names(zip)).toEqual(expect.arrayContaining(["manifest.json", "README.txt", "data/items.jsonl", "data/auditTrail.jsonl"]));
    expect((await download.GET(await h.request(`${base}/${requestId}`, { user: h.viewer }))).status).toBe(403);
    const revoked = await revoke.POST(await h.request(`${base}/revoke`, { method: "POST", body: { requestId } }));
    expect(await revoked.json()).toMatchObject({ requestId, state: "revoked" });
    expect((await download.GET(await h.request(`${base}/${requestId}`))).status).toBe(404);
  });
});
