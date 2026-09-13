import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let list: typeof import("@/app/v1/items/route");
let detail: typeof import("@/app/v1/items/[id]/route");
let savedId: string;
const person = randomUUID(), foreignPerson = randomUUID(), archivedPerson = randomUUID(), foreignItem = randomUUID();
const canary = "private-user-entered-name";
const body = { name: canary, kind: "insurance_policy", member_id: person, amount_cents: 12550, currency: "USD",
  valid_from: "2026-01-01", expires_at: "2026-12-31" };
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.householdMember.createMany({ data: [
    { id: person, householdId: h.household, displayName: "Parent", kind: "dependent" },
    { id: archivedPerson, householdId: h.household, displayName: "Archived", kind: "adult", archivedAt: new Date() },
    { id: foreignPerson, householdId: h.foreignHousehold, displayName: "Foreign", kind: "adult" },
  ] });
  await h.admin.item.create({ data: { id: foreignItem, householdId: h.foreignHousehold, name: "Foreign record", kind: "other" } });
  [list, detail] = await Promise.all([import("@/app/v1/items/route"), import("@/app/v1/items/[id]/route")]);
});
afterAll(async () => h?.close());

describe("manual records through the tenant boundary", () => {
  it("creates a real record and replays one submission without duplicate rows or effects", async () => {
    const headers = { "idempotency-key": randomUUID() };
    const first = await list.POST(await h.request("/v1/items", { method: "POST", body, headers }));
    expect(first.status).toBe(201);
    const saved = await first.json(); savedId = saved.id;
    expect(first.headers.get("location")).toBe(`/v1/items/${saved.id}`);
    expect(saved).toMatchObject({ household_id: h.household, member_name: "Parent", amount_cents: 12550,
      source_document_id: null, verified_at: null, expires_at: "2026-12-31", secrets: [] });
    const replay = await list.POST(await h.request("/v1/items", { method: "POST", body, headers }));
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(saved);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(1);
    const events = await h.admin.outboxEvent.findMany({ where: { aggregateId: saved.id, eventType: "item.created" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toContain(canary);
    const audit = await h.admin.auditLog.findMany({ where: { targetId: saved.id, targetType: "item" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "item.create", actorId: h.owner, householdId: h.household });
  });
  it("saves edits, leaves absent fields alone and emits nothing for an exact repeat", async () => {
    await h.admin.item.update({ where: { id: savedId }, data: { verifiedAt: new Date() } });
    const edit = { name: "Revised record", amount_cents: null, currency: null };
    for (let i = 0; i < 2; i++) {
      const response = await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: edit }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ name: "Revised record", amount_cents: null, currency: null,
        member_id: person, expires_at: "2026-12-31", verified_at: null });
    }
    expect(await h.admin.auditLog.count({ where: { targetId: savedId, action: "item.update" } })).toBe(1);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: savedId, eventType: "item.updated" } })).toBe(1);
  });
  it("does not link foreign, missing or archived people", async () => {
    for (const member_id of [foreignPerson, archivedPerson, randomUUID()]) {
      expect((await list.POST(await h.request("/v1/items", { method: "POST", body: { ...body, member_id } }))).status).toBe(404);
      expect((await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: { member_id } }))).status).toBe(404);
    }
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("rejects forged scope and write privileges, including unauthenticated requests", async () => {
    for (const [user, expected] of [[h.viewer, 403], [null, 401]] as const) {
      expect((await list.POST(await h.request("/v1/items", { method: "POST", body, user }))).status).toBe(expected);
      expect((await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: { name: "Attack" }, user }))).status).toBe(expected);
    }
    expect((await list.POST(await h.request("/v1/items", { method: "POST", body, headers: { "x-household-id": h.foreignHousehold } }))).status).toBe(403);
    for (const id of [foreignItem, randomUUID()]) expect((await detail.PATCH(await h.request(`/v1/items/${id}`, { method: "PATCH", body: { name: "Attack" } }))).status).toBe(404);
  });
  it("rejects identifier/authority fields, float amounts and contradictory dates", async () => {
    for (const invalid of [{ name: " " }, { attrs: { account_number: "123" } }, { household_id: h.foreignHousehold },
      { source_document_id: randomUUID() }, { verified_at: new Date().toISOString() }, { amount_cents: 1.25 },
      { amount_cents: -1 }, { currency: null }, { valid_from: "2027-01-01" }, { expires_at: "2026-02-30" }]) {
      expect((await list.POST(await h.request("/v1/items", { method: "POST", body: { ...body, ...invalid } }))).status).toBe(400);
    }
    expect((await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: { currency: "USD" } }))).status).toBe(400);
    expect((await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: { valid_from: "2027-01-01" } }))).status).toBe(400);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("treats empty and unchanged patches as reads, with no audit or event write", async () => {
    const before = await h.admin.auditLog.count({ where: { householdId: h.household } });
    for (const patch of [{}, { name: "Revised record" }]) expect((await detail.PATCH(await h.request(`/v1/items/${savedId}`, { method: "PATCH", body: patch }))).status).toBe(200);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(before);
  });
});
