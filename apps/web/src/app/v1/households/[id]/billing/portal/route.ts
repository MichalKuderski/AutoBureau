import { UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { billingClientConfig } from "@/server/billing/runtime-client";
import { openPortal } from "@/server/billing/checkout-flow";
import { billingProblem, billingHousehold } from "@/server/billing/problems";

/** Owner + recent authentication. Returns a short-lived provider portal URL for the bound customer. */
export const POST = authenticated({ requires: "billing.manage" }, async ({ request, ctx, db }) => {
  const hh = billingHousehold(request, ctx.householdId, UuidSchema);
  const client = billingClientConfig();
  if (!client) throw billingProblem("unmounted");
  try { return await openPortal(db, hh, client); }
  catch (e) { throw billingProblem(e); }
});
export const dynamic = "force-dynamic";
export const maxDuration = 30;
