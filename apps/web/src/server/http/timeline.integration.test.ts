import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor, type Page, type TimelineEntry } from "@autobureau/contracts";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let route: typeof import("@/app/v1/timeline/route");
let status: typeof import("@/app/v1/obligations/[id]/route");
const own = randomUUID(), foreign = randomUUID(), missing = randomUUID();
const canary = "private-audit-meta-and-foreign-title";
const seeded: string[] = [];
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.obligation.createMany({ data: [
    { id: own, householdId: h.household, title: "Saved deadline", kind: "renewal", source: "user", dueAt: new Date() },
    { id: foreign, householdId: h.foreignHousehold, title: canary, kind: "renewal", source: "user", dueAt: new Date() },
  ] });
  for (const [target, action, type] of [[own, "obligation.create", "obligation"], [foreign, "obligation.create", "obligation"],
    [missing, "item.create", "item"], [missing, "document.create", "document"]]) {
    const rows = await h.admin.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO public.audit_log (household_id, actor_type, action, target_type, target_id, meta, created_at)
      VALUES (${h.household}::uuid, 'system', ${action}, ${type}, ${target}::uuid,
        ${JSON.stringify({ canary })}::jsonb, '2026-09-01T12:00:00.123456Z'::timestamptz) RETURNING id
    `;
    seeded.push(rows[0]!.id.toString());
  }
  await h.admin.auditLog.createMany({ data: [
    { householdId: h.foreignHousehold, actorType: "system", action: "obligation.create", targetType: "obligation", targetId: foreign },
    { householdId: h.household, actorType: "system", action: "secret.revealed", targetType: "item", targetId: missing },
    { householdId: h.household, actorType: "system", action: "obligation.completed", targetType: "outboxevent" },
  ] });
  [route, status] = await Promise.all([import("@/app/v1/timeline/route"), import("@/app/v1/obligations/[id]/route")]);
});
afterAll(async () => h?.close());
async function read(query = "", options?: Parameters<typeof h.request>[1]): Promise<Page<TimelineEntry>> {
  const response = await route.GET(await h.request(`/v1/timeline${query}`, options));
  expect(response.status).toBe(200);
  return response.json();
}

describe("tenant audit history", () => {
  it("paginates every microsecond-precision audit row once in deterministic order", async () => {
    const seen: TimelineEntry[] = [];
    let cursor: string | null = null;
    do {
      const page = await read(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...page.data); cursor = page.next_cursor;
    } while (cursor && seen.length < 10);
    expect(cursor).toBeNull();
    expect(seen.map((row) => row.id)).toEqual([...seeded].reverse());
    expect(seen.every((row) => row.at === "2026-09-01T12:00:00.123456Z")).toBe(true);
  });
  it("applies filters before pagination and binds cursors to the household and lens", async () => {
    const first = await read("?lens=obligations&limit=1");
    expect(first.data[0]!.id).toBe(seeded[1]);
    const encoded = encodeURIComponent(first.next_cursor!);
    const second = await read(`?lens=obligations&limit=1&cursor=${encoded}`);
    expect(second.data.map((row) => row.id)).toEqual([seeded[0]]);
    expect(second.next_cursor).toBeNull();
    for (const [query, options] of [[`?lens=items&cursor=${encoded}`, undefined], [`?lens=obligations&cursor=${encoded}`, { user: h.outsider }]] as const) {
      expect((await route.GET(await h.request(`/v1/timeline${query}`, options))).status).toBe(400);
    }
  });
  it("never leaks metadata, foreign targets or nonexistent destinations", async () => {
    const page = await read();
    expect(JSON.stringify(page)).not.toContain(canary);
    expect(JSON.stringify(page)).not.toContain(foreign);
    expect(JSON.stringify(page)).not.toContain(missing);
    expect(page.data.find((row) => row.id === seeded[0])).toMatchObject({ href: `/obligations/${own}`, detail: "Current record: Saved deadline" });
    for (const row of page.data.filter((row) => row.id !== seeded[0])) {
      expect(row.href).toBeUndefined();
      expect(row.detail).toBe("The original record is no longer available.");
    }
    expect((await read("?lens=items", { user: h.outsider })).data).toEqual([]);
  });
  it("enforces authentication, validated scope and bounded parameters", async () => {
    expect((await route.GET(await h.request("/v1/timeline", { user: null }))).status).toBe(401);
    expect((await route.GET(await h.request("/v1/timeline", { headers: { "x-household-id": h.foreignHousehold } }))).status).toBe(403);
    expect((await read("", { user: h.viewer })).data).toHaveLength(4);
    const first = await read("?limit=1");
    const fingerprint = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString()).f;
    for (const query of ["lens=invalid", "limit=101", "cursor=bad", "sort=id", `cursor=${encodeURIComponent(encodeCursor(["2026-09-01T00:00:00Z", "9999999999999999999"], fingerprint))}`]) {
      expect((await route.GET(await h.request(`/v1/timeline?${query}`))).status).toBe(400);
    }
  });
  it("shows one lifecycle entry per completion or reopen despite supporting audit writes", async () => {
    expect((await status.PATCH(await h.request(`/v1/obligations/${own}`, { method: "PATCH", body: { status: "done" } }))).status).toBe(200);
    expect((await status.PATCH(await h.request(`/v1/obligations/${own}`, { method: "PATCH", body: { status: "done" } }))).status).toBe(200);
    expect((await status.PATCH(await h.request(`/v1/obligations/${own}`, { method: "PATCH", body: { status: "upcoming" } }))).status).toBe(200);
    const page = await read("?lens=obligations");
    expect(page.data.filter((row) => row.kind === "obligation_completed")).toHaveLength(1);
    expect(page.data.filter((row) => row.kind === "obligation_status_changed")).toHaveLength(1);
    expect(page.data.filter((row) => row.kind === "value_found")).toHaveLength(0);
  });
});
