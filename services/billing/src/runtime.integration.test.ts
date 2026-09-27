import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase, runAsUser, beginStripeTestCheckout, recordStripeTestCheckoutSession, completeStripeTestCheckout, readBillingStatus, type Database } from "@autobureau/db";
import { APP_URL, adminClient, assertExpectedServer, grantAppUserLogin } from "./test/database.js";
import { createBillingRuntime, recheckRequestKey, UNROUTED_RETRY_SECONDS } from "./runtime.js";
import { createStripeTestNoticeVerifier } from "./stripe-test-notice.js";
import { signInternalRequest, INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from "./internal-signature.js";
import type { TestBillingReadPort } from "./stripe-test-refetch.js";
import type { TestBillingWritePort } from "./stripe-test-provider.js";

// The hosted billing runtime end to end against the real schema and restricted roles, with
// synthetic provider ports. Webhooks are signed by the official SDK's offline helper; no
// network, API key or delivered provider event exists here.
let admin: PrismaClient, db: Database, worker: Database; const users: string[] = [], households: string[] = [];
const account = "acct_Synthetic", secret = "whsec_synthetic_runtime_only", apiVersion = "2026-02-25.clover";
const internalSecret = "i".repeat(43), cronSecret = "c".repeat(40), origin = "https://app.example.test";
const catalog = [{ plan: "monthly" as const, priceId: "price_Monthly", productId: "prod_Pellum" }, { plan: "annual" as const, priceId: "price_Annual", productId: "prod_Pellum" }];
const verify = createStripeTestNoticeVerifier((b, s, k, t) => Stripe.webhooks.constructEvent(Buffer.from(b), s, k, t), { signingSecret: secret, apiVersion, mode: "test" });
beforeAll(async () => {
  await assertExpectedServer(); await grantAppUserLogin(); admin = adminClient(); db = createDatabase(APP_URL());
  await admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_runtime_only'");
  const u = new URL(APP_URL()); u.username = "app_billing_test"; u.password = "stripe_runtime_only"; worker = createDatabase(u.toString());
}, 120000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    for (const m of ["stripeTestState", "stripeTestNotice", "stripeTestIntent", "stripeTestRoute", "stripeTestCheckout", "stripeTestBinding", "outboxEvent", "householdDeletion"] as const)
      await (admin[m] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where });
    await admin.household.deleteMany({ where: { id: { in: households } } }); await admin.auditLog.deleteMany({ where });
    await admin.user.deleteMany({ where: { id: { in: users } } }); await admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");
  }
  await admin?.$disconnect(); await db?.disconnect(); await worker?.disconnect();
});

