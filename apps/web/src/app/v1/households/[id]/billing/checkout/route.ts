import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { traceIdFrom } from "@/server/observability";
import { billingClientConfig } from "@/server/billing/runtime-client";
import { startCheckout } from "@/server/billing/checkout-flow";
import { billingProblem, billingHousehold } from "@/server/billing/problems";

const Body = z.object({ plan: z.enum(["monthly", "annual"]), requestId: z.string().uuid() }).strict();
/** Owner + recent authentication. Returns the provider's hosted checkout URL; never a grant. */
export const POST = authenticated({ requires: "billing.manage" }, async ({ request, ctx, db }) => {
  const hh = billingHousehold(request, ctx.householdId, UuidSchema);
  const body = await jsonBody(request, Body, 512);
  const client = billingClientConfig();
  if (!client) throw billingProblem("unmounted");
  try { return await startCheckout(db, hh, client, body.plan, body.requestId, traceIdFrom(request)); }
  catch (e) { throw billingProblem(e); }
});
export const dynamic = "force-dynamic";
export const maxDuration = 60;
