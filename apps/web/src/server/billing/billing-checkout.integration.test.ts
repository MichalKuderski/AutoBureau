import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "@autobureau/db";
import { createBillingRuntime, type TestBillingReadPort, type TestBillingWritePort } from "@autobureau/billing-boundary";
import { domainHarness } from "@/test/integration/domain-harness";
import { APP_URL } from "@/test/integration/database";
import { resetBoundaryCache } from "@/server/http/route";

// The owner's hosted TEST checkout end to end: real web routes and request boundary, real
// app_user and app_billing_test roles, the real billing runtime over loopback HTTP with the
// real internal signature — and synthetic provider ports in place of Stripe (no network).
let h: Awaited<ReturnType<typeof domainHarness>>, worker: Database, server: Server;
let routes: { status: typeof import("@/app/v1/households/[id]/billing/route"); checkout: typeof import("@/app/v1/households/[id]/billing/checkout/route");
  confirm: typeof import("@/app/v1/households/[id]/billing/confirm/route"); portal: typeof import("@/app/v1/households/[id]/billing/portal/route");
  quota: typeof import("@/app/v1/documents/quota/route") };
const account = "acct_Synthetic", internalSecret = "w".repeat(43);
const catalog = [{ plan: "monthly" as const, priceId: "price_Monthly", productId: "prod_Pellum" }, { plan: "annual" as const, priceId: "price_Annual", productId: "prod_Pellum" }];
const provider = { sessionStatus: "open" as "open" | "complete" | "expired", checkoutId: "", status: "active", seq: 0, down: false };
const ids = () => { const s = `Web${provider.seq}${randomUUID().slice(0, 8)}`; return { s, customerId: `cus_${s}`, sessionId: `cs_test_${s}`, subscriptionId: `sub_${s}` }; };
let current = ids();
const now = Math.floor(Date.now() / 1000);
const read: TestBillingReadPort = {
  account: async () => ({ object: "account", id: account }), customer: async () => ({ object: "customer", id: current.customerId, livemode: false }),
  subscription: async () => ({ object: "subscription", id: current.subscriptionId, customer: current.customerId, livemode: false, status: provider.status, cancel_at_period_end: false,
    cancel_at: null, pause_collection: null, trial_end: null, latest_invoice: `in_${current.s}`,
    items: { has_more: false, data: [{ quantity: 1, current_period_start: now - 60, current_period_end: now + 30 * 86400, price: { id: "price_Monthly" } }] } }),
  invoice: async () => ({ object: "invoice", id: `in_${current.s}`, customer: current.customerId, livemode: false, currency: "usd", status: "paid", amount_remaining: 0,
    parent: { type: "subscription_details", subscription_details: { subscription: current.subscriptionId } } }),
  price: async id => ({ object: "price", id, livemode: false, active: true, type: "recurring", currency: "usd", unit_amount: 1200, billing_scheme: "per_unit",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, product: { object: "product", id: "prod_Pellum", active: true, livemode: false } }),
};
const session = () => ({ sessionId: current.sessionId, customerId: current.customerId, checkoutId: provider.checkoutId, status: provider.sessionStatus,
  paymentStatus: "paid" as const, subscriptionId: provider.sessionStatus === "complete" ? current.subscriptionId : null, url: `https://checkout.stripe.com/c/pay/${current.sessionId}` });
const write: TestBillingWritePort = {
  createCheckout: vi.fn(async input => { provider.seq++; current = ids(); provider.checkoutId = input.checkoutId; provider.sessionStatus = "open";
    return { customerId: current.customerId, sessionId: current.sessionId, url: `https://checkout.stripe.com/c/pay/${current.sessionId}` }; }),
  retrieveSession: vi.fn(async () => session()),
  expireSession: vi.fn(async () => { provider.sessionStatus = "expired"; return session(); }),
  createPortal: vi.fn(async () => ({ url: `https://billing.stripe.com/p/session/${current.s}` })),
  listSubscriptions: vi.fn(async () => ({ subscriptionIds: [], truncated: false })),
};
const env = (extra: Record<string, string | undefined> = {}) => {
  for (const k of ["BILLING_TEST_DISABLED", "STRIPE_TEST_SECRET_KEY"]) delete process.env[k];
  Object.assign(process.env, extra);
};