function provider(plan: "monthly" | "annual" = "monthly") {
  const s = randomUUID().replaceAll("-", ""), customerId = `cus_${s}`, sessionId = `cs_test_${s}`, subscriptionId = `sub_${s}`, now = Math.floor(Date.now() / 1000);
  const price = catalog.find(p => p.plan === plan)!;
  const state = { status: "active", paid: true, priceId: price.priceId, sessionStatus: "open" as "open" | "complete" | "expired", checkoutId: "" };
  const sub = () => ({ object: "subscription", id: subscriptionId, customer: customerId, livemode: false, status: state.status, cancel_at_period_end: false, cancel_at: null,
    pause_collection: null, trial_end: null, latest_invoice: `in_${s}`, items: { has_more: false, data: [{ quantity: 1, current_period_start: now - 60, current_period_end: now + 30 * 86400, price: { id: state.priceId } }] } });
  const read: TestBillingReadPort = {
    account: vi.fn(async () => ({ object: "account", id: account })), customer: vi.fn(async () => ({ object: "customer", id: customerId, livemode: false })),
    subscription: vi.fn(async () => sub()),
    invoice: vi.fn(async () => ({ object: "invoice", id: `in_${s}`, customer: customerId, livemode: false, currency: "usd", status: state.paid ? "paid" : "open", amount_remaining: state.paid ? 0 : 1200,
      parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } } })),
    price: vi.fn(async (id: string) => { const p = catalog.find(c => c.priceId === id)!;
      return { object: "price", id, livemode: false, active: true, type: "recurring", currency: "usd", unit_amount: p.plan === "monthly" ? 1200 : 9900, billing_scheme: "per_unit",
        recurring: { interval: p.plan === "monthly" ? "month" : "year", interval_count: 1, usage_type: "licensed" }, product: { object: "product", id: p.productId, active: true, livemode: false } }; }),
  };
  const session = () => ({ sessionId, customerId, checkoutId: state.checkoutId, status: state.sessionStatus, paymentStatus: "paid" as const,
    subscriptionId: state.sessionStatus === "complete" ? subscriptionId : null, url: `https://checkout.stripe.com/c/pay/${sessionId}` });
  const write: TestBillingWritePort = {
    createCheckout: vi.fn(async input => { state.checkoutId = input.checkoutId; return { customerId, sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` }; }),
    retrieveSession: vi.fn(async () => session()),
    expireSession: vi.fn(async () => { state.sessionStatus = "expired"; return session(); }),
    createPortal: vi.fn(async () => ({ url: `https://billing.stripe.com/p/session/${s}` })),
    listSubscriptions: vi.fn(async () => ({ subscriptionIds: [subscriptionId, `sub_Unrouted${s}`], truncated: false })),
  };
  return { s, customerId, sessionId, subscriptionId, now, state, read, write };
}
async function household() {
  const owner = randomUUID(), hh = randomUUID(); users.push(owner); households.push(hh);
  await admin.user.create({ data: { id: owner, email: `${owner}@example.test` } });
  await admin.household.create({ data: { id: hh, name: "PUBLIC billing runtime", createdBy: owner } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  return { owner, hh };
}
function runtimeFor(p: ReturnType<typeof provider>, now?: () => number) {
  const logs: Array<[string, string]> = [];
  const rt = createBillingRuntime({ db: worker, read: p.read, write: p.write, verify, ...(now ? { now } : {}),
    config: { accountId: account, appOrigin: origin, internalSecret, cronSecret, catalog }, log: (e, l) => { logs.push([e, l]); } });
  return { rt, logs };
}
function signed(op: string, body: unknown, at = Math.floor(Date.now() / 1000), key = internalSecret) {
  const path = `/v1/stripe-test/internal/${op}`, bytes = Buffer.from(JSON.stringify(body));
  return new Request(`https://billing.example.test${path}`, { method: "POST", body: bytes,
    headers: { "content-type": "application/json", [INTERNAL_TIMESTAMP_HEADER]: String(at), [INTERNAL_SIGNATURE_HEADER]: signInternalRequest(key, "POST", path, bytes, at) } });
}
function webhook(event: Record<string, unknown>, key = secret) {
  const payload = JSON.stringify(event);
  return new Request("https://billing.example.test/v1/stripe-test/webhook", { method: "POST", body: payload,
    headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: key }) } });
}
const subEvent = (p: ReturnType<typeof provider>, type = "customer.subscription.updated", created = Math.floor(Date.now() / 1000), customer: string = p.customerId) => ({
  id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event", livemode: false, api_version: apiVersion, created, type,
  data: { object: { id: p.subscriptionId, customer, metadata: { householdId: "UNTRUSTED" } } } });

/** Owner → billing runtime → owner: the exact web-side sequence, minus HTTP between them. */
async function checkout(f: { owner: string; hh: string }, p: ReturnType<typeof provider>, rt: ReturnType<typeof runtimeFor>["rt"], plan: "monthly" | "annual" = "monthly") {
  const c = await runAsUser(f.owner, () => beginStripeTestCheckout(db, f.hh, { accountId: account, plan, requestKey: randomUUID() }));
  const opened = await rt.internal(signed("checkout-session", { householdId: f.hh, checkoutId: c.id, plan }), "checkout-session");
  expect(opened.status).toBe(200);
  const ids = await opened.json() as { customerId: string; sessionId: string; url: string };
  await runAsUser(f.owner, () => recordStripeTestCheckoutSession(db, f.hh, c.id, ids));
  p.state.sessionStatus = "complete";
  const resolved = await (await rt.internal(signed("checkout-resolve", { householdId: f.hh, checkoutId: c.id, expire: false }), "checkout-resolve")).json() as { status: string; subscriptionId: string };
  expect(resolved).toEqual({ status: "complete", subscriptionId: p.subscriptionId });
  const { bindingId } = await runAsUser(f.owner, () => completeStripeTestCheckout(db, f.hh, c.id, resolved.subscriptionId));
  const r = await rt.internal(signed("reconcile", { householdId: f.hh, bindingId, requestKey: c.id }), "reconcile");
  return { c, bindingId, reconcile: { status: r.status, body: await r.json() } };
}
const status = (f: { owner: string; hh: string }) => runAsUser(f.owner, () => readBillingStatus(db, f.hh));
const stateCount = (hh: string) => admin.stripeTestState.findFirst({ where: { householdId: hh }, select: { revision: true, state: true, plan: true } });

it("monthly checkout: signed intent → provider session → verified completion → binding → checkout-return reconcile", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  const { reconcile } = await checkout(f, p, rt);
  expect(reconcile).toEqual({ status: 200, body: { status: "settled" } });
  expect(await stateCount(f.hh)).toEqual({ revision: 1, state: "active", plan: "monthly" });
  expect(await admin.stripeTestIntent.findFirst({ where: { householdId: f.hh }, select: { reason: true, state: true } })).toEqual({ reason: "checkout-return", state: "reconciled" });
  expect(p.write.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ priceId: "price_Monthly",
    successUrl: `${origin}/settings/billing?checkout=return`, cancelUrl: `${origin}/settings/billing?checkout=cancelled` }));
  expect(await status(f)).toMatchObject({ state: "active", cadence: "monthly" });
});

