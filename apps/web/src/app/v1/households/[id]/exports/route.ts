import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { readLatestOwnerExport, requestOwnerExport } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import { exportArchiveStorage } from "@/server/privacy/export-storage";

const CreateSchema = z.object({ requestId: z.string().uuid() }).strict();
const household = (request: Request, current: string, segment: number) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(segment));
  if (!id.success || id.data !== current) throw new HttpProblem("not-found", "That household was not found.");
  return id.data;
};
/** Status is owner-only and needs no step-up; it states whether export works here at all. */
export const GET = authenticated({ requires: "settings.manage" }, async ({ request, ctx, db }) => {
  const hh = household(request, ctx.householdId, -2);
  return { available: exportArchiveStorage() !== null, latest: await readLatestOwnerExport(db, hh) };
});
/** Request + build in one recent-auth operation. Idempotent per client request ID. */
export const POST = authenticated({ requires: "household.export" }, async ({ request, ctx, db }) => {
  const hh = household(request, ctx.householdId, -2);
  const body = await jsonBody(request, CreateSchema, 1024);
  const storage = exportArchiveStorage();
  if (!storage) throw new HttpProblem("unavailable", "Export isn't available on this deployment yet.");
  try { await requestOwnerExport(db, hh, body.requestId); }
  catch { throw new HttpProblem("rate-limited", "You can prepare up to three exports a day. Try again later."); }
  try { await storage.build(db, hh, body.requestId); }
  catch { throw new HttpProblem("unavailable", "The export couldn't be prepared. Nothing was shared."); }
  return readLatestOwnerExport(db, hh);
});
export const dynamic = "force-dynamic";
