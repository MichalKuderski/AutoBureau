import { UuidSchema } from "@autobureau/contracts";
import { readBillingStatus } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";
import { billingClientConfig } from "@/server/billing/runtime-client";

/** Owner-only billing status: effective tier and the latest reconciled TEST state. Display only.
 * Checkout/portal availability means the billing runtime is mounted here, nothing more. */
export const GET = authenticated({ requires: "settings.manage" }, async ({ request, ctx, db }) => {
  const hh = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!hh.success || hh.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  const status = await readBillingStatus(db, hh.data), mounted = billingClientConfig() !== null;
  return { ...status, checkoutAvailable: mounted && !status.subscribed, paymentUpdateAvailable: mounted && status.subscribed };
});
export const dynamic = "force-dynamic";