it("annual checkout binds the annual price; monthly ↔ annual transitions follow the provider's current price", async () => {
  const f = await household(), p = provider("annual"), { rt } = runtimeFor(p);
  await checkout(f, p, rt, "annual");
  expect(await stateCount(f.hh)).toEqual({ revision: 1, state: "active", plan: "annual" });
  p.state.priceId = "price_Monthly";
  expect((await rt.webhook(webhook(subEvent(p)))).status).toBe(200);
  expect(await stateCount(f.hh)).toEqual({ revision: 2, state: "active", plan: "monthly" });
  p.state.priceId = "price_Annual";
  expect((await rt.webhook(webhook(subEvent(p)))).status).toBe(200);
  expect(await stateCount(f.hh)).toEqual({ revision: 3, state: "active", plan: "annual" });
});

it("internal requests need the exact signature, path, fresh timestamp and a matching owner intent", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  const c = await runAsUser(f.owner, () => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() }));
  const body = { householdId: f.hh, checkoutId: c.id, plan: "monthly" };
  expect((await rt.internal(signed("checkout-session", body, undefined, "x".repeat(43)), "checkout-session")).status).toBe(401);
  expect((await rt.internal(signed("checkout-session", body, Math.floor(Date.now() / 1000) - 120), "checkout-session")).status).toBe(401);
  expect((await rt.internal(signed("portal", { householdId: f.hh }), "checkout-session")).status).toBe(404);
  expect((await rt.internal(signed("checkout-session", { ...body, plan: "annual" }), "checkout-session")).status).toBe(409);
  expect((await rt.internal(signed("checkout-session", { ...body, extra: 1 }), "checkout-session")).status).toBe(400);
  expect((await rt.internal(signed("checkout-session", { ...body, checkoutId: randomUUID() }), "checkout-session")).status).toBe(409);
  const g = await household();
  expect((await rt.internal(signed("checkout-session", { ...body, householdId: g.hh }), "checkout-session")).status).toBe(409);
  expect(p.write.createCheckout).not.toHaveBeenCalled();
  expect((await rt.internal(signed("nope", body), "nope")).status).toBe(404);
});

it("a provider session that is not the recorded one refuses; an open session can be expired; nothing binds", async () => {
  const f = await household(), p = provider(), { rt, logs } = runtimeFor(p);
  const c = await runAsUser(f.owner, () => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() }));
  const ids = await (await rt.internal(signed("checkout-session", { householdId: f.hh, checkoutId: c.id, plan: "monthly" }), "checkout-session")).json() as { customerId: string; sessionId: string };
  await runAsUser(f.owner, () => recordStripeTestCheckoutSession(db, f.hh, c.id, ids));
  expect(await (await rt.internal(signed("checkout-resolve", { householdId: f.hh, checkoutId: c.id, expire: false }), "checkout-resolve")).json()).toEqual({ status: "open" });
  p.state.checkoutId = randomUUID(); p.state.sessionStatus = "complete";
  expect((await rt.internal(signed("checkout-resolve", { householdId: f.hh, checkoutId: c.id, expire: false }), "checkout-resolve")).status).toBe(409);
  expect(logs).toContainEqual(["billing.checkout_mismatch", "error"]);
  p.state.checkoutId = c.id; p.state.sessionStatus = "open";
  expect(await (await rt.internal(signed("checkout-resolve", { householdId: f.hh, checkoutId: c.id, expire: true }), "checkout-resolve")).json()).toEqual({ status: "expired" });
  expect(await admin.stripeTestBinding.count({ where: { householdId: f.hh } })).toBe(0);
});

