import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { DeletionJournalError, readHouseholdDeletionStatus, requestHouseholdDeletion } from "@autobureau/db";
import { accepted, authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const RequestSchema = z.object({ confirmation: z.literal("DELETE HOUSEHOLD") }).strict();
function householdFrom(request: Request, current: string) {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!id.success || id.data !== current) throw new HttpProblem("not-found", "That household was not found.");
  return id.data;
}
/** Status is owner-only but needs no step-up: it reveals states and counts only. */
export const GET = authenticated({ requires: "settings.manage" }, ({ request, ctx, db }) =>
  readHouseholdDeletionStatus(db, householdFrom(request, ctx.householdId)));
/** Requesting deletion is a recent-auth/MFA operation. It starts a 14-day undo window;
 * nothing is erased by this call and no completion receipt is ever implied. */
export const POST = authenticated({ requires: "household.delete" }, async ({ request, ctx, db }) => {
  const hh = householdFrom(request, ctx.householdId);
  await jsonBody(request, RequestSchema, 1024);
  try { await requestHouseholdDeletion(db, hh, "DELETE HOUSEHOLD"); }
  catch (e) { if (e instanceof DeletionJournalError) throw new HttpProblem("forbidden", "Deletion could not be requested."); throw e; }
  return accepted(await readHouseholdDeletionStatus(db, hh));
});
export const dynamic = "force-dynamic";
