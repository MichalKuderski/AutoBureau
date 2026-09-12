import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";
import * as storageModule from "@/server/storage/quarantine";
let h: Awaited<ReturnType<typeof domainHarness>>;
let uploads: typeof import("@/app/v1/documents/uploads/route"), complete: typeof import("@/app/v1/documents/[id]/complete/route");
const issue = vi.spyOn(storageModule.QuarantineStorage.prototype, "issue");
const seal = vi.spyOn(storageModule.QuarantineStorage.prototype, "seal");
const discard = vi.spyOn(storageModule.QuarantineStorage.prototype, "discard");
const body = { filename: "identifier-do-not-store.pdf", mime: "application/pdf", size: 128 };
let firstId: string;
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.entitlement.create({ data: { householdId: h.household, docsPerMonth: 100, periodStart: new Date() } });
  process.env["DOCUMENT_INTAKE_ENABLED"] = "true";
  vi.spyOn(storageModule, "storageConfigFromEnv").mockReturnValue({ endpoint: "https://storage.example.test", region: "us-west-2", bucket: "quarantine", accessKeyId: "local-only-id", secretAccessKey: "local-only-synthetic-secret" });
  issue.mockImplementation(async () => ({ url: "https://storage.example.test/synthetic-upload-capability", expiresAt: new Date(Date.now() + 900_000) }));
  seal.mockResolvedValue(); discard.mockResolvedValue();
  [uploads, complete] = await Promise.all([import("@/app/v1/documents/uploads/route"), import("@/app/v1/documents/[id]/complete/route")]);
}, 120_000);
afterAll(async () => { delete process.env["DOCUMENT_INTAKE_ENABLED"]; vi.restoreAllMocks(); await h?.close(); });
async function create(extra: object = {}) { return uploads.POST(await h.request("/v1/documents/uploads", { method: "POST", body: { ...body, ...extra } })); }
async function finish(id: string) { return complete.POST(await h.request(`/v1/documents/${id}/complete`, { method: "POST", body: {} })); }
async function newId() { const res = await create(); expect(res.status).toBe(201); return (await res.json()).document_id as string; }