it("duplicate, stale and out-of-order webhooks settle on the provider's current state exactly once per event", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  await checkout(f, p, rt);
  const e = subEvent(p);
  expect((await rt.webhook(webhook(e))).status).toBe(200);
  const after = await stateCount(f.hh);
  expect((await rt.webhook(webhook(e))).status).toBe(200);
  expect(await stateCount(f.hh)).toEqual(after);
  expect(await admin.stripeTestNotice.count({ where: { householdId: f.hh } })).toBe(1);
  // An older "deleted" event arriving late cannot roll the state back: the refetch sees active.
  expect((await rt.webhook(webhook(subEvent(p, "customer.subscription.deleted", p.now - 3000)))).status).toBe(200);
  expect(await stateCount(f.hh)).toMatchObject({ state: "active" });
  expect(JSON.stringify(await admin.stripeTestNotice.findMany({ where: { householdId: f.hh } }), (_, v) => typeof v === "bigint" ? String(v) : v)).not.toContain("UNTRUSTED");
});

it("payment failure enters DB-time grace from the paid period; recovery returns to active; cancellation ends it", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  await checkout(f, p, rt);
  p.state.status = "past_due"; p.state.paid = false;
  expect((await rt.webhook(webhook({ ...subEvent(p, "invoice.payment_failed"), data: { object: { id: `in_${p.s}`, customer: p.customerId } } }))).status).toBe(200);
  expect(await stateCount(f.hh)).toMatchObject({ state: "grace" });
  expect(await status(f)).toMatchObject({ state: "grace" });
  p.state.status = "active"; p.state.paid = true;
  expect((await rt.webhook(webhook({ ...subEvent(p, "invoice.paid"), data: { object: { id: `in_${p.s}`, customer: p.customerId } } }))).status).toBe(200);
  expect(await stateCount(f.hh)).toMatchObject({ state: "active" });
  p.state.status = "canceled";
  expect((await rt.webhook(webhook(subEvent(p, "customer.subscription.deleted")))).status).toBe(200);
  expect(await stateCount(f.hh)).toMatchObject({ state: "canceled" });
  expect(await status(f)).toMatchObject({ tier: "free", state: "canceled" });
});

