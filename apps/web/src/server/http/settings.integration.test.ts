import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let me: typeof import("@/app/v1/me/route");
let household: typeof import("@/app/v1/households/[id]/route");
beforeAll(async () => {
  h = await domainHarness();
  me = await import("@/app/v1/me/route");
  household = await import("@/app/v1/households/[id]/route");
});
afterAll(async () => h?.close());

describe("persisted settings through real JWT, CSRF and RLS", () => {
  it("saves only the authenticated profile, returns it on a new read and audits the actor", async () => {
    const response = await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: { display_name: "New name", timezone: "America/Chicago" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user_id: h.owner, display_name: "New name", timezone: "America/Chicago" });
    expect(await (await me.GET(await h.request("/v1/me"))).json()).toMatchObject({ display_name: "New name" });
    expect(await h.admin.userProfile.findUnique({ where: { userId: h.outsider } })).toMatchObject({ displayName: "Other person", timezone: "America/New_York" });
    expect(await h.admin.auditLog.findMany({ where: { householdId: h.household, action: "userprofile.update" } })).toMatchObject([{ actorId: h.owner, actorType: "user" }]);
  });
  it("a viewer may edit their own profile but cannot change the household", async () => {
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", user: h.viewer, body: { display_name: "Viewer name" } }))).status).toBe(200);
    expect((await household.PATCH(await h.request(`/v1/households/${h.household}`, { method: "PATCH", user: h.viewer, body: { name: "Not allowed" } }))).status).toBe(403);
    expect(await h.admin.household.findUnique({ where: { id: h.household } })).toMatchObject({ name: "Our household" });
  });
  it("saves the owned household with an explicit privileged audit action", async () => {
    const response = await household.PATCH(await h.request(`/v1/households/${h.household}`, { method: "PATCH", body: { name: "  Updated household  " } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: h.household, name: "Updated household" });
    expect(await h.admin.household.findUnique({ where: { id: h.household } })).toMatchObject({ name: "Updated household" });
    expect(await h.admin.auditLog.findMany({ where: { action: "household.settings_changed", householdId: h.household } })).toMatchObject([{ actorId: h.owner, targetId: h.household }]);
  });
  it("foreign and absent household paths are indistinguishable and do not mutate", async () => {
    const responses = await Promise.all([h.foreignHousehold, randomUUID()].map(async (id) => household.PATCH(await h.request(`/v1/households/${id}`, { method: "PATCH", body: { name: "Attack" } }))));
    expect(responses.map((r) => r.status)).toEqual([404, 404]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect(await h.admin.household.findUnique({ where: { id: h.foreignHousehold } })).toMatchObject({ name: "Foreign household" });
  });
  it("empty and identical patches create no additional audit rows", async () => {
    const before = await h.admin.auditLog.count({ where: { householdId: h.household } });
    for (const body of [{}, { name: "Updated household" }]) {
      expect((await household.PATCH(await h.request(`/v1/households/${h.household}`, { method: "PATCH", body }))).status).toBe(200);
    }
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: {} }))).status).toBe(200);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(before);
  });
  it.each([{ user_id: "forged" }, { email: "someone@example.test" }, { display_name: null }, { display_name: "  " }, { timezone: "Unknown/Mars" }])("rejects immutable or invalid profile fields: %j", async (body) => {
    const response = await me.PATCH(await h.request("/v1/me", { method: "PATCH", body }));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("bounds actual request bytes and rejects malformed JSON before a write", async () => {
    const before = await h.admin.auditLog.count({ where: { householdId: h.household } });
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", rawBody: "{" }))).status).toBe(400);
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: { display_name: "a".repeat(9000) }, headers: { "content-length": "1" } }))).status).toBe(413);
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: {}, headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household } })).toBe(before);
  });
  it("requires a session, validated membership and CSRF even for a profile patch", async () => {
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", user: null, body: {} }))).status).toBe(401);
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: {}, headers: { "x-household-id": h.foreignHousehold } }))).status).toBe(403);
    expect((await me.PATCH(await h.request("/v1/me", { method: "PATCH", body: {}, headers: { "x-autobureau-request": "" } }))).status).toBe(403);
  });
});