beforeAll(async () => {
  h = await domainHarness();
  await h.admin.entitlement.create({ data: { householdId: h.household, periodStart: new Date() } });
  await h.admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_web_checkout_only'");
  const u = new URL(APP_URL()); u.username = "app_billing_test"; u.password = "stripe_web_checkout_only"; worker = createDatabase(u.toString());
  const rt = createBillingRuntime({ db: worker, read, write, verify: () => { throw new Error("no webhooks here"); },
    config: { accountId: account, appOrigin: "https://app.example.test", internalSecret, cronSecret: null, catalog } });
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    if (provider.down) { res.writeHead(502); res.end(); return; }
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method ?? "POST", headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
    const op = /^\/v1\/stripe-test\/internal\/([a-z-]+)$/.exec(new URL(request.url).pathname)?.[1] ?? "";
    const r = await rt.internal(request, op);
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, { BILLING_RUNTIME_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, BILLING_INTERNAL_SECRET: internalSecret, STRIPE_TEST_ACCOUNT_ID: account });
  resetBoundaryCache();
  routes = {
    status: await import("@/app/v1/households/[id]/billing/route"), checkout: await import("@/app/v1/households/[id]/billing/checkout/route"),
    confirm: await import("@/app/v1/households/[id]/billing/confirm/route"), portal: await import("@/app/v1/households/[id]/billing/portal/route"),
    quota: await import("@/app/v1/documents/quota/route"),
  };
});
afterAll(async () => {
  env();
  for (const k of ["BILLING_RUNTIME_URL", "BILLING_INTERNAL_SECRET", "STRIPE_TEST_ACCOUNT_ID"]) delete process.env[k];
  if (h) {
    await h.admin.$executeRawUnsafe("UPDATE local_plan_activation SET test_enabled=false");
    const where = { householdId: h.household };
    for (const m of ["stripeTestState", "stripeTestNotice", "stripeTestIntent", "stripeTestRoute", "stripeTestCheckout", "stripeTestBinding", "entitlement"] as const)
      await (h.admin[m] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where });
    await h.admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");
    await h.close();
  }
  await worker?.disconnect();
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
});
beforeEach(() => { env(); provider.down = false; });

const path = (action = "") => `/v1/households/${h.household}/billing${action}`;
const post = async (route: { POST: (r: Request) => Promise<Response> }, action: string, body: unknown, user?: string) =>
  route.POST(await h.request(path(action), { method: "POST", body, ...(user ? { user } : {}) }));
const status = async () => (await routes.status.GET(await h.request(path()))).json() as Promise<Record<string, unknown>>;

