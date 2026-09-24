import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let read: typeof import("@/app/v1/documents/[id]/result/route");
let apply: typeof import("@/app/v1/documents/[id]/result/apply/route");
let discard: typeof import("@/app/v1/documents/[id]/result/discard/route");
const docs: string[] = [];
/** The fixture administrator seeds a published result whose work was reserved in the PREVIOUS
 * UTC month (what the worker path produces after a rollover). Every route call below runs as
 * app_user under the real database guards. */
async function heldResult(offsetDays = 0) {
  const doc = randomUUID(), seal = randomUUID(), bytes = Buffer.from(`PUBLIC SYNTHETIC ${doc}`), sha = createHash("sha256").update(bytes).digest();
  docs.push(doc);
  await h.admin.document.create({ data: { id: doc, householdId: h.household, source: "upload", status: "needs_review", storagePath: `hh/${h.household}/upload/${doc}/sealed/${seal}`, mimeType: "application/pdf", sizeBytes: bytes.length, sha256: sha } });
  const scan = await h.admin.documentScan.create({ data: { householdId: h.household, documentId: doc, sealId: seal, sha256: sha, sizeBytes: bytes.length, state: "clean" } });
  const attempt = await h.admin.documentScanAttempt.create({ data: { householdId: h.household, scanId: scan.id, attempt: 1, nonce: randomUUID(), engineDigest: "1".repeat(64), signatureDigest: "2".repeat(64), sandboxDigest: "3".repeat(64), verdict: "clean", failure: "none", startedAt: new Date(Date.now() - 60000), completedAt: new Date(Date.now() - 30000) } });
  const custody = await h.admin.documentCustody.create({ data: { householdId: h.household, documentId: doc, scanId: scan.id, objectId: randomUUID(), sha256: sha, sizeBytes: bytes.length, state: "ready", reviewAt: new Date(Date.now() + 30 * 86400000) } });
  const lease = randomUUID(), processing = randomUUID(), result = randomUUID();
  await h.admin.$executeRaw`INSERT INTO document_processing(id,household_id,custody_id,state,attempts,period_start,period_end,tier,catalog_version,entitlement_revision,limit_snapshot,lease_token,lease_until)
    VALUES(${processing}::uuid,${h.household}::uuid,${custody.id}::uuid,'started',1,
      ((date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month') AT TIME ZONE 'UTC')+make_interval(days=>${offsetDays}::int),
      date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC','free',1,0,10,${lease}::uuid,clock_timestamp()-interval '1 day')`;
  await h.admin.$executeRaw`INSERT INTO document_results(id,household_id,processing_id,custody_id,document_id,scan_id,scan_attempt_id,object_id,source_sha256,engine_digest,signature_digest,sandbox_digest,citation_start,citation_end,due_date,lease_token,period_start,period_end,original_tier,original_catalog_version,original_revision)
    SELECT ${result}::uuid,w.household_id,w.id,w.custody_id,${doc}::uuid,${scan.id}::uuid,${attempt.id}::uuid,${custody.objectId}::uuid,${sha},${"1".repeat(64)},${"2".repeat(64)},${"3".repeat(64)},0,10,'2026-12-01',w.lease_token,w.period_start,w.period_end,'free',1,0
    FROM document_processing w WHERE w.id=${processing}::uuid`;
  return { doc, processing, result, custody: custody.id };
}
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.entitlement.create({ data: { householdId: h.household, periodStart: new Date() } });
  [read, apply, discard] = await Promise.all([import("@/app/v1/documents/[id]/result/route"), import("@/app/v1/documents/[id]/result/apply/route"), import("@/app/v1/documents/[id]/result/discard/route")]);
});
afterAll(async () => {
  if (h) {
    const where = { householdId: h.household };
    await h.admin.documentPeriodDecision.deleteMany({ where }); await h.admin.documentResultReview.deleteMany({ where });
    await h.admin.documentResult.deleteMany({ where }); await h.admin.documentProcessing.deleteMany({ where });
    await h.admin.documentCustody.deleteMany({ where }); await h.admin.documentScanAttempt.deleteMany({ where }); await h.admin.documentScan.deleteMany({ where });
    await h.admin.obligation.deleteMany({ where }); await h.admin.item.deleteMany({ where });
    await h.admin.document.deleteMany({ where: { id: { in: docs } } }); await h.admin.entitlement.deleteMany({ where });
    await h.close();
  }
});

describe("PRD §21.3 old-period result routes", () => {
  it("shows an owner the held result and refuses everyone else", async () => {
    const f = await heldResult(), path = `/v1/documents/${f.doc}/result`;
    const r = await read.GET(await h.request(path));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ documentId: f.doc, resultId: f.result, state: "action-required", canApply: true, canDiscard: true, capacity: { used: 0, limit: 10 } });
    expect((await read.GET(await h.request(path, { user: h.viewer }))).status).toBe(403);
    expect((await read.GET(await h.request(`/v1/documents/${randomUUID()}/result`))).status).toBe(404);
  });
  it("applies a held result in the current month exactly once", async () => {
    const f = await heldResult(1), path = `/v1/documents/${f.doc}/result/apply`;
    expect((await apply.POST(await h.request(path, { method: "POST", body: { resultId: f.result, extra: true } }))).status).toBe(400);
    expect((await apply.POST(await h.request(path, { method: "POST", body: { resultId: randomUUID() } }))).status).toBe(404);
    expect((await apply.POST(await h.request(path, { method: "POST", body: { resultId: f.result }, user: h.viewer }))).status).toBe(403);
    const r = await apply.POST(await h.request(path, { method: "POST", body: { resultId: f.result } }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ state: "applied", canApply: false, canDiscard: false });
    expect(body.chargedPeriodStart).toBe(body.currentPeriodStart);
    expect((await apply.POST(await h.request(path, { method: "POST", body: { resultId: f.result } }))).status).toBe(200);
    expect(await h.admin.documentProcessing.count({ where: { id: f.processing, state: "completed" } })).toBe(1);
    expect(await h.admin.documentPeriodDecision.count({ where: { processingId: f.processing } })).toBe(1);
    expect((await discard.POST(await h.request(`/v1/documents/${f.doc}/result/discard`, { method: "POST", body: { resultId: f.result } }))).status).toBe(409);
  });
  it("discards without charging and keeps the original document", async () => {
    const f = await heldResult(2);
    const r = await discard.POST(await h.request(`/v1/documents/${f.doc}/result/discard`, { method: "POST", body: { resultId: f.result } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ state: "discarded", canApply: false });
    expect(await h.admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } })).toMatchObject({ state: "cancelled", chargedAt: null });
    expect(await h.admin.document.findUniqueOrThrow({ where: { id: f.doc } })).toMatchObject({ status: "discarded" });
    const again = await apply.POST(await h.request(`/v1/documents/${f.doc}/result/apply`, { method: "POST", body: { resultId: f.result } }));
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).toMatch(/already been filed or discarded/);
  });
});
