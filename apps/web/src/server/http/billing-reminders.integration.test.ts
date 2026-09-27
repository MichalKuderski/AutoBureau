import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let billing: typeof import("@/app/v1/households/[id]/billing/route");
let reminders: typeof import("@/app/v1/obligations/[id]/reminders/route");
let obligation: string;
beforeAll(async () => {
  h = await domainHarness();
  [billing, reminders] = await Promise.all([import("@/app/v1/households/[id]/billing/route"), import("@/app/v1/obligations/[id]/reminders/route")]);
  await h.admin.entitlement.create({ data: { householdId: h.household, periodStart: new Date() } });
  const item = await h.admin.item.create({ data: { householdId: h.household, kind: "other", name: "PUBLIC item" } });
  obligation = (await h.admin.obligation.create({ data: { householdId: h.household, itemId: item.id, title: "PUBLIC deadline", kind: "custom", source: "user", dueAt: new Date(Date.now() + 10 * 86400000) } })).id;
  await h.admin.reminder.create({ data: { householdId: h.household, obligationId: obligation, remindAt: new Date(Date.now() + 3 * 86400000), offsetLabel: "7 days before" } });
});
afterAll(async () => {
  if (h) {
    const where = { householdId: h.household };
    await h.admin.reminder.deleteMany({ where }); await h.admin.obligation.deleteMany({ where }); await h.admin.item.deleteMany({ where });
    await h.admin.stripeTestState.deleteMany({ where }); await h.admin.stripeTestIntent.deleteMany({ where }); await h.admin.stripeTestRoute.deleteMany({ where });await h.admin.stripeTestCheckout.deleteMany({ where });await h.admin.stripeTestBinding.deleteMany({ where });
    await h.admin.entitlement.deleteMany({ where }); await h.close();
  }
});
describe("billing status and reminder status routes", () => {
  it("reports Free with no billing state, then the stored grace state; owner only", async () => {
    const path = `/v1/households/${h.household}/billing`;
    const free = await billing.GET(await h.request(path));
    expect(free.status).toBe(200);
    expect(await free.json()).toMatchObject({ tier: "free", state: "none", paymentUpdateAvailable: false, checkoutAvailable: false });
    const b = await h.admin.stripeTestBinding.create({ data: { householdId: h.household, ownerId: h.owner, accountId: "acct_Synthetic", customerId: "cus_" + randomUUID().replaceAll("-", ""), subscriptionId: "sub_" + randomUUID().replaceAll("-", ""), livemode: false } });
    const intent = await h.admin.stripeTestIntent.create({ data: { householdId: h.household, bindingId: b.id, accountId: b.accountId, requestKey: randomUUID(), reason: "scheduled-recheck" } });
    await h.admin.$executeRaw`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_intent_id,source_lease_token,revision,state,plan,paid_through,premium_until)
      VALUES(${h.household}::uuid,${b.id}::uuid,${b.accountId},${intent.id}::uuid,${randomUUID()}::uuid,1,'grace','monthly',extract(epoch FROM clock_timestamp())::bigint-86400,extract(epoch FROM clock_timestamp())::bigint+5*86400)`;
    const grace = await (await billing.GET(await h.request(path))).json();
    // TEST activation is off: the stored grace state is shown, but the effective plan stays Free.
    expect(grace).toMatchObject({ state: "grace", tier: "free", cadence: "monthly" });
    expect(Date.parse(grace.premiumUntil)).toBeGreaterThan(Date.now());
    expect((await billing.GET(await h.request(path, { user: h.viewer }))).status).toBe(403);
    expect((await billing.GET(await h.request(`/v1/households/${h.foreignHousehold}/billing`))).status).not.toBe(200);
  });
  it("lists planned reminders as not sent while delivery is inactive, and hides other households' deadlines", async () => {
    const r = await reminders.GET(await h.request(`/v1/obligations/${obligation}/reminders`, { user: h.viewer }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deliveryActive: false, reminders: [{ offsetLabel: "7 days before", status: "scheduled", sentAt: null }] });
    expect((await reminders.GET(await h.request(`/v1/obligations/${randomUUID()}/reminders`))).status).toBe(404);
  });
});
