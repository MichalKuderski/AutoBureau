import { UuidSchema } from "@autobureau/contracts";
import { readLocalPlaidConnections } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

/** Owner-only safe projection: states, account names/kinds/balances. Never provider IDs,
 * cursors, leases, custody or provider error text. Linking itself is not mounted. */
export const GET = authenticated({ requires: "financial.read" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!id.success || id.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  return { linkAvailable: false, connections: await readLocalPlaidConnections(db, id.data) };
});
export const dynamic = "force-dynamic";
