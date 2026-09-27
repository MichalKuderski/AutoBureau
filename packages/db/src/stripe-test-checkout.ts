import { createHash } from "node:crypto";
import { stripeTestId, UUID_RE } from "@autobureau/contracts";
import { currentActor } from "./audit.js";
import { assertTestBillingTransaction } from "./test-billing-runtime.js";
import type { Database, ScopedClient } from "./scoped.js";

/**
 * Hosted TEST checkout (ADR-020 hosted amendment). The OWNER's web session writes the
 * intent before any provider call and the provider IDs after it; the web runtime holds no
 * Stripe credential. The billing runtime (app_billing_test) may read an intent to verify it
 * before its provider work, and never writes one. A checkout return URL, metadata or webhook
 * arrival is never ownership or payment evidence: the binding is created only from a session
 * the billing runtime re-read from the provider, and Premium only from a reconciled state.
 */
export type StripeTestPlan = "monthly" | "annual";
export class StripeTestCheckoutRefused extends Error {
  override name = "StripeTestCheckoutRefused";
  constructor(readonly reason: "refused" | "subscribed" | "busy" = "refused") { super("Test checkout refused"); }
}
const refuse = (reason?: "refused" | "subscribed" | "busy"): never => { throw new StripeTestCheckoutRefused(reason); };
const plans = new Set<StripeTestPlan>(["monthly", "annual"]);
const accountOk = (v: unknown) => stripeTestId("acct").safeParse(v).success;

type CheckoutRow = { id: string; plan: StripeTestPlan; state: "created" | "opened" | "bound" | "abandoned"; account_id: string;
  customer_id: string | null; session_id: string | null; age_seconds: number };
const shape = (r: CheckoutRow) => ({ id: r.id, plan: r.plan, state: r.state, accountId: r.account_id,
  customerId: r.customer_id, sessionId: r.session_id, ageSeconds: Math.floor(Number(r.age_seconds)) });
export type StripeTestCheckoutView = ReturnType<typeof shape>;

function owner(): string { const a = currentActor(); return a?.type === "user" ? a.userId : refuse(); }
async function open(tx: ScopedClient, hh: string) { await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`; }
async function assertOwner(tx: ScopedClient, hh: string, userId: string) {
  if (!await tx.householdUser.findFirst({ where: { householdId: hh, userId, role: "owner" } })) refuse();
}
async function openIntent(tx: ScopedClient, hh: string) {
  const [r] = await tx.$queryRaw<CheckoutRow[]>`SELECT id,plan,state,account_id,customer_id,session_id,
    extract(epoch FROM clock_timestamp()-created_at) AS age_seconds FROM stripe_test_checkouts
    WHERE household_id=${hh}::uuid AND state IN ('created','opened') LIMIT 1`;
  return r ? shape(r) : null;
}

/** Owner view: the household's binding (if any) and its one unresolved checkout (if any). */
export async function readStripeTestCheckoutState(db: Database, hh: string) {
  const userId = owner();
  return db.withHousehold(hh, async tx => {
    await assertOwner(tx, hh, userId);
    const [b] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM stripe_test_bindings WHERE household_id=${hh}::uuid`;
    const [bound] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM stripe_test_checkouts WHERE household_id=${hh}::uuid AND state='bound' LIMIT 1`;
    const [s] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM stripe_test_states WHERE household_id=${hh}::uuid`;
    return { bindingId: b?.id ?? null, boundCheckoutId: bound?.id ?? null, reconciled: Number(s?.n ?? 0) > 0, open: await openIntent(tx, hh) };
  });
}

