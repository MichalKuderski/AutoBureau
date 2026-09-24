import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { readLocalPlaidConnections, requestLocalPlaidUnlink } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const BodySchema = z.object({ history: z.enum(["delete", "retain"]) }).strict();
/** Recent-auth disconnect. Stops syncing immediately; provider removal follows in the
 * isolated runtime. The owner chooses whether imported history is deleted (default). */
export const POST = authenticated({ requires: "financial.manage" }, async ({ request, ctx, db }) => {
  const parts = new URL(request.url).pathname.split("/");
  const hh = UuidSchema.safeParse(parts.at(-4)), item = UuidSchema.safeParse(parts.at(-2));
  if (!hh.success || hh.data !== ctx.householdId || !item.success) throw new HttpProblem("not-found", "That connection was not found.");
  const body = await jsonBody(request, BodySchema, 256);
  try { await requestLocalPlaidUnlink(db, hh.data, item.data, body.history); }
  catch { throw new HttpProblem("conflict", "That connection can't be changed right now."); }
  return { linkAvailable: false, connections: await readLocalPlaidConnections(db, hh.data) };
});
export const dynamic = "force-dynamic";
