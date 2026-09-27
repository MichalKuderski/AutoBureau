import type { z } from "zod";
import { HouseholdFenced, StripeTestCheckoutRefused } from "@autobureau/db";
import { HttpProblem } from "../http/problem";
import { BillingRuntimeRefused, BillingRuntimeUnavailable } from "./runtime-client";

/** `/v1/households/<id>/billing/<action>`: the path household must be the session's. */
export function billingHousehold(request: Request, current: string, schema: z.ZodType<string>): string {
  const id = schema.safeParse(new URL(request.url).pathname.split("/").at(-3));
  if (!id.success || id.data !== current) throw new HttpProblem("not-found", "That household was not found.");
  return id.data;
}

/** The fixed privacy gate's SQLSTATE only (as account-security maps it); never a message. */
const fenced = (e: unknown) => e !== null && typeof e === "object" && "code" in e && e.code === "P2010" && "meta" in e
  && e.meta !== null && typeof e.meta === "object" && "code" in e.meta && e.meta.code === "55000";

/** Plain-language refusals; nothing here echoes a provider or database message. */
export function billingProblem(cause: unknown): unknown {
  if (cause === "unmounted") return new HttpProblem("unavailable", "Checkout isn't available on this deployment. Nothing was charged.");
  if (fenced(cause)) return new HouseholdFenced();
  if (cause instanceof HttpProblem || cause instanceof HouseholdFenced) return cause;
  if (cause instanceof StripeTestCheckoutRefused) {
    if (cause.reason === "subscribed") return new HttpProblem("conflict", "Your household already has a subscription. Manage it from this page.");
    if (cause.reason === "busy") return new HttpProblem("conflict", "A checkout is already being prepared. Try again in a minute.");
    return new HttpProblem("conflict", "That billing request no longer matches this household. Refresh and try again.");
  }
  if (cause instanceof BillingRuntimeRefused) return new HttpProblem("conflict", "That billing request no longer matches this household. Refresh and try again.");
  if (cause instanceof BillingRuntimeUnavailable) return new HttpProblem("unavailable", "Billing is briefly unavailable. Nothing was charged; try again shortly.");
  return cause;
}
