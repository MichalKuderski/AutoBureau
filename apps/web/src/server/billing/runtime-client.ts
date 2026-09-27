import { z } from "zod";
import { INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER, internalSecretOk, signInternalRequest } from "@autobureau/billing-boundary/internal-signature";
import { ProviderBodyError, discardProviderBody, readProviderJson } from "../http/provider-body";

type Env = Readonly<Record<string, string | undefined>>;
export interface BillingClientConfig { readonly baseUrl: string; readonly secret: string; readonly accountId: string }
export class BillingRuntimeRefused extends Error { override name = "BillingRuntimeRefused"; constructor() { super("Billing request refused"); } }
export class BillingRuntimeUnavailable extends Error { override name = "BillingRuntimeUnavailable"; constructor() { super("Billing runtime unavailable"); } }

/** Names of values that would make this runtime a Stripe credential holder. */
const STRIPE_CREDENTIAL = /^STRIPE_.*(SECRET|KEY)/;
export const BILLING_REQUEST_TIMEOUT_MS = 25_000;
export const BILLING_RESPONSE_MAX_BYTES = 16 * 1024;

/**
 * The web runtime's view of the dedicated billing runtime (ADR-020 hosted amendment). The web
 * holds NO Stripe credential: it signs requests with the dedicated internal secret and sends
 * them to the billing runtime's origin. Hosted needs HTTPS on a hosted production build;
 * integration tests may use loopback HTTP in a test build. A Stripe secret or key in this
 * environment is a configuration fault, so checkout is unmounted rather than co-located.
 * `BILLING_TEST_DISABLED=1` is the operator kill switch.
 */
export function billingClientConfig(env: Env = process.env): BillingClientConfig | null {
  if (env.BILLING_TEST_DISABLED === "1") return null;
  if (Object.keys(env).some(k => STRIPE_CREDENTIAL.test(k) && env[k])) return null;
  const secret = env.BILLING_INTERNAL_SECRET, accountId = env.STRIPE_TEST_ACCOUNT_ID ?? "";
  if (!internalSecretOk(secret) || !/^acct_[A-Za-z0-9]{1,240}$/.test(accountId)) return null;
  let u: URL;
  try { u = new URL(env.BILLING_RUNTIME_URL ?? ""); } catch { return null; }
  const hosted = env.VERCEL === "1" && env.NODE_ENV === "production" && u.protocol === "https:";
  const local = env.NODE_ENV === "test" && !env.VERCEL && !env.AWS_EXECUTION_ENV && u.protocol === "http:" && u.hostname === "127.0.0.1";
  if (!(hosted || local) || u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
  return { baseUrl: u.origin, secret, accountId };
}

export type BillingOp = "checkout-session" | "checkout-resolve" | "reconcile" | "portal";
/**
 * One signed request, bounded in time and bytes, never followed through a redirect and never
 * retried automatically: a checkout request that timed out is resolved by the owner's next
 * attempt (the provider idempotency keys derive from the intent). 409 = the billing runtime
 * refused (the intent or binding did not match); anything else unusable = unavailable.
 */
export async function callBillingRuntime<T>(config: BillingClientConfig, op: BillingOp, body: unknown, schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch): Promise<{ status: number; data: T }> {
  const path = `/v1/stripe-test/internal/${op}`, bytes = new TextEncoder().encode(JSON.stringify(body));
  const timestamp = Math.floor(Date.now() / 1000), signal = AbortSignal.timeout(BILLING_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, { method: "POST", body: bytes, redirect: "error", cache: "no-store", signal,
      headers: { "content-type": "application/json", [INTERNAL_TIMESTAMP_HEADER]: String(timestamp),
        [INTERNAL_SIGNATURE_HEADER]: signInternalRequest(config.secret, "POST", path, bytes, timestamp) } });
  } catch { throw new BillingRuntimeUnavailable(); }
  if (response.status === 409) { discardProviderBody(response); throw new BillingRuntimeRefused(); }
  if (response.status !== 200 && response.status !== 202) { discardProviderBody(response); throw new BillingRuntimeUnavailable(); }
  try {
    const parsed = schema.safeParse(await readProviderJson(response, signal, BILLING_RESPONSE_MAX_BYTES));
    if (!parsed.success) throw new BillingRuntimeUnavailable();
    return { status: response.status, data: parsed.data };
  } catch (e) {
    if (e instanceof ProviderBodyError || e instanceof BillingRuntimeUnavailable) throw new BillingRuntimeUnavailable();
    throw e;
  }
}

const checkoutUrl = z.string().max(2048).refine(v => { try { const u = new URL(v); return u.origin === "https://checkout.stripe.com" && !u.username && !u.password; } catch { return false; } });
const portalUrl = z.string().max(2048).refine(v => { try { const u = new URL(v); return u.origin === "https://billing.stripe.com" && !u.username && !u.password; } catch { return false; } });
export const CheckoutSessionResponse = z.object({ customerId: z.string().regex(/^cus_[A-Za-z0-9]{1,240}$/),
  sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]{1,240}$/), url: checkoutUrl }).strict();
export const CheckoutResolveResponse = z.union([
  z.object({ status: z.literal("complete"), subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]{1,240}$/) }).strict(),
  z.object({ status: z.enum(["open", "expired"]) }).strict(),
]);
export const ReconcileResponse = z.object({ status: z.enum(["settled", "pending"]) }).strict();
export const PortalResponse = z.object({ url: portalUrl }).strict();
