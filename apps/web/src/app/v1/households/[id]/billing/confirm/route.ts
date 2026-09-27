import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { traceIdFrom } from "@/server/observability";
import { billingClientConfig } from "@/server/billing/runtime-client";
import { confirmCheckout } from "@/server/billing/checkout-flow";
import { billingProblem, billingHousehold } from "@/server/billing/problems";

const Body = z.object({ cancel: z.boolean() }).strict();
/** Owner's return from checkout (or "check status"). Asks the billing runtime; the browser's
 * return itself proves nothing. `cancel` expires a still-open session at the provider. */
export const POST = authenticated({ requires: "settings.manage" }, async ({ request, ctx, db }) => {
  const hh = billingHousehold(request, ctx.householdId, UuidSchema);
  const body = await jsonBody(request, Body, 256);
  const client = billingClientConfig();
  if (!client) throw billingProblem("unmounted");
  try { return await confirmCheckout(db, hh, client, body.cancel, traceIdFrom(request)); }
  catch (e) { throw billingProblem(e); }
});
export const dynamic = "force-dynamic";
export const maxDuration = 60;