it("unbound, unverified and provider-mismatch webhooks never create state; retries are bounded", async () => {
  const f = await household(), p = provider(), clock = { t: Math.floor(Date.now() / 1000) }, { rt, logs } = runtimeFor(p, () => clock.t);
  expect((await rt.webhook(webhook(subEvent(p)))).status).toBe(503);
  expect((await rt.webhook(webhook(subEvent(p, "customer.subscription.updated", clock.t - UNROUTED_RETRY_SECONDS - 1)))).status).toBe(200);
  expect((await rt.webhook(webhook(subEvent(p), "whsec_other_endpoint_only"))).status).toBe(400);
  expect((await rt.webhook(webhook({ ...subEvent(p), livemode: true }))).status).toBe(400);
  expect((await rt.webhook(webhook({ ...subEvent(p), type: "checkout.session.completed" }))).status).toBe(200);
  expect((await rt.webhook(new Request("https://billing.example.test/v1/stripe-test/webhook", { method: "POST", body: "x".repeat(131_073) }))).status).toBe(413);
  expect(await admin.stripeTestNotice.count({ where: { householdId: f.hh } })).toBe(0);
  await checkout(f, p, rt);
  const before = await stateCount(f.hh);
  // The provider now reports a price outside the server catalog: refetch refuses, state holds.
  p.state.priceId = "price_Unknown";
  const e = subEvent(p);
  expect((await rt.webhook(webhook(e))).status).toBe(503);
  const notice = await admin.stripeTestNotice.findFirstOrThrow({ where: { householdId: f.hh } });
  for (let i = 0; i < 2; i++) { await admin.stripeTestNotice.update({ where: { id: notice.id }, data: { leaseUntil: new Date(Date.now() - 1000) } }); await rt.webhook(webhook(e)); }
  await admin.stripeTestNotice.update({ where: { id: notice.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  expect((await rt.webhook(webhook(e))).status).toBe(200);
  expect(logs).toContainEqual(["billing.notice_exhausted", "error"]);
  expect(await stateCount(f.hh)).toEqual(before);
  expect((await admin.stripeTestNotice.findUniqueOrThrow({ where: { id: notice.id } })).attempts).toBe(3);
});

it("a subscription event for another subscription of the same customer is acknowledged, never bound", async () => {
  const f = await household(), p = provider(), { rt, logs } = runtimeFor(p);
  await checkout(f, p, rt);
  const e = { ...subEvent(p), data: { object: { id: `sub_Other${p.s}`, customer: p.customerId } } };
  expect((await rt.webhook(webhook(e))).status).toBe(200);
  expect(logs).toContainEqual(["billing.notice_refused", "warn"]);
  expect(await admin.stripeTestNotice.count({ where: { householdId: f.hh } })).toBe(0);
});

it("deletion race: a fenced household's webhook is acknowledged and changes nothing", async () => {
  const f = await household(), p = provider(), { rt, logs } = runtimeFor(p);
  await checkout(f, p, rt);
  const before = await stateCount(f.hh);
  await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: f.owner, requestedAt: new Date(0), undoUntil: new Date(14 * 86400000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now() + 900000) } });
  p.state.status = "canceled";
  expect((await rt.webhook(webhook(subEvent(p, "customer.subscription.deleted")))).status).toBe(200);
  expect(logs).toContainEqual(["billing.household_closed", "info"]);
  expect(await stateCount(f.hh)).toEqual(before);
  expect((await rt.internal(signed("portal", { householdId: f.hh }), "portal")).status).toBe(502);
});

it("missed webhook: the scheduled recheck reconciles with a durable internal UUID intent, once per subscription per day", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  await checkout(f, p, rt);
  p.state.status = "canceled";
  const auth = { authorization: `Bearer ${cronSecret}` };
  expect((await rt.recheck(new Request("https://billing.example.test/v1/stripe-test/recheck"))).status).toBe(404);
  expect((await rt.recheck(new Request("https://billing.example.test/v1/stripe-test/recheck", { headers: { authorization: `Bearer ${"d".repeat(40)}` } }))).status).toBe(404);
  const first = await (await rt.recheck(new Request("https://billing.example.test/v1/stripe-test/recheck", { headers: auth }))).json();
  expect(first).toMatchObject({ listed: 2, unrouted: 1, reconciled: 1, truncated: false });
  expect(await stateCount(f.hh)).toMatchObject({ state: "canceled" });
  const key = recheckRequestKey(p.subscriptionId, new Date().toISOString().slice(0, 10));
  expect(await admin.stripeTestIntent.findFirst({ where: { householdId: f.hh, requestKey: key }, select: { reason: true, state: true } })).toEqual({ reason: "scheduled-recheck", state: "reconciled" });
  const second = await (await rt.recheck(new Request("https://billing.example.test/v1/stripe-test/recheck", { headers: auth }))).json();
  expect(second).toMatchObject({ listed: 2, settled: 1, reconciled: 0 });
  expect(await admin.stripeTestIntent.count({ where: { householdId: f.hh, reason: "scheduled-recheck" } })).toBe(1);
  expect(await admin.stripeTestNotice.count({ where: { householdId: f.hh } })).toBe(0);
});

it("portal sessions exist only for a bound household and use the server's own return URL", async () => {
  const f = await household(), p = provider(), { rt } = runtimeFor(p);
  expect((await rt.internal(signed("portal", { householdId: f.hh }), "portal")).status).toBe(409);
  await checkout(f, p, rt);
  const r = await rt.internal(signed("portal", { householdId: f.hh }), "portal");
  expect(await r.json()).toEqual({ url: `https://billing.stripe.com/p/session/${p.s}` });
  expect(p.write.createPortal).toHaveBeenCalledWith(p.customerId, `${origin}/settings/billing`);
});
