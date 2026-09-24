import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { readLatestOwnerExport } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import { exportArchiveStorage } from "@/server/privacy/export-storage";

const RevokeSchema = z.object({ requestId: z.string().uuid() }).strict();
/** Deletes the prepared archive; later downloads of that request refuse. */
export const POST = authenticated({ requires: "household.export" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-3));
  if (!id.success || id.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  const body = await jsonBody(request, RevokeSchema, 1024);
  const storage = exportArchiveStorage();
  if (!storage) throw new HttpProblem("unavailable", "Export isn't available on this deployment yet.");
  try { await storage.revoke(db, id.data, body.requestId); } catch { throw new HttpProblem("not-found", "That export was not found."); }
  return readLatestOwnerExport(db, id.data);
});
export const dynamic = "force-dynamic";