describe("hosted TEST checkout through the web routes", () => {
  it("offers checkout only when the billing runtime is mounted and the web holds no Stripe credential", async () => {
    expect(await status()).toMatchObject({ checkoutAvailable: true, paymentUpdateAvailable: false, subscribed: false, checkoutOpen: false });
    env({ BILLING_TEST_DISABLED: "1" });
    expect(await status()).toMatchObject({ checkoutAvailable: false });
    expect((await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() })).status).toBe(503);
    // Split so the synthetic shape is never a key-shaped literal (secret scanning).
    env({ STRIPE_TEST_SECRET_KEY: ["sk", "test", "ShouldNeverBeInTheWebRuntime"].join("_") });
    expect(await status()).toMatchObject({ checkoutAvailable: false });
    expect((await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() })).status).toBe(503);
    expect(write.createCheckout).not.toHaveBeenCalled();
  });

  it("refuses non-owners, foreign households and malformed plans before any provider work", async () => {
    expect((await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() }, h.viewer)).status).toBe(403);
    expect((await routes.checkout.POST(await h.request(`/v1/households/${h.foreignHousehold}/billing/checkout`, { method: "POST", body: { plan: "monthly", requestId: randomUUID() } }))).status).not.toBe(200);
    expect((await post(routes.checkout, "/checkout", { plan: "weekly", requestId: randomUUID() })).status).toBe(400);
    expect((await post(routes.portal, "/portal", {}, h.viewer)).status).toBe(403);
    expect(write.createCheckout).not.toHaveBeenCalled();
  });

  it("an unavailable billing runtime changes nothing and says nothing was charged", async () => {
    provider.down = true;
    const r = await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() });
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).toMatch(/Nothing was charged/);
    expect(await h.admin.stripeTestBinding.count({ where: { householdId: h.household } })).toBe(0);
    // The intent written before the provider call stays unresolved and is abandoned once stale.
    expect(await h.admin.stripeTestCheckout.findFirst({ where: { householdId: h.household }, select: { state: true } })).toEqual({ state: "created" });
    await h.admin.$executeRaw`UPDATE stripe_test_checkouts SET created_at=created_at-interval '10 minutes' WHERE household_id=${h.household}::uuid AND state='created'`;
  });

  it("returns a Stripe-hosted URL; a second start expires the first session; cancel abandons", async () => {
    const first = await (await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() })).json() as { url: string };
    expect(new URL(first.url).origin).toBe("https://checkout.stripe.com");
    expect(await h.admin.stripeTestCheckout.count({ where: { householdId: h.household, state: "abandoned" } })).toBe(1);
    expect(await status()).toMatchObject({ checkoutOpen: true });
    const second = await (await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() })).json() as { url: string };
    expect(second.url).not.toBe(first.url);
    expect(write.expireSession).toHaveBeenCalledTimes(1);
    expect(await (await post(routes.confirm, "/confirm", { cancel: false })).json()).toEqual({ status: "pending", reconciled: false });
    expect(await (await post(routes.confirm, "/confirm", { cancel: true })).json()).toEqual({ status: "abandoned", reconciled: false });
    expect(await status()).toMatchObject({ checkoutOpen: false, subscribed: false });
  });

  it("the owner's return binds only a provider-complete session, reconciles, then offers the portal", async () => {
    await h.admin.$executeRawUnsafe("UPDATE local_plan_activation SET test_enabled=true");
    const before = await (await routes.quota.GET(await h.request("/v1/documents/quota"))).json() as { plan: string; allowance: number };
    expect(before).toMatchObject({ plan: "free", allowance: 10 });
    await post(routes.checkout, "/checkout", { plan: "monthly", requestId: randomUUID() });
    provider.sessionStatus = "complete";
    expect(await (await post(routes.confirm, "/confirm", { cancel: false })).json()).toEqual({ status: "bound", reconciled: true });
    expect(await status()).toMatchObject({ tier: "premium", state: "active", cadence: "monthly", subscribed: true, checkoutAvailable: false, paymentUpdateAvailable: true });
    // Entitlement effect comes from the reconciled state through effective_plan, not from the return.
    expect(await (await routes.quota.GET(await h.request("/v1/documents/quota"))).json()).toMatchObject({ plan: "premium", allowance: 50 });
    const portal = await (await post(routes.portal, "/portal", {})).json() as { url: string };
    expect(new URL(portal.url).origin).toBe("https://billing.stripe.com");
    expect((await post(routes.checkout, "/checkout", { plan: "annual", requestId: randomUUID() })).status).toBe(409);
    expect(await h.admin.stripeTestIntent.findFirst({ where: { householdId: h.household }, select: { reason: true, state: true } })).toEqual({ reason: "checkout-return", state: "reconciled" });
    await h.admin.$executeRawUnsafe("UPDATE local_plan_activation SET test_enabled=false");
    expect(await (await routes.quota.GET(await h.request("/v1/documents/quota"))).json()).toMatchObject({ plan: "free", allowance: 10 });
  });
});