/** Step 1, before any provider call. Idempotent by the caller's request key. */
export async function beginStripeTestCheckout(db: Database, hh: string, input: { accountId: string; plan: StripeTestPlan; requestKey: string }) {
  const userId = owner();
  if (!accountOk(input.accountId) || !plans.has(input.plan) || !UUID_RE.test(input.requestKey)) return refuse();
  return db.withHousehold(hh, async tx => {
    await open(tx, hh); await assertOwner(tx, hh, userId);
    if ((await tx.$queryRaw<unknown[]>`SELECT 1 FROM stripe_test_bindings WHERE household_id=${hh}::uuid`).length) return refuse("subscribed");
    const [existing] = await tx.$queryRaw<CheckoutRow[]>`SELECT id,plan,state,account_id,customer_id,session_id,0 AS age_seconds
      FROM stripe_test_checkouts WHERE household_id=${hh}::uuid AND request_key=${input.requestKey}::uuid`;
    if (existing) {
      if (existing.plan !== input.plan || existing.account_id !== input.accountId) return refuse();
      return shape(existing);
    }
    if (await openIntent(tx, hh)) return refuse("busy");
    const [r] = await tx.$queryRaw<CheckoutRow[]>`INSERT INTO stripe_test_checkouts(household_id,owner_id,account_id,plan,request_key)
      VALUES(${hh}::uuid,${userId}::uuid,${input.accountId},${input.plan},${input.requestKey}::uuid)
      RETURNING id,plan,state,account_id,customer_id,session_id,0 AS age_seconds`;
    return shape(r!);
  });
}

/** Step 2, after the billing runtime created the provider customer and session. */
export async function recordStripeTestCheckoutSession(db: Database, hh: string, id: string, ids: { customerId: string; sessionId: string }) {
  const userId = owner();
  if (!UUID_RE.test(id) || !stripeTestId("cus").safeParse(ids.customerId).success || !/^cs_test_[A-Za-z0-9]{1,240}$/.test(ids.sessionId)) return refuse();
  return db.withHousehold(hh, async tx => {
    await open(tx, hh); await assertOwner(tx, hh, userId);
    const n = await tx.$executeRaw`UPDATE stripe_test_checkouts SET state='opened',customer_id=${ids.customerId},session_id=${ids.sessionId}
      WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='created'`;
    if (n !== 1) return refuse();
  });
}

/**
 * Step 3, after the billing runtime re-read a COMPLETE session from the provider. One
 * transaction creates the immutable binding (existing owner guard; the route trigger derives
 * the knows-the-key digests) and marks the intent bound. The customer and account come from
 * the intent recorded before payment, never from the caller.
 */
