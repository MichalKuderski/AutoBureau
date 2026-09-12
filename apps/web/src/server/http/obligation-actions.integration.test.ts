import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let route: typeof import("@/app/v1/obligations/[id]/route");
beforeAll(async () => { h = await domainHarness(); route = await import("@/app/v1/obligations/[id]/route"); });
afterAll(async () => h?.close());
async function seed(householdId = h.household) {
  return h.admin.obligation.create({ data: { id: randomUUID(), householdId, title: "Renew cover", kind: "renewal", source: "user", dueAt: new Date(Date.now() + 7 * 86_400_000) } });
}
async function patch(id: string, body: unknown, user = h.owner) {
  return route.PATCH(await h.request(`/v1/obligations/${id}`, { method: "PATCH", body, user }));
}

describe("persisted obligation lifecycle", () => {
  it("completes once under concurrent requests, cancels pending reminders, and commits one event", async () => {
    const row = await seed();
    await h.admin.reminder.createMany({ data: [
      { id: randomUUID(), householdId: h.household, obligationId: row.id, remindAt: new Date(), offsetLabel: "7d", status: "scheduled" },
      { id: randomUUID(), householdId: h.household, obligationId: row.id, remindAt: new Date(), offsetLabel: "30d", status: "sent" },
    ] });
    const body = { status: "done", outcome: { done_via: "manual", cost_cents: 1999, process_matched: true, note: "Private household note" } };
    const results = await Promise.all([patch(row.id, body), patch(row.id, body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await results[0]!.json()).toMatchObject(body);
    expect((await h.admin.obligation.findUniqueOrThrow({ where: { id: row.id } })).outcome).toEqual(body.outcome);
    expect(await h.admin.auditLog.count({ where: { targetType: "obligation", targetId: row.id, action: "obligation.completed", actorId: h.owner } })).toBe(1);
    const events = await h.admin.outboxEvent.findMany({ where: { aggregateId: row.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "obligation.completed", payload: { status: "done", previous_status: "upcoming" } });
    expect(JSON.stringify(events, (_, v: unknown) => typeof v === "bigint" ? v.toString() : v)).not.toContain("Private household note");
    expect((await h.admin.reminder.findMany({ where: { obligationId: row.id }, orderBy: { offsetLabel: "asc" } })).map((r) => r.status).sort()).toEqual(["cancelled", "sent"]);
  });
  it("reopens with a cleared current outcome and an auditable new materialization intent", async () => {
    const row = await seed();
    await patch(row.id, { status: "done", outcome: { done_via: "external" } });
    const response = await patch(row.id, { status: "in_progress" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "in_progress", outcome: null });
    expect(await h.admin.auditLog.count({ where: { targetId: row.id, action: "obligation.reopened" } })).toBe(1);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: row.id, eventType: "obligation.updated" } })).toBe(1);
  });
  it("does not reset the dismissal recovery window on a repeated request", async () => {
    const row = await seed();
    await patch(row.id, { status: "dismissed" });
    const expired = new Date(Date.now() - 31 * 86_400_000);
    await h.admin.obligation.update({ where: { id: row.id }, data: { updatedAt: expired } });
    expect((await patch(row.id, { status: "dismissed" })).status).toBe(200);
    expect((await patch(row.id, { status: "upcoming" })).status).toBe(409);
    expect((await h.admin.obligation.findUniqueOrThrow({ where: { id: row.id } })).updatedAt).toEqual(expired);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(1);
  });
  it("rejects foreign, absent, unauthenticated and read-only writes without side effects", async () => {
    const row = await seed(), foreign = await seed(h.foreignHousehold);
    expect((await patch(foreign.id, { status: "done" })).status).toBe(404);
    expect((await patch(randomUUID(), { status: "done" })).status).toBe(404);
    expect((await patch(row.id, { status: "done" }, h.viewer)).status).toBe(403);
    expect((await route.PATCH(await h.request(`/v1/obligations/${row.id}`, { method: "PATCH", user: null, body: { status: "done" } }))).status).toBe(401);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: { in: [row.id, foreign.id] } } })).toBe(0);
    expect((await h.admin.obligation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("upcoming");
  });
  it.each([
    { status: "done", household_id: randomUUID() },
    { status: "done", outcome: { done_via: "invalid" } },
    { status: "done", outcome: { done_via: "manual", cost_cents: 1.1 } },
    { status: "upcoming", outcome: { done_via: "manual" } },
    { status: "unknown" },
  ])("rejects invalid transition payload %#", async (body) => {
    const row = await seed();
    expect((await patch(row.id, body)).status).toBe(400);
    expect(await h.admin.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(0);
  });
});
