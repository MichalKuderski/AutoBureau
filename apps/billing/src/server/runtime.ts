import { createHostedBillingRuntime, type BillingRuntime } from "@autobureau/billing-boundary";

/**
 * One runtime per function instance, built from the gated environment on first use.
 * Unavailable (kill switch, missing or malformed configuration, or web-runtime authority
 * present) means every billing route answers 404 and the health route 503: the runtime
 * fails closed, and a refusal names no variable.
 */
let cached: BillingRuntime | null | undefined;
export function billingRuntime(env: Readonly<Record<string, string | undefined>> = process.env): BillingRuntime | null {
  if (cached !== undefined) return cached;
  try { cached = createHostedBillingRuntime(env); } catch { cached = null; }
  return cached;
}
/** Test seam: the module-level runtime would otherwise outlive an environment change. */
export function resetBillingRuntime(): void { cached = undefined; }

const unavailable = () => Response.json({ error: "not-found" }, { status: 404, headers: { "cache-control": "no-store" } });
export async function serve(fn: (rt: BillingRuntime) => Promise<Response>): Promise<Response> {
  const rt = billingRuntime();
  if (!rt) return unavailable();
  try { return await fn(rt); }
  catch {
    console.error(JSON.stringify({ event: "billing.route_failed", level: "error", runtime: "billing-test" }));
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
