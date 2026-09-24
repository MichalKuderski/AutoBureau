import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { readHouseholdDeletionStatus, undoHouseholdDeletion } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const UndoSchema = z.object({ requestId: z.string().uuid() }).strict();
/** Undo is honoured only inside the database-clock grace window; a fenced deletion
 * cannot be reversed from the application. */
export const POST = authenticated({ requires: "household.delete" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-3));
  if (!id.success || id.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  const body = await jsonBody(request, UndoSchema, 1024);
  if (!await undoHouseholdDeletion(db, id.data, body.requestId))
    throw new HttpProblem("conflict", "This deletion can no longer be undone.");
  return readHouseholdDeletionStatus(db, id.data);
});
export const dynamic = "force-dynamic";
