import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { cancelDocumentWork, DocumentWorkNotCancellable } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const BodySchema = z.object({}).strict();
/** Stops processing that has not started. Keeps the stored original; never deletes,
 * retries, releases capacity or calls a provider. The database decides eligibility. */
export const POST = authenticated({ requires: "document.upload" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!id.success) throw new HttpProblem("not-found", "That document was not found.");
  await jsonBody(request, BodySchema, 256);
  let work;
  try { work = await cancelDocumentWork(db, ctx.householdId, id.data); }
  catch (e) { if (e instanceof DocumentWorkNotCancellable) throw new HttpProblem("conflict", "Processing has already started, so it can't be stopped now."); throw e; }
  if (!work) throw new HttpProblem("not-found", "That document was not found.");
  return work;
});
export const dynamic = "force-dynamic";