describe("document intake through the real tenant boundary", () => {
  it("rejects unauthenticated, viewer, oversized, unsupported and forged input before reserving anything", async () => {
    for (const [user, expected] of [[null, 401], [h.viewer, 403]] as const) expect((await uploads.POST(await h.request("/v1/documents/uploads", { method: "POST", user, body }))).status).toBe(expected);
    for (const extra of [{ household_id: h.foreignHousehold }, { sha256: "forged" }, { size: 26 * 1024 * 1024 }, { size: 0 }, { mime: "text/html" }, { filename: "bad\nname.pdf" }]) expect((await create(extra)).status).toBe(400);
    expect(await h.admin.document.count({ where: { householdId: h.household } })).toBe(0);
    expect(issue).not.toHaveBeenCalled();
  });
  it("reserves one unknown-hash document on an idempotent retry, with no filename or processing event stored", async () => {
    const headers = { "idempotency-key": randomUUID() };
    const first = await uploads.POST(await h.request("/v1/documents/uploads", { method: "POST", body, headers }));
    const ticket = await first.json(); firstId = ticket.document_id;
    expect(first.status).toBe(201); expect(ticket).toMatchObject({ status: "received", method: "PUT", headers: { "content-type": "application/pdf" } });
    const again = await uploads.POST(await h.request("/v1/documents/uploads", { method: "POST", body, headers }));
    expect(await again.json()).toEqual(ticket); expect(issue).toHaveBeenCalledTimes(1);
    const doc = await h.admin.document.findUniqueOrThrow({ where: { id: firstId }, include: { upload: true } });
    expect(doc).toMatchObject({ householdId: h.household, uploadedBy: h.owner, title: "Uploaded document", sha256: null, status: "received", sizeBytes: 128n });
    expect(JSON.stringify({ ...doc, sizeBytes: Number(doc.sizeBytes) })).not.toContain(body.filename);
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household } })).toBe(0);
    expect(await h.admin.documentUpload.count({ where: { documentId: firstId } })).toBe(1);
  });
  it("serializes concurrent completion, selects one isolated copy and commits one usage/event transition", async () => {
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    let arrivals = 0;
    seal.mockImplementation(async () => { if (++arrivals === 2) release(); await bothArrived; });
    const replies = await Promise.all([finish(firstId), finish(firstId)]);
    expect(replies.map((r) => r.status)).toEqual([202, 202]);
    expect(await replies[0]!.json()).toEqual({ document_id: firstId, status: "scanning" });
    const row = await h.admin.document.findUniqueOrThrow({ where: { id: firstId }, include: { upload: true } });
    const destinations = seal.mock.calls.map((call) => call[1]);
    expect(new Set(destinations).size).toBe(2); expect(destinations).toContain(row.storagePath);
    expect(row.upload?.completedAt).not.toBeNull(); expect(row.sha256).toBeNull();
    expect(discard).toHaveBeenCalledExactlyOnceWith(destinations.find((key) => key !== row.storagePath));
    const events = await h.admin.outboxEvent.findMany({ where: { householdId: h.household } });
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ eventType: "document.uploaded", aggregateId: firstId, payload: {} });
    expect((await h.admin.entitlement.findUniqueOrThrow({ where: { householdId: h.household } })).docsUsedThisPeriod).toBe(1);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, targetType: "document", targetId: firstId, action: "document.upload_completed" } })).toBe(1);
    seal.mockResolvedValue();
  });
  it("replays completion without new storage/usage/events and makes foreign IDs indistinguishable from missing ones", async () => {
    const calls = seal.mock.calls.length;
    expect((await finish(firstId)).status).toBe(202); expect(seal).toHaveBeenCalledTimes(calls);
    const foreign = randomUUID();
    await h.admin.document.create({ data: { id: foreign, householdId: h.foreignHousehold, source: "upload", storagePath: "foreign", sizeBytes: 1, mimeType: "application/pdf" } });
    for (const id of [foreign, randomUUID()]) expect((await finish(id)).status).toBe(404);
    expect((await complete.POST(await h.request(`/v1/documents/${firstId}/complete`, { method: "POST", body: { status: "processed" } }))).status).toBe(400);
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("rejects expired capabilities and retains a pending upload unchanged after a provider refusal", async () => {
    const expired = await newId();
    await h.admin.documentUpload.update({ where: { documentId: expired }, data: { createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) } });
    const calls = seal.mock.calls.length; expect((await finish(expired)).status).toBe(409); expect(seal).toHaveBeenCalledTimes(calls);
    const pending = await newId(); seal.mockRejectedValueOnce(new storageModule.StorageError("unavailable"));
    const response = await finish(pending); expect(response.status).toBe(503);
    expect((await h.admin.document.findUniqueOrThrow({ where: { id: pending } })).status).toBe("received");
    expect((await h.admin.documentUpload.findUniqueOrThrow({ where: { documentId: pending } })).completedAt).toBeNull();
    expect((await h.admin.entitlement.findUniqueOrThrow({ where: { householdId: h.household } })).docsUsedThisPeriod).toBe(1);
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("reserves the last allowance slot once under concurrent creates", async () => {
    const pending = await h.admin.documentUpload.count({ where: { completedAt: null, expiresAt: { gt: new Date() }, document: { householdId: h.household, status: "received" } } });
    await h.admin.entitlement.update({ where: { householdId: h.household }, data: { docsPerMonth: pending + 2 } });
    const results = await Promise.all([create(), create()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 402]);
    await h.admin.entitlement.update({ where: { householdId: h.household }, data: { docsPerMonth: 100 } });
  });
  it("renews an old UTC monthly allowance on successful completion without granting a different plan", async () => {
    const id = await newId();
    await h.admin.entitlement.update({ where: { householdId: h.household }, data: { docsUsedThisPeriod: 99, periodStart: new Date("2026-01-01T00:00:00Z") } });
    expect((await finish(id)).status).toBe(202);
    const entitlement = await h.admin.entitlement.findUniqueOrThrow({ where: { householdId: h.household } });
    expect(entitlement).toMatchObject({ plan: "free", docsUsedThisPeriod: 1, docsPerMonth: 100 });
    const now = new Date(); expect(entitlement.periodStart).toEqual(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  });
  it("rolls back completion and usage if its outbox write fails, and preserves the copy for reconciliation", async () => {
    const id = await newId(), before = await h.admin.entitlement.findUniqueOrThrow({ where: { householdId: h.household } });
    const eventCount = await h.admin.outboxEvent.count({ where: { householdId: h.household } }), discarded = discard.mock.calls.length;
    // Disposable local database only; the trigger targets this fixture's household.
    await h.admin.$executeRawUnsafe(`CREATE FUNCTION public.upload_test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.household_id = '${h.household}'::uuid AND NEW.event_type = 'document.uploaded' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`);
    try {
      await h.admin.$executeRawUnsafe("CREATE TRIGGER upload_test_fail_outbox BEFORE INSERT ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.upload_test_fail_outbox()");
      expect((await finish(id)).status).toBe(500);
    } finally {
      await h.admin.$executeRawUnsafe("DROP TRIGGER IF EXISTS upload_test_fail_outbox ON public.outbox_events");
      await h.admin.$executeRawUnsafe("DROP FUNCTION public.upload_test_fail_outbox()");
    }
    const row = await h.admin.document.findUniqueOrThrow({ where: { id }, include: { upload: true } });
    expect(row.status).toBe("received"); expect(row.storagePath).toBe(row.upload?.objectKey); expect(row.upload?.completedAt).toBeNull();
    expect(await h.admin.entitlement.findUniqueOrThrow({ where: { householdId: h.household } })).toEqual(before);
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household } })).toBe(eventCount);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, targetId: id, action: "document.upload_completed" } })).toBe(0);
    expect(discard).toHaveBeenCalledTimes(discarded);
    expect((await finish(id)).status).toBe(202);
  });
  it("keeps the intake gate closed without creating data even if storage credentials exist", async () => {
    const before = await h.admin.document.count({ where: { householdId: h.household } });
    delete process.env["DOCUMENT_INTAKE_ENABLED"];
    expect((await create()).status).toBe(503);
    expect(await h.admin.document.count({ where: { householdId: h.household } })).toBe(before);
    process.env["DOCUMENT_INTAKE_ENABLED"] = "true";
  });
});
