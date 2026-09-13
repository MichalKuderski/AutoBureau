import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let route: typeof import("@/app/v1/onboarding/route");
const ref = randomUUID(), foreignMember = randomUUID();
let memberId: string;
const payload = { stage: "census", caring_for: "self_and_elder", members: [{ client_ref: ref, member_id: null, display_name: "Parent", kind: "dependent" }],
  selections: ["medicare", "home_insurance"], census_subject_ref: ref };
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.entitlement.create({ data: { householdId: h.household, periodStart: new Date(), membersMax: 1 } });
  await h.admin.householdMember.create({ data: { id: foreignMember, householdId: h.foreignHousehold, displayName: "Foreign", kind: "adult" } });
  route = await import("@/app/v1/onboarding/route");
});
afterAll(async () => h?.close());
const save = async (body: unknown, user?: string) => route.PATCH(await h.request("/v1/onboarding", { method: "PATCH", body, ...(user ? { user } : {}) }));

describe("persistent household setup", () => {
  it("starts from real empty state with no fixture or mutation on GET", async () => {
    const response = await route.GET(await h.request("/v1/onboarding"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ household_id: h.household, members: [], selections: [], records_saved: 0, documents_added: 0, complete: false });
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(0);
  });
  it("serializes concurrent retries and creates only unverified records, never uncited deadlines", async () => {
    const responses = await Promise.all([save(payload), save(payload)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const first = await responses[0]!.json(), second = await responses[1]!.json();
    expect(first).toEqual(second); memberId = first.members[0].member_id;
    expect(first).toMatchObject({ selections: payload.selections, records_saved: 2, census_subject_ref: ref });
    expect(await h.admin.householdMember.count({ where: { householdId: h.household } })).toBe(1);
    const items = await h.admin.item.findMany({ where: { householdId: h.household } });
    expect(items).toHaveLength(2);
    expect(items.every((row) => row.memberId === memberId && row.verifiedAt === null && row.expiresAt === null && row.sourceDocumentId === null)).toBe(true);
    expect(await h.admin.obligation.count({ where: { householdId: h.household } })).toBe(0);
    expect(await h.admin.reminder.count({ where: { householdId: h.household } })).toBe(0);
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household, eventType: "item.created" } })).toBe(2);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, targetType: "item", action: "item.create" } })).toBe(2);
  });
  it("resumes saved answers, updates completion and emits nothing for another identical save", async () => {
    const response = await route.GET(await h.request("/v1/onboarding"));
    expect(await response.json()).toMatchObject({ members: [{ client_ref: ref, member_id: memberId, display_name: "Parent" }], selections: payload.selections, records_saved: 2 });
    expect((await save({ ...payload, stage: "complete" })).status).toBe(200);
    const before = await h.admin.auditLog.count({ where: { householdId: h.household } });
    expect((await save({ ...payload, stage: "complete" })).status).toBe(200);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(before);
    expect((await (await route.GET(await h.request("/v1/onboarding"))).json()).complete).toBe(true);
  });
  it("rolls the entire setup back on a capacity error", async () => {
    const second = { client_ref: randomUUID(), member_id: null, display_name: "Second person", kind: "adult" };
    const before = await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } });
    const response = await save({ ...payload, members: [{ ...payload.members[0], display_name: "Changed before failure" }, second], selections: ["passport"] });
    expect(response.status).toBe(402);
    expect((await h.admin.householdMember.findUniqueOrThrow({ where: { id: memberId } })).displayName).toBe("Parent");
    expect((await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } })).onboarding).toEqual(before.onboarding);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(2);
  });
  it("measures only confirmed census records and excludes unrelated, foreign and archived records", async () => {
    const dashboard = await import("@/app/v1/dashboard/route");
    const coverage = async () => (await (await dashboard.GET(await h.request("/v1/dashboard"))).json()).coverage;
    const selected = await h.admin.item.findFirstOrThrow({ where: { householdId: h.household } });
    const unrelated = randomUUID(), foreign = randomUUID();
    await h.admin.item.createMany({ data: [
      { id: unrelated, householdId: h.household, name: "Unrelated verified record", kind: "vehicle", verifiedAt: new Date() },
      { id: foreign, householdId: h.foreignHousehold, name: "Foreign verified record", kind: "vehicle", verifiedAt: new Date() },
    ] });
    expect(await coverage()).toEqual({ captured: 0, expected: 2 });
    await h.admin.item.update({ where: { id: selected.id }, data: { verifiedAt: new Date() } });
    expect(await coverage()).toEqual({ captured: 1, expected: 2 });
    await h.admin.item.update({ where: { id: selected.id }, data: { status: "archived" } });
    expect(await coverage()).toEqual({ captured: 0, expected: 2 });
    const profile = await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } });
    const root = structuredClone(profile.onboarding) as { households: Record<string, { seeded_items: Record<string, string> }> };
    const mappings = root.households[h.household]!.seeded_items;
    for (const key of Object.keys(mappings)) mappings[key] = foreign;
    await h.admin.userProfile.update({ where: { userId: h.owner }, data: { onboarding: root } });
    expect(await coverage()).toEqual({ captured: 0, expected: 2 });
    await h.admin.userProfile.update({ where: { userId: h.owner }, data: { onboarding: profile.onboarding! } });
    await h.admin.item.update({ where: { id: selected.id }, data: { status: "active", verifiedAt: null } });
    await h.admin.item.deleteMany({ where: { id: { in: [unrelated, foreign] } } });
  });
  it("refuses forged member links, authority fields, invalid prompts and unauthorized callers", async () => {
    expect((await save({ ...payload, members: [{ ...payload.members[0], client_ref: randomUUID(), member_id: foreignMember }], census_subject_ref: null })).status).toBe(404);
    for (const extra of [{ selections: ["invented"] }, { selections: ["medicare", "medicare"] }, { household_id: h.foreignHousehold }, { seeded_items: {} }, { census_subject_ref: randomUUID() }]) {
      expect((await save({ ...payload, ...extra })).status).toBe(400);
    }
    expect((await save(payload, h.viewer)).status).toBe(403);
    expect((await route.GET(await h.request("/v1/onboarding", { user: h.viewer }))).status).toBe(403);
    expect((await route.GET(await h.request("/v1/onboarding", { user: null }))).status).toBe(401);
  });
  it("does not resurrect a deleted census record or delete one when an answer is unticked", async () => {
    const item = await h.admin.item.findFirstOrThrow({ where: { householdId: h.household } });
    await h.admin.item.delete({ where: { id: item.id } });
    expect((await save(payload)).status).toBe(200);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(1);
    expect((await save({ ...payload, selections: [] })).status).toBe(200);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(1);
  });
  it("keeps concurrent progress in two authorized households separate", async () => {
    await h.admin.householdUser.create({ data: { householdId: h.foreignHousehold, userId: h.owner, role: "owner" } });
    await h.admin.entitlement.create({ data: { householdId: h.foreignHousehold, periodStart: new Date() } });
    const body = { stage: "census", caring_for: "self", members: [], selections: ["passport"], census_subject_ref: null };
    const results = await Promise.all([h.household, h.foreignHousehold].map(async (householdId) => route.PATCH(await h.request("/v1/onboarding", {
      method: "PATCH", body, headers: { "x-household-id": householdId },
    }))));
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    for (const householdId of [h.household, h.foreignHousehold]) {
      const response = await route.GET(await h.request("/v1/onboarding", { headers: { "x-household-id": householdId } }));
      expect(await response.json()).toMatchObject({ household_id: householdId, selections: ["passport"], records_saved: 1 });
    }
    const profile = await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } });
    expect(Object.keys((profile.onboarding as { households: object }).households).sort()).toEqual([h.household, h.foreignHousehold].sort());
  });
  it("fails closed on an unknown stored version rather than resetting and reseeding", async () => {
    const profile = await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } });
    const root = profile.onboarding as { households: Record<string, { version: number }> };
    root.households[h.household]!.version = 999;
    await h.admin.userProfile.update({ where: { userId: h.owner }, data: { onboarding: root } });
    const before = await h.admin.item.count({ where: { householdId: h.household } });
    const headers = { "x-household-id": h.household };
    expect((await route.GET(await h.request("/v1/onboarding", { headers }))).status).toBe(503);
    expect((await route.PATCH(await h.request("/v1/onboarding", { method: "PATCH", body: payload, headers }))).status).toBe(503);
    expect(await h.admin.item.count({ where: { householdId: h.household } })).toBe(before);
  });
});
