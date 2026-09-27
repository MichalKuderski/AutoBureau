import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { UUID_RE } from "@autobureau/contracts";
import {
  acceptStripeTestNotice, requestStripeTestReconciliation, readStripeTestCheckoutForProvider, readStripeTestBindingForProvider,
  readStripeTestWorkState, readTestBillingHouseholdClosed, stripeTestRouteDigest, type Database,
} from "@autobureau/db";
import { INTERNAL_MAX_BODY_BYTES, INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER, verifyInternalRequest } from "./internal-signature.js";
import { reconcileStripeTestNotice } from "./stripe-test-reconcile.js";
import type { TestBillingReadPort } from "./stripe-test-refetch.js";
import type { TestBillingWritePort } from "./stripe-test-provider.js";
import type { StripeTestPriceBinding } from "./stripe-test-policy.js";

/**
 * The hosted TEST billing runtime (ADR-020 hosted amendment). Framework-free handlers; the
 * billing app's route files only call these. Authority is the dedicated `app_billing_test`
 * role (every transaction asserts it) plus the Stripe TEST credentials; this runtime holds no
 * app_user or auth credential. Provider calls always happen between short transactions.
 *
 *  - webhook: official raw-body verification → knows-the-key route → durable inbox (dedupe
 *    on account+event) → leased refetch → atomic state/audit/outbox commit. The answer tells
 *    Stripe the truth: 2xx only when the event is durably settled or can never be.
 *  - internal: signed requests from the web runtime about an intent the OWNER already wrote.
 *  - recheck: a bounded provider-driven walk that reconciles missed webhooks with an internal
 *    UUID intent, never a fabricated `evt_`.
 */
export interface BillingRuntimeConfig {
  accountId: string; appOrigin: string; internalSecret: string; cronSecret: string | null;
  catalog: readonly StripeTestPriceBinding[];
}
export type BillingLog = (event: string, level: "info" | "warn" | "error", fields?: Record<string, string | number | boolean>) => void;
export interface BillingRuntimeDeps {
  db: Database; read: TestBillingReadPort; write: TestBillingWritePort; config: BillingRuntimeConfig;
  verify: (raw: Uint8Array, signature: string | null) => { kind: "ignored"; eventId: string }
    | { kind: "reconcile"; eventId: string; eventType: string; objectId: string; created: number; customerId: string | null };
  now?: () => number; log?: BillingLog;
}
export const WEBHOOK_MAX_BODY_BYTES = 131_072;
/** An unroutable event younger than this is retried by Stripe: the owner's return may still bind it. */
export const UNROUTED_RETRY_SECONDS = 3600;
export const RECHECK_MAX_SUBSCRIPTIONS = 25;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
/** Correlation without exposing the provider identifier itself. */
const ref = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

async function boundedBytes(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > max)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
const refusedByJournal = (e: unknown) => e instanceof Error && e.message === "Test billing journal refused";
const uuid = z.string().regex(UUID_RE);
const OPS = {
  "checkout-session": z.object({ householdId: uuid, checkoutId: uuid, plan: z.enum(["monthly", "annual"]) }).strict(),
  "checkout-resolve": z.object({ householdId: uuid, checkoutId: uuid, expire: z.boolean() }).strict(),
  reconcile: z.object({ householdId: uuid, bindingId: uuid, requestKey: uuid }).strict(),
  portal: z.object({ householdId: uuid }).strict(),
} as const;
export type InternalOp = keyof typeof OPS;
export const INTERNAL_OPS = Object.freeze(Object.keys(OPS) as InternalOp[]);

