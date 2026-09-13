import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultNotificationPreferences, defaultNotificationSchedule, type NotificationView, type NotificationSettingsView, type Page } from "@autobureau/contracts";
import { domainHarness } from "@/test/integration/domain-harness";
let h: Awaited<ReturnType<typeof domainHarness>>;
let feed: typeof import("@/app/v1/notifications/route"), readRoute: typeof import("@/app/v1/notifications/read/route"), prefs: typeof import("@/app/v1/me/notification-settings/route");
const own = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
const foreignUser = randomUUID(), foreignHousehold = randomUUID(), obligation = randomUUID(), foreignTarget = randomUUID();
const canary = "foreign-notification-or-provider-secret";
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.obligation.createMany({ data: [
    { id: obligation, householdId: h.household, title: "Own deadline", kind: "renewal", source: "user", dueAt: new Date() },
    { id: foreignTarget, householdId: h.foreignHousehold, title: canary, kind: "renewal", source: "user", dueAt: new Date() },
  ] });
  await h.admin.notification.createMany({ data: [
    ...own.map((id, index) => ({ id, householdId: h.household, userId: h.owner, kind: index === 3 ? "security" : "obligation.due_soon", title: `Own ${index}`, body: "Saved notice", dedupeKey: id,
      targetType: index < 2 ? "obligation" : null, targetId: index === 0 ? obligation : index === 1 ? foreignTarget : null })),
    { id: foreignUser, householdId: h.household, userId: h.viewer, kind: "security", title: canary, body: canary, dedupeKey: "one" },
    { id: foreignHousehold, householdId: h.foreignHousehold, userId: h.owner, kind: "security", title: canary, body: canary, dedupeKey: "one" },
  ] });
  await h.admin.$executeRaw`UPDATE notifications SET created_at = '2026-09-01T12:00:00.123456Z'::timestamptz WHERE household_id = ${h.household}::uuid`;
  await h.admin.notificationDelivery.create({ data: { notificationId: own[0]!, channel: "email", providerMessageId: canary } });
  [feed, readRoute, prefs] = await Promise.all([import("@/app/v1/notifications/route"), import("@/app/v1/notifications/read/route"), import("@/app/v1/me/notification-settings/route")]);
});
afterAll(async () => h?.close());
async function notices(query = "", options?: Parameters<typeof h.request>[1]): Promise<Page<NotificationView>> {
  const response = await feed.GET(await h.request(`/v1/notifications${query}`, options)); expect(response.status).toBe(200); return response.json();
}
async function settings(): Promise<NotificationSettingsView> {
  const response = await prefs.GET(await h.request("/v1/me/notification-settings")); expect(response.status).toBe(200); return response.json();
}
const save = (body: unknown, options: Parameters<typeof h.request>[1] = {}) => h.request("/v1/me/notification-settings", { method: "PATCH", body, ...options }).then(prefs.PATCH);

