import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let route: typeof import("@/app/v1/obligations/route");
const member = randomUUID(), foreignMember = randomUUID(), archivedMember = randomUUID();
const item = randomUUID(), foreignItem = randomUUID(), archivedItem = randomUUID();
const payload = { title: "User-entered renewal title", due_at: "2030-09-20T17:00:00-06:00", kind: "renewal",
  member_id: member, item_id: item, amount_cents: 12550, currency: "USD" };
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.householdMember.createMany({ data: [
    { id: member, householdId: h.household, displayName: "Local person", kind: "adult" },
    { id: foreignMember, householdId: h.foreignHousehold, displayName: "Foreign", kind: "adult" },
    { id: archivedMember, householdId: h.household, displayName: "Archived", kind: "adult", archivedAt: new Date() },
  ] });
  await h.admin.item.createMany({ data: [
    { id: item, householdId: h.household, name: "Related record", kind: "other" },
    { id: foreignItem, householdId: h.foreignHousehold, name: "Foreign", kind: "other" },
    { id: archivedItem, householdId: h.household, name: "Archived", kind: "other", status: "archived" },
  ] });
  route = await import("@/app/v1/obligations/route");
});
afterAll(async () => h?.close());
const create = async (body: unknown, headers?: Record<string, string>) => route.POST(await h.request("/v1/obligations", { method: "POST", body, ...(headers ? { headers } : {}) }));

