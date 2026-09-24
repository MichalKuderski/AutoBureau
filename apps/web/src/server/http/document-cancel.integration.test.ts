import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let work: typeof import("@/app/v1/documents/[id]/work/route");
let cancel: typeof import("@/app/v1/documents/[id]/cancel/route");
const docs: string[] = [];
// Fixture administrator seeds clean custody; every assertion below runs as app_user.
async function custody(processing: "waiting" | "reserved" | null) {
  const doc = randomUUID(), seal = randomUUID(), bytes = Buffer.from(`PUBLIC SYNTHETIC ${doc}`), sha256 = createHash("sha256").update(bytes).digest();
  docs.push(doc);
  await h.admin.document.create({ data: { id: doc, householdId: h.household, source: "upload", status: "processing", storagePath: `hh/${h.household}/upload/${doc}/sealed/${seal}`, mimeType: "application/pdf", sizeBytes: bytes.length, sha256 } });
  const scan = await h.admin.documentScan.create({ data: { householdId: h.household, documentId: doc, sealId: seal, sha256, sizeBytes: bytes.length, state: "clean" } });
  const c = await h.admin.documentCustody.create({ data: { householdId: h.household, documentId: doc, scanId: scan.id, objectId: randomUUID(), sha256, sizeBytes: bytes.length, state: "ready", reviewAt: new Date(Date.now() + 86400000) } });
  if (processing === "waiting") await h.admin.documentProcessing.create({ data: { householdId: h.household, custodyId: c.id } });
  if (processing === "reserved") await h.admin.$executeRaw`INSERT INTO document_processing(household_id,custody_id,state,attempts,period_start,period_end,tier,catalog_version,entitlement_revision,limit_snapshot,lease_token,lease_until)
    VALUES(${h.household}::uuid,${c.id}::uuid,'reserved',1,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','free',1,0,10,gen_random_uuid(),now()+interval '90 seconds')`;
  return { doc, custody: c.id };
}
beforeAll(async () => {
  h = await domainHarness();
  [work, cancel] = await Promise.all([import("@/app/v1/documents/[id]/work/route"), import("@/app/v1/documents/[id]/cancel/route")]);
});
afterAll(async () => {
  if (h) {
    const where = { householdId: h.household };
    await h.admin.documentProcessing.deleteMany({ where }); await h.admin.documentCustody.deleteMany({ where });
    await h.admin.documentScan.deleteMany({ where }); await h.admin.document.deleteMany({ where: { id: { in: docs } } });
    await h.close();
  }
});

describe("owner document cancellation", () => {
  it("reports work state and stops unstarted work, keeping the original", async () => {
    const f = await custody("waiting");
    const before = await work.GET(await h.request(`/v1/documents/${f.doc}/work`));
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ documentId: f.doc, state: "waiting", cancellable: true });
    const r = await cancel.POST(await h.request(`/v1/documents/${f.doc}/cancel`, { method: "POST", body: {} }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ state: "stopped", cancellable: false });
    expect(await h.admin.documentCustody.findUniqueOrThrow({ where: { id: f.custody } })).toMatchObject({ state: "cancelled" });
    expect(await h.admin.document.count({ where: { id: f.doc } })).toBe(1);
    expect((await cancel.POST(await h.request(`/v1/documents/${f.doc}/cancel`, { method: "POST", body: {} }))).status).toBe(200);
  });
  it("refuses started work with 409 and viewers with 403", async () => {
    const f = await custody("reserved");
    expect((await cancel.POST(await h.request(`/v1/documents/${f.doc}/cancel`, { method: "POST", body: {} }))).status).toBe(409);
    expect(await h.admin.documentCustody.findUniqueOrThrow({ where: { id: f.custody } })).toMatchObject({ state: "ready" });
    const g = await custody("waiting");
    expect((await cancel.POST(await h.request(`/v1/documents/${g.doc}/cancel`, { method: "POST", body: {}, user: h.viewer }))).status).toBe(403);
    expect((await work.GET(await h.request(`/v1/documents/${g.doc}/work`, { user: h.viewer }))).status).toBe(200);
    expect((await cancel.POST(await h.request(`/v1/documents/${g.doc}/cancel`, { method: "POST", body: { force: true } }))).status).toBe(400);
  });
  it("does not reveal other households' documents", async () => {
    const foreign = randomUUID(); docs.push(foreign);
    await h.admin.document.create({ data: { id: foreign, householdId: h.foreignHousehold, source: "upload", status: "queued", mimeType: "application/pdf", storagePath: `hh/${h.foreignHousehold}/upload/${foreign}`, sizeBytes: 10 } });
    expect((await work.GET(await h.request(`/v1/documents/${foreign}/work`))).status).toBe(404);
    expect((await cancel.POST(await h.request(`/v1/documents/${foreign}/cancel`, { method: "POST", body: {} }))).status).toBe(404);
    expect((await work.GET(await h.request(`/v1/documents/${randomUUID()}/work`))).status).toBe(404);
    expect((await cancel.POST(await h.request(`/v1/documents/${randomUUID()}/cancel`, { method: "POST", body: {} }))).status).toBe(404);
  });
});
