import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { requestStripeTestReconciliation } from "../../src/stripe-test-inbox.js";
import { beginStripeTestCheckout, recordStripeTestCheckoutSession, completeStripeTestCheckout, abandonStripeTestCheckout,
  readStripeTestCheckoutState, readStripeTestCheckoutForProvider, readStripeTestBindingForProvider, stripeTestRouteDigest,
  StripeTestCheckoutRefused } from "../../src/stripe-test-checkout.js";
import { ADMIN_URL, APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

// ADR-020 hosted amendment: owner-written checkout intents, binding only from a verified
// session, knows-the-key routes readable by the billing runtime for its own digest alone.
let admin: PrismaClient, app: PrismaClient, worker: PrismaClient, db: Database, work: Database;
const owner = randomUUID(), member = randomUUID(), households: string[] = [];
const account = "acct_Synthetic";
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient();
  app = new PrismaClient({ datasourceUrl: APP_URL }); db = new Database(app);
  await admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_checkout_only'");
  const u = new URL(ADMIN_URL); u.username = "app_billing_test"; u.password = "stripe_checkout_only";
  worker = new PrismaClient({ datasourceUrl: u.toString() }); work = new Database(worker);
  await admin.user.createMany({ data: [owner, member].map(id => ({ id, email: `${id}@example.test` })) });
}, 120000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    await admin.stripeTestIntent.deleteMany({ where }); await admin.stripeTestRoute.deleteMany({ where });
    await admin.stripeTestCheckout.deleteMany({ where }); await admin.stripeTestBinding.deleteMany({ where });
    await admin.householdDeletion.deleteMany({ where }); await admin.household.deleteMany({ where: { id: { in: households } } });
    await admin.auditLog.deleteMany({ where }); await admin.user.deleteMany({ where: { id: { in: [owner, member] } } });
    await admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");
  }
  await Promise.all([admin, app, worker].map(c => c?.$disconnect()));
});
async function household() {
  const hh = randomUUID(); households.push(hh);
  await admin.household.create({ data: { id: hh, name: "PUBLIC checkout fixture", createdBy: owner } });
  await admin.householdUser.createMany({ data: [{ householdId: hh, userId: owner, role: "owner" }, { householdId: hh, userId: member, role: "member" }] });
  const s = randomUUID().replaceAll("-", "");
  return { hh, customerId: `cus_${s}`, sessionId: `cs_test_${s}`, subscriptionId: `sub_${s}` };
}
const asOwner = <T>(fn: () => Promise<T>) => runAsUser(owner, fn);
const reason = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => e instanceof StripeTestCheckoutRefused ? e.reason : "other");

it("owner-only intent, idempotent by request key, one unresolved checkout per household", async () => {
  const f = await household(), key = randomUUID();
  const c = await asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: key }));
  expect(c).toMatchObject({ plan: "monthly", state: "created", customerId: null, sessionId: null });
  expect((await asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: key }))).id).toBe(c.id);
  expect(await reason(asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "annual", requestKey: key })))).toBe("refused");
  expect(await reason(asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "annual", requestKey: randomUUID() })))).toBe("busy");
  expect(await reason(runAsUser(member, () => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() })))).toBe("refused");
  for (const bad of [{ accountId: "acct_Live!", plan: "monthly" }, { accountId: account, plan: "weekly" }])
    await expect(asOwner(() => beginStripeTestCheckout(db, f.hh, { ...bad, requestKey: randomUUID() } as never))).rejects.toThrow();
  // The database refuses the same shortcuts even without the module's checks.
  await expect(db.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_checkouts(household_id,owner_id,account_id,plan,request_key)
    VALUES(${f.hh}::uuid,${member}::uuid,${account},'monthly',${randomUUID()}::uuid)`)).rejects.toThrow();
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE stripe_test_checkouts SET plan='annual' WHERE id=${c.id}::uuid`))).rejects.toThrow();
  // A signed-in member writing directly (no module check in the way) is refused by the guard itself.
  const g = await household();
  await expect(runAsUser(member, () => db.withHousehold(g.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_checkouts(household_id,owner_id,account_id,plan,request_key)
    VALUES(${g.hh}::uuid,${member}::uuid,${account},'monthly',${randomUUID()}::uuid)`))).rejects.toThrow();
  expect(await admin.stripeTestCheckout.count({ where: { householdId: g.hh } })).toBe(0);
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE stripe_test_checkouts SET state='bound',customer_id=${f.customerId},session_id=${f.sessionId} WHERE id=${c.id}::uuid`))).rejects.toThrow();
});