export async function completeStripeTestCheckout(db: Database, hh: string, id: string, subscriptionId: string) {
  const userId = owner();
  if (!UUID_RE.test(id) || !stripeTestId("sub").safeParse(subscriptionId).success) return refuse();
  return db.withHousehold(hh, async tx => {
    await open(tx, hh); await assertOwner(tx, hh, userId);
    const [c] = await tx.$queryRaw<CheckoutRow[]>`SELECT id,plan,state,account_id,customer_id,session_id,0 AS age_seconds
      FROM stripe_test_checkouts WHERE id=${id}::uuid AND household_id=${hh}::uuid FOR UPDATE`;
    if (!c || c.state !== "opened" || !c.customer_id) return refuse();
    const [b] = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO stripe_test_bindings(household_id,owner_id,account_id,customer_id,subscription_id)
      VALUES(${hh}::uuid,${userId}::uuid,${c.account_id},${c.customer_id},${subscriptionId}) ON CONFLICT(household_id) DO NOTHING RETURNING id`;
    if (!b) return refuse("subscribed");
    if (await tx.$executeRaw`UPDATE stripe_test_checkouts SET state='bound' WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='opened'` !== 1) return refuse();
    return { bindingId: b.id };
  });
}

/** The provider session expired, was cancelled, or can never complete. Terminal. */
export async function abandonStripeTestCheckout(db: Database, hh: string, id: string) {
  const userId = owner();
  if (!UUID_RE.test(id)) return refuse();
  return db.withHousehold(hh, async tx => {
    await open(tx, hh); await assertOwner(tx, hh, userId);
    if (await tx.$executeRaw`UPDATE stripe_test_checkouts SET state='abandoned' WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state IN ('created','opened')` !== 1) return refuse();
  });
}

/** Billing runtime: verify the intent a signed internal request names before provider work. */
export async function readStripeTestCheckoutForProvider(db: Database, hh: string, id: string) {
  if (!UUID_RE.test(id)) return refuse();
  return db.withHousehold(hh, async tx => {
    await assertTestBillingTransaction(tx); await open(tx, hh);
    const [r] = await tx.$queryRaw<Array<{ account_id: string; plan: StripeTestPlan; state: CheckoutRow["state"]; customer_id: string | null; session_id: string | null }>>`
      SELECT account_id,plan,state,customer_id,session_id FROM stripe_test_checkouts WHERE id=${id}::uuid AND household_id=${hh}::uuid`;
    return r ? { accountId: r.account_id, plan: r.plan, state: r.state, customerId: r.customer_id, sessionId: r.session_id } : null;
  });
}

/** Billing runtime: the household's immutable binding, for a portal session or a recheck. */
export async function readStripeTestBindingForProvider(db: Database, hh: string) {
  return db.withHousehold(hh, async tx => {
    await assertTestBillingTransaction(tx); await open(tx, hh);
    const [r] = await tx.$queryRaw<Array<{ id: string; account_id: string; customer_id: string; subscription_id: string }>>`
      SELECT id,account_id,customer_id,subscription_id FROM stripe_test_bindings WHERE household_id=${hh}::uuid AND livemode=false`;
    return r ? { bindingId: r.id, accountId: r.account_id, customerId: r.customer_id, subscriptionId: r.subscription_id } : null;
  });
}

/** Billing runtime: journal state of one notice/intent, so a redelivery can be answered honestly. */
export async function readStripeTestWorkState(db: Database, hh: string, id: string, kind: "notice" | "intent") {
  if (!UUID_RE.test(id) || (kind !== "notice" && kind !== "intent")) return refuse();
  return db.withHousehold(hh, async tx => {
    await assertTestBillingTransaction(tx);
    const rows = kind === "notice"
      ? await tx.$queryRaw<Array<{ state: string; attempts: number; live: boolean }>>`SELECT state,attempts,coalesce(lease_until>clock_timestamp(),false) AS live FROM stripe_test_notices WHERE id=${id}::uuid AND household_id=${hh}::uuid`
      : await tx.$queryRaw<Array<{ state: string; attempts: number; live: boolean }>>`SELECT state,attempts,coalesce(lease_until>clock_timestamp(),false) AS live FROM stripe_test_intents WHERE id=${id}::uuid AND household_id=${hh}::uuid`;
    return rows[0] ?? null;
  });
}

/** The digest a binding's route row carries; computed identically by the migration trigger. */
export function stripeTestRouteDigest(accountId: string, objectId: string): string {
  if (!accountOk(accountId) || !/^(cus|sub)_[A-Za-z0-9]{1,240}$/.test(objectId)) return refuse();
  return createHash("sha256").update(`stripe-test:${accountId}:${objectId}`, "utf8").digest("hex");
}

/** Billing runtime: whether the household is fenced for deletion, so a provider redelivery for
 * a closing household is acknowledged instead of retried forever. Reads only deletion state. */
export async function readTestBillingHouseholdClosed(db: Database, hh: string): Promise<boolean> {
  if (!UUID_RE.test(hh)) return refuse();
  return db.withHousehold(hh, async tx => {
    await assertTestBillingTransaction(tx);
    const [r] = await tx.$queryRaw<Array<{ closed: boolean }>>`SELECT EXISTS(SELECT 1 FROM household_deletions
      WHERE household_id=${hh}::uuid AND state IN ('fenced','verifying','completed')) AS closed`;
    return Boolean(r?.closed);
  });
}