describe("persistent notification feed and preferences", () => {
  it("paginates all own notices with exact timestamp precision and no recipient/provider leakage", async () => {
    const rows: NotificationView[] = []; let cursor: string | null = null;
    do { const page = await notices(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); rows.push(...page.data); cursor = page.next_cursor; } while (cursor && rows.length < 10);
    expect(rows.map((row) => row.id)).toEqual([...own].sort().reverse());
    expect(rows.every((row) => row.created_at === "2026-09-01T12:00:00.123456Z")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(canary); expect(JSON.stringify(rows)).not.toContain(foreignTarget);
    expect(rows.find((row) => row.id === own[0])?.href).toBe(`/obligations/${obligation}`);
    expect(rows.find((row) => row.id === own[1])?.href).toBeNull();
    expect(rows.find((row) => row.id === own[3])?.href).toBe("/settings/profile");
  });
  it("binds cursors to the principal and lens, and rejects unbounded or unknown query parameters", async () => {
    const cursor = encodeURIComponent((await notices("?limit=1")).next_cursor!);
    expect((await feed.GET(await h.request(`/v1/notifications?cursor=${cursor}`, { user: h.viewer }))).status).toBe(400);
    for (const q of [`lens=unread&cursor=${cursor}`, "lens=invalid", "limit=101", "sort=title", "cursor=bad"]) expect((await feed.GET(await h.request(`/v1/notifications?${q}`))).status).toBe(400);
  });
  it("marks only owned notices, preserves timestamps on repeat and does not change delivery state", async () => {
    const request = () => h.request("/v1/notifications/read", { method: "POST", body: { ids: [own[0], own[0], foreignUser, foreignHousehold, randomUUID()] } });
    expect(await (await readRoute.POST(await request())).json()).toEqual({ read_ids: [own[0]], changed: 1 });
    const first = await h.admin.notification.findUniqueOrThrow({ where: { id: own[0] } });
    const audits = await h.admin.auditLog.count({ where: { householdId: h.household } });
    expect(await (await readRoute.POST(await request())).json()).toEqual({ read_ids: [own[0]], changed: 0 });
    expect((await h.admin.notification.findUniqueOrThrow({ where: { id: own[0] } })).readAt).toEqual(first.readAt);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(audits);
    expect((await h.admin.notification.findMany({ where: { id: { in: [foreignUser, foreignHousehold] } } })).every((row) => row.readAt === null)).toBe(true);
    expect(await h.admin.notificationDelivery.findFirst({ where: { notificationId: own[0] } })).toMatchObject({ status: "queued", providerMessageId: canary });
    expect((await notices("?lens=unread&limit=1")).data[0]?.read_at).toBeNull();
    expect((await notices("?lens=unread")).data).toHaveLength(3);
  });
  it("requires authentication, scope and CSRF and rejects forged batch fields", async () => {
    expect((await feed.GET(await h.request("/v1/notifications", { user: null }))).status).toBe(401);
    expect((await feed.GET(await h.request("/v1/notifications", { headers: { "x-household-id": h.foreignHousehold } }))).status).toBe(403);
    expect((await readRoute.POST(await h.request("/v1/notifications/read", { method: "POST", body: { ids: [own[0]] }, headers: { "x-autobureau-request": "" } }))).status).toBe(403);
    for (const body of [{ ids: [] }, { ids: Array(101).fill(own[0]) }, { ids: [own[0]], user_id: h.viewer }, { ids: ["bad"] }]) expect((await readRoute.POST(await h.request("/v1/notifications/read", { method: "POST", body }))).status).toBe(400);
    expect((await notices("", { user: h.viewer })).data.map((row) => row.id)).toEqual([foreignUser]);
  });
  it("returns the specified defaults without writing and never opts into urgent overrides", async () => {
    expect(await settings()).toMatchObject({ preferences: defaultNotificationPreferences(), schedule: defaultNotificationSchedule() });
    expect(await h.admin.notificationPreference.count({ where: { userId: h.owner } })).toBe(0);
  });
  it("persists a complete validated preference matrix and schedule while preserving other profile namespaces", async () => {
    await h.admin.userProfile.update({ where: { userId: h.owner }, data: { onboarding: { households: { preserved: true }, future: { untouched: true } } } });
    const initial = await settings();
    const body = { preferences: initial.preferences.map((row) => row.kind === "obligation.due_soon" && row.channel === "email" ? { ...row, enabled: false } : row),
      schedule: { ...initial.schedule, quiet_start: "22:15", quiet_end: "07:45", digest_day: 2, urgent_override: true } };
    expect((await save(body)).status).toBe(200);
    expect(await settings()).toMatchObject(body);
    expect((await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } })).onboarding).toMatchObject({ households: { preserved: true }, future: { untouched: true }, notifications: { version: 1, schedule: body.schedule } });
    expect(await h.admin.notificationPreference.count({ where: { userId: h.owner } })).toBe(1);
    expect(await h.admin.notificationPreference.count({ where: { userId: h.viewer } })).toBe(0);
    expect(await h.admin.auditLog.findMany({ where: { householdId: h.household, action: "notification.preferences_changed" } })).toMatchObject([{ actorId: h.owner, targetId: h.owner }]);
    const count = await h.admin.auditLog.count({ where: { householdId: h.household } });
    expect((await save(body)).status).toBe(200);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(count);
  });
  it("rejects security suppression, duplicate/incomplete kinds, forged scope and invalid clocks atomically", async () => {
    const { timezone: _timezone, ...body } = await settings();
    const invalid = [
      { ...body, preferences: body.preferences.map((row) => row.kind === "security" ? { ...row, enabled: false } : row) },
      { ...body, preferences: body.preferences.map(() => body.preferences[0]) },
      { ...body, preferences: body.preferences.slice(1) }, { ...body, user_id: h.viewer },
      { ...body, schedule: { ...body.schedule, quiet_start: "25:00" } },
      { ...body, schedule: { ...body.schedule, quiet_start: body.schedule.quiet_end } },
    ];
    const count = await h.admin.auditLog.count({ where: { householdId: h.household } });
    for (const bad of invalid) expect((await save(bad)).status).toBe(400);
    expect(await settings()).toMatchObject(body);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(count);
    expect((await save(body, { user: h.viewer })).status).toBe(403);
    expect((await save(body, { user: null })).status).toBe(401);
  });
  it("fails visibly on unknown saved versions without replacing the existing state", async () => {
    await h.admin.userProfile.update({ where: { userId: h.owner }, data: { onboarding: { notifications: { version: 2 } } } });
    expect((await prefs.GET(await h.request("/v1/me/notification-settings"))).status).toBe(503);
    expect((await save({ preferences: defaultNotificationPreferences(), schedule: defaultNotificationSchedule() })).status).toBe(503);
    expect((await h.admin.userProfile.findUniqueOrThrow({ where: { userId: h.owner } })).onboarding).toEqual({ notifications: { version: 2 } });
  });
});