/** A deterministic UUID for "this subscription, this UTC day": the recheck's durable dedupe key. */
export function recheckRequestKey(subscriptionId: string, day: string): string {
  const h = createHash("sha256").update(`scheduled-recheck:${subscriptionId}:${day}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function createBillingRuntime(deps: BillingRuntimeDeps) {
  const { db, read, write, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const log: BillingLog = deps.log ?? ((event, level, fields = {}) => {
    const line = JSON.stringify({ event, level, ...fields, runtime: "billing-test" });
    if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.info(line);
  });

  /** Reconcile one durable notice/intent and report whether it is settled for good. */
  async function settle(hh: string, id: string, kind: "notice" | "intent"): Promise<"reconciled" | "settled" | "retry" | "exhausted"> {
    let outcome: "reconciled" | "other";
    try { outcome = (await reconcileStripeTestNotice(db, hh, id, read, config.catalog, kind)).kind === "reconciled" ? "reconciled" : "other"; }
    catch { outcome = "other"; }
    if (outcome === "reconciled") return "reconciled";
    const state = await readStripeTestWorkState(db, hh, id, kind);
    if (!state) return "retry";
    if (state.state === "reconciled" || state.state === "refused") return "settled";
    if (state.attempts >= 3 && !state.live) return "exhausted";
    return "retry";
  }

  async function webhook(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const raw = await boundedBytes(request, WEBHOOK_MAX_BODY_BYTES);
    if (!raw) return json({ error: "too-large" }, 413);
    let event: ReturnType<BillingRuntimeDeps["verify"]>;
    try { event = deps.verify(raw, request.headers.get("stripe-signature")); }
    catch { log("billing.webhook_unverified", "warn"); return json({ error: "unverified" }, 400); }
    const evt = ref(event.eventId);
    if (event.kind === "ignored") return json({ received: true });
    if (!event.customerId) { log("billing.webhook_unroutable", "warn", { evt }); return json({ received: true }); }
    const route = await db.resolveTestBillingRoute(stripeTestRouteDigest(config.accountId, event.customerId));
    if (!route) {
      // Not (yet) bound: the owner's verified return may bind it shortly, so a young event is
      // retried by the provider; an old one belongs to no household here and is acknowledged.
      if (now() - event.created < UNROUTED_RETRY_SECONDS) { log("billing.webhook_unbound_retry", "info", { evt }); return json({ retry: true }, 503, { "retry-after": "60" }); }
      log("billing.webhook_unbound", "warn", { evt }); return json({ received: true });
    }
    let noticeId: string;
    try {
      noticeId = await acceptStripeTestNotice(db, route.householdId, route.bindingId, config.accountId,
        { eventId: event.eventId, eventType: event.eventType, objectId: event.objectId, created: event.created });
    } catch (e) {
      if (refusedByJournal(e)) { log("billing.notice_refused", "warn", { evt }); return json({ received: true }); }
      if (await readTestBillingHouseholdClosed(db, route.householdId).catch(() => false)) { log("billing.household_closed", "info", { evt }); return json({ received: true }); }
      log("billing.notice_unavailable", "error", { evt }); return json({ retry: true }, 503, { "retry-after": "30" });
    }
    const outcome = await settle(route.householdId, noticeId, "notice");
    if (outcome === "exhausted") log("billing.notice_exhausted", "error", { evt });
    else if (outcome === "retry") log("billing.reconcile_retry", "warn", { evt });
    else log("billing.notice_settled", "info", { evt, outcome });
    return outcome === "retry" ? json({ retry: true }, 503, { "retry-after": "30" }) : json({ received: true });
  }

  async function internal(request: Request, op: string): Promise<Response> {
    const path = new URL(request.url).pathname;
    // The signature covers the path, and the path must name exactly this operation.
    if (!Object.hasOwn(OPS, op) || path !== `/v1/stripe-test/internal/${op}`) return json({ error: "not-found" }, 404);
    const raw = await boundedBytes(request, INTERNAL_MAX_BODY_BYTES);
    if (!raw || !verifyInternalRequest(config.internalSecret, request.method, path, raw,
      request.headers.get(INTERNAL_TIMESTAMP_HEADER), request.headers.get(INTERNAL_SIGNATURE_HEADER), now())) {
      log("billing.internal_unverified", "warn", { op }); return json({ error: "unverified" }, 401);
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return json({ error: "invalid" }, 400); }
    const parsed = OPS[op as InternalOp].safeParse(body);
    if (!parsed.success) return json({ error: "invalid" }, 400);
    const input = parsed.data as Record<string, unknown> & { householdId: string };
    try {
      switch (op as InternalOp) {
        case "checkout-session": {
          const { checkoutId, plan } = input as z.infer<typeof OPS["checkout-session"]>;
          const intent = await readStripeTestCheckoutForProvider(db, input.householdId, checkoutId);
          const price = config.catalog.find(p => p.plan === plan);
          if (!intent || intent.state !== "created" || intent.plan !== plan || intent.accountId !== config.accountId || !price) return json({ error: "refused" }, 409);
          const back = `${config.appOrigin}/settings/billing`;
          const created = await write.createCheckout({ checkoutId, priceId: price.priceId, successUrl: `${back}?checkout=return`, cancelUrl: `${back}?checkout=cancelled` });
          log("billing.checkout_opened", "info", { plan });
          return json(created);
        }
        case "checkout-resolve": {
          const { checkoutId, expire } = input as z.infer<typeof OPS["checkout-resolve"]>;
          const intent = await readStripeTestCheckoutForProvider(db, input.householdId, checkoutId);
          if (!intent || intent.state !== "opened" || !intent.sessionId || !intent.customerId || intent.accountId !== config.accountId) return json({ error: "refused" }, 409);
          let s = await write.retrieveSession(intent.sessionId);
          // Exact provider IDs: the session must be the one recorded for this intent, before payment.
          if (s.sessionId !== intent.sessionId || s.customerId !== intent.customerId || s.checkoutId !== checkoutId) {
            log("billing.checkout_mismatch", "error"); return json({ error: "refused" }, 409);
          }
          if (s.status === "open" && expire) s = await write.expireSession(intent.sessionId);
          if (s.status === "complete") {
            if (!s.subscriptionId) return json({ error: "refused" }, 409);
            return json({ status: "complete", subscriptionId: s.subscriptionId });
          }
          return json({ status: s.status });
        }
        case "reconcile": {
          const { bindingId, requestKey } = input as z.infer<typeof OPS["reconcile"]>;
          const binding = await readStripeTestBindingForProvider(db, input.householdId);
          if (!binding || binding.bindingId !== bindingId || binding.accountId !== config.accountId) return json({ error: "refused" }, 409);
          const intentId = await requestStripeTestReconciliation(db, input.householdId, bindingId, requestKey, "checkout-return");
          const outcome = await settle(input.householdId, intentId, "intent");
          log("billing.checkout_reconcile", outcome === "exhausted" ? "error" : "info", { outcome });
          return json({ status: outcome === "reconciled" || outcome === "settled" ? "settled" : "pending" }, outcome === "retry" || outcome === "exhausted" ? 202 : 200);
        }
        case "portal": {
          const binding = await readStripeTestBindingForProvider(db, input.householdId);
          if (!binding || binding.accountId !== config.accountId) return json({ error: "refused" }, 409);
          return json(await write.createPortal(binding.customerId, `${config.appOrigin}/settings/billing`));
        }
      }
    } catch {
      log("billing.internal_failed", "error", { op });
      return json({ error: "unavailable" }, 502);
    }
    return json({ error: "not-found" }, 404);
  }

  async function recheck(request: Request): Promise<Response> {
    const given = /^Bearer (.{32,256})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const expected = config.cronSecret;
    if (!expected || !given || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected)))
      return json({ error: "not-found" }, 404);
    const day = new Date(now() * 1000).toISOString().slice(0, 10);
    const counts = { listed: 0, unrouted: 0, reconciled: 0, settled: 0, retry: 0, exhausted: 0, refused: 0 };
    let list: { subscriptionIds: string[]; truncated: boolean };
    try { list = await write.listSubscriptions(); }
    catch { log("billing.recheck_failed", "error"); return json({ error: "unavailable" }, 502); }
    for (const subscriptionId of list.subscriptionIds.slice(0, RECHECK_MAX_SUBSCRIPTIONS)) {
      counts.listed++;
      try {
        const route = await db.resolveTestBillingRoute(stripeTestRouteDigest(config.accountId, subscriptionId));
        if (!route || route.kind !== "subscription") { counts.unrouted++; continue; }
        const intentId = await requestStripeTestReconciliation(db, route.householdId, route.bindingId, recheckRequestKey(subscriptionId, day), "scheduled-recheck");
        counts[await settle(route.householdId, intentId, "intent")]++;
      } catch { counts.refused++; }
    }
    log("billing.recheck", counts.exhausted || counts.refused ? "error" : "info", { ...counts, truncated: list.truncated });
    return json({ ...counts, truncated: list.truncated });
  }

  return { webhook, internal, recheck };
}
export type BillingRuntime = ReturnType<typeof createBillingRuntime>;