it("binds only from an opened intent, derives both routes, and is terminal", async () => {
  const f = await household();
  const c = await asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "annual", requestKey: randomUUID() }));
  await expect(asOwner(() => completeStripeTestCheckout(db, f.hh, c.id, f.subscriptionId))).rejects.toThrow();
  await expect(runAsUser(member, () => recordStripeTestCheckoutSession(db, f.hh, c.id, f))).rejects.toThrow();
  await asOwner(() => recordStripeTestCheckoutSession(db, f.hh, c.id, f));
  await expect(asOwner(() => recordStripeTestCheckoutSession(db, f.hh, c.id, { ...f, customerId: "cus_Other" }))).rejects.toThrow();
  // "bound" needs the binding itself; the owner cannot mark an opened intent bound directly.
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE stripe_test_checkouts SET state='bound' WHERE id=${c.id}::uuid`))).rejects.toThrow();
  const { bindingId } = await asOwner(() => completeStripeTestCheckout(db, f.hh, c.id, f.subscriptionId));
  const binding = await admin.stripeTestBinding.findUniqueOrThrow({ where: { id: bindingId } });
  expect(binding).toMatchObject({ householdId: f.hh, ownerId: owner, accountId: account, customerId: f.customerId, subscriptionId: f.subscriptionId, livemode: false });
  const routes = await admin.stripeTestRoute.findMany({ where: { bindingId }, orderBy: { kind: "asc" } });
  expect(routes.map(r => [r.kind, r.routeDigest])).toEqual([["customer", stripeTestRouteDigest(account, f.customerId)], ["subscription", stripeTestRouteDigest(account, f.subscriptionId)]]);
  expect((await admin.stripeTestCheckout.findUniqueOrThrow({ where: { id: c.id } })).state).toBe("bound");
  expect(await asOwner(() => readStripeTestCheckoutState(db, f.hh))).toEqual({ bindingId, boundCheckoutId: c.id, reconciled: false, open: null });
  expect(await reason(asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() })))).toBe("subscribed");
  await expect(asOwner(() => abandonStripeTestCheckout(db, f.hh, c.id))).rejects.toThrow();
  // The owner cannot add, move or remove a route by hand.
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_routes(route_digest,household_id,binding_id,account_id,kind)
    VALUES(${"a".repeat(64)},${f.hh}::uuid,${bindingId}::uuid,${account},'customer')`))).rejects.toThrow();
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE stripe_test_routes SET household_id=household_id`))).rejects.toThrow();
  await expect(asOwner(() => db.withHousehold(f.hh, tx => tx.$executeRaw`DELETE FROM stripe_test_routes`))).rejects.toThrow();
});

it("the billing runtime resolves only the digest it holds and never writes intents", async () => {
  const f = await household(), g = await household();
  for (const x of [f, g]) {
    const c = await asOwner(() => beginStripeTestCheckout(db, x.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() }));
    await asOwner(() => recordStripeTestCheckoutSession(db, x.hh, c.id, x)); await asOwner(() => completeStripeTestCheckout(db, x.hh, c.id, x.subscriptionId));
  }
  const bf = await admin.stripeTestBinding.findUniqueOrThrow({ where: { householdId: f.hh } });
  expect(await work.resolveTestBillingRoute(stripeTestRouteDigest(account, f.customerId))).toEqual({ householdId: f.hh, bindingId: bf.id, kind: "customer" });
  expect(await work.resolveTestBillingRoute(stripeTestRouteDigest(account, f.subscriptionId))).toEqual({ householdId: f.hh, bindingId: bf.id, kind: "subscription" });
  expect(await work.resolveTestBillingRoute(stripeTestRouteDigest("acct_Other", f.customerId))).toBeNull();
  expect(await worker.$queryRaw`SELECT route_digest FROM stripe_test_routes`).toEqual([]);
  expect(await worker.$transaction(async tx => { await tx.$executeRaw`SELECT set_config('request.stripe_route',${stripeTestRouteDigest(account, f.customerId)},true)`;
    return tx.$queryRaw<Array<{ household_id: string }>>`SELECT household_id::text FROM stripe_test_routes`; })).toEqual([{ household_id: f.hh }]);
  // The web role cannot even read the digest column, so it cannot route for anyone.
  await expect(db.resolveTestBillingRoute(stripeTestRouteDigest(account, f.customerId))).rejects.toThrow();
  const [c] = await admin.stripeTestCheckout.findMany({ where: { householdId: f.hh } });
  expect(await readStripeTestCheckoutForProvider(work, f.hh, c!.id)).toMatchObject({ accountId: account, plan: "monthly", state: "bound", customerId: f.customerId });
  expect(await readStripeTestCheckoutForProvider(work, g.hh, c!.id)).toBeNull();
  await expect(readStripeTestCheckoutForProvider(db, f.hh, c!.id)).rejects.toThrow("Dedicated TEST billing authority required");
  expect(await readStripeTestBindingForProvider(work, f.hh)).toEqual({ bindingId: bf.id, accountId: account, customerId: f.customerId, subscriptionId: f.subscriptionId });
  await expect(work.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE stripe_test_checkouts SET state='abandoned'`)).rejects.toThrow();
  await expect(work.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_checkouts(household_id,owner_id,account_id,plan,request_key) VALUES(${f.hh}::uuid,${owner}::uuid,${account},'monthly',${randomUUID()}::uuid)`)).rejects.toThrow();
  await expect(work.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_routes(route_digest,household_id,binding_id,account_id,kind) VALUES(${"b".repeat(64)},${f.hh}::uuid,${bf.id}::uuid,${account},'customer')`)).rejects.toThrow();
  // The owner's return is its own reconciliation reason; the closed list still refuses others.
  expect(await requestStripeTestReconciliation(work, f.hh, bf.id, c!.id, "checkout-return")).toMatch(/^[0-9a-f-]{36}$/);
  await expect(requestStripeTestReconciliation(work, f.hh, bf.id, randomUUID(), "webhook-arrived" as never)).rejects.toThrow();
  await expect(work.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO stripe_test_intents(household_id,binding_id,account_id,request_key,reason) VALUES(${f.hh}::uuid,${bf.id}::uuid,${account},${randomUUID()}::uuid,'webhook-arrived')`)).rejects.toThrow();
});

it("abandonment frees the household for a new checkout; a fenced household refuses every step", async () => {
  const f = await household();
  const c = await asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() }));
  await asOwner(() => recordStripeTestCheckoutSession(db, f.hh, c.id, f)); await asOwner(() => abandonStripeTestCheckout(db, f.hh, c.id));
  await expect(asOwner(() => completeStripeTestCheckout(db, f.hh, c.id, f.subscriptionId))).rejects.toThrow();
  const d = await asOwner(() => beginStripeTestCheckout(db, f.hh, { accountId: account, plan: "annual", requestKey: randomUUID() }));
  expect(d.state).toBe("created");
  await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: owner, requestedAt: new Date(0), undoUntil: new Date(14 * 86400000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now() + 900000) } });
  const s = randomUUID().replaceAll("-", "");
  await expect(asOwner(() => recordStripeTestCheckoutSession(db, f.hh, d.id, { customerId: `cus_${s}`, sessionId: `cs_test_${s}` }))).rejects.toThrow();
  await expect(asOwner(() => abandonStripeTestCheckout(db, f.hh, d.id))).rejects.toThrow();
  const g = await household();
  await admin.householdDeletion.create({ data: { householdId: g.hh, requestedBy: owner, requestedAt: new Date(0), undoUntil: new Date(14 * 86400000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now() + 900000) } });
  await expect(asOwner(() => beginStripeTestCheckout(db, g.hh, { accountId: account, plan: "monthly", requestKey: randomUUID() }))).rejects.toThrow();
  expect(await admin.stripeTestCheckout.count({ where: { householdId: g.hh } })).toBe(0);
});