describe("user-confirmed deadline creation", () => {
  it("persists the exact instant with user provenance and atomically records audit/outbox once", async () => {
    const headers = { "idempotency-key": randomUUID() };
    const first = await create(payload, headers), body = await first.json();
    expect(first.status).toBe(201);
    expect(first.headers.get("location")).toBe(`/v1/obligations/${body.id}`);
    expect(body).toMatchObject({ title: payload.title, source: "user", source_document_id: null, ai_confidence: null,
      due_at: "2030-09-20T23:00:00.000Z", status: "upcoming", member_id: member, item_id: item, amount_cents: 12550 });
    expect(body.verified_at).not.toBeNull();
    const replay = await create(payload, headers);
    expect(replay.status).toBe(201); expect(await replay.json()).toEqual(body);
    expect((await create({ ...payload, title: "Different intent" }, headers)).status).toBe(409);
    expect(await h.admin.obligation.count({ where: { householdId: h.household } })).toBe(1);
    const audits = await h.admin.auditLog.findMany({ where: { householdId: h.household, targetId: body.id, targetType: "obligation" } });
    expect(audits).toHaveLength(1); expect(audits[0]).toMatchObject({ action: "obligation.create", actorId: h.owner });
    const events = await h.admin.outboxEvent.findMany({ where: { householdId: h.household, aggregateId: body.id } });
    expect(events).toHaveLength(1); expect(events[0]!.eventType).toBe("obligation.created");
    expect(JSON.stringify(events[0]!.payload)).not.toContain(payload.title);
    expect(await h.admin.reminder.count({ where: { householdId: h.household } })).toBe(0);
  });
  it("refuses foreign, missing and archived associations without creating a record", async () => {
    for (const member_id of [foreignMember, archivedMember, randomUUID()]) expect((await create({ ...payload, member_id })).status).toBe(404);
    for (const item_id of [foreignItem, archivedItem, randomUUID()]) expect((await create({ ...payload, item_id })).status).toBe(404);
    expect(await h.admin.obligation.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("rejects authority fields, unknown dates, floats and contradictory money", async () => {
    for (const patch of [{ title: " " }, { due_at: "2030-09-20T17:00" }, { due_at: "2030-02-30T17:00:00Z" },
      { due_at: null }, { source: "ai" }, { source_document_id: randomUUID() }, { ai_confidence: 1 },
      { verified_at: "2030-09-20T17:00:00Z" }, { status: "done" }, { recurrence: "daily" },
      { household_id: h.foreignHousehold }, { amount_cents: 12.345 }, { amount_cents: -1 }, { currency: null }, { priority: 4 }]) {
      expect((await create({ ...payload, ...patch })).status).toBe(400);
    }
    expect(await h.admin.obligation.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("enforces authorization before exposing any association", async () => {
    for (const [user, expected] of [[h.viewer, 403], [null, 401]] as const) {
      expect((await route.POST(await h.request("/v1/obligations", { method: "POST", body: payload, user }))).status).toBe(expected);
    }
    expect((await create(payload, { "x-household-id": h.foreignHousehold })).status).toBe(403);
    expect((await create(payload, { origin: "https://attacker.example.test" })).status).toBe(403);
  });
  it("keeps an already-due date actionable and records money owed without claiming recovery", async () => {
    const response = await create({ title: "Claim a deposit", due_at: "2020-01-01T12:00:00Z", direction: "owed_to_household" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "action_needed", source: "user", direction: "owed_to_household", outcome: null });
  });
  it("edits the same record, cancels stale schedules and emits nothing for an equivalent instant", async () => {
    const created = await (await create({ title: "Before editing", due_at: "2020-01-01T12:00:00Z" })).json();
    await h.admin.reminder.create({ data: { householdId: h.household, obligationId: created.id, remindAt: new Date(), offsetLabel: "T-1d" } });
    const detail = await import("@/app/v1/obligations/[id]/route");
    const edit = async (body: unknown) => detail.PATCH(await h.request(`/v1/obligations/${created.id}`, { method: "PATCH", body }));
    const patch = { title: "After editing", due_at: "2030-09-20T17:30:00-06:00", item_id: item };
    const first = await edit(patch);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ id: created.id, title: patch.title, due_at: "2030-09-20T23:30:00.000Z", status: "upcoming" });
    const before = await h.admin.auditLog.count({ where: { householdId: h.household } });
    expect((await edit({ ...patch, due_at: "2030-09-20T23:30:00Z" })).status).toBe(200);
    expect((await edit({})).status).toBe(200);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(before);
    expect(await h.admin.reminder.count({ where: { obligationId: created.id, status: "cancelled" } })).toBe(1);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: created.id, eventType: "obligation.updated" } })).toBe(1);
    expect(await h.admin.auditLog.count({ where: { targetId: created.id, targetType: "obligation", action: "obligation.details_changed" } })).toBe(1);
  });
  it("preserves original document history but removes AI authority from user-confirmed edits", async () => {
    const created = await (await create({ title: "Original", due_at: "2030-01-01T00:00:00Z" })).json();
    const documentId = randomUUID();
    await h.admin.document.create({ data: { id: documentId, householdId: h.household, source: "upload", mimeType: "application/pdf", sizeBytes: 10, storagePath: "local-test-only", sha256: Buffer.alloc(32, 1) } });
    await h.admin.obligation.update({ where: { id: created.id }, data: { source: "ai", sourceDocumentId: documentId, aiConfidence: 0.9, status: "done", outcome: { done_via: "manual" } } });
    const detail = await import("@/app/v1/obligations/[id]/route");
    const response = await detail.PATCH(await h.request(`/v1/obligations/${created.id}`, { method: "PATCH", body: { title: "Human correction" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "user", source_document_id: documentId, ai_confidence: null, status: "done", outcome: { done_via: "manual" } });
  });
  it("blocks forged edits and prevents mixing lifecycle and detail changes", async () => {
    const created = await (await create({ title: "Edit boundary", due_at: "2030-01-01T00:00:00Z" })).json();
    const detail = await import("@/app/v1/obligations/[id]/route");
    for (const patch of [{ item_id: foreignItem }, { member_id: archivedMember }]) {
      expect((await detail.PATCH(await h.request(`/v1/obligations/${created.id}`, { method: "PATCH", body: patch }))).status).toBe(404);
    }
    for (const patch of [{ title: "Changed", status: "done" }, { amount_cents: 500 }, { due_at: "2030-02-30T00:00:00Z" }, { source: "system" }]) {
      expect((await detail.PATCH(await h.request(`/v1/obligations/${created.id}`, { method: "PATCH", body: patch }))).status).toBe(400);
    }
    for (const [user, status] of [[h.viewer, 403], [null, 401]] as const) expect((await detail.PATCH(await h.request(`/v1/obligations/${created.id}`, { method: "PATCH", user, body: { title: "Denied" } }))).status).toBe(status);
    expect((await detail.PATCH(await h.request(`/v1/obligations/${randomUUID()}`, { method: "PATCH", body: { title: "Absent" } }))).status).toBe(404);
  });
});
