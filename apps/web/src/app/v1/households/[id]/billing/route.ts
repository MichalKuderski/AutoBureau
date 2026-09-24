import { UuidSchema } from "@autobureau/contracts";
import { readBillingStatus } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

/** Owner-only billing status: effective tier and the latest reconciled TEST state. Display only. */
export const GET = authenticated({ requires: "settings.manage" }, async ({ request, ctx, db }) => {
  const hh = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!hh.success || hh.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  return readBillingStatus(db, hh.data);
});
export const dynamic = "force-dynamic";
