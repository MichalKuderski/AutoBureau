import { UuidSchema } from "@autobureau/contracts";
import { readDocumentResultState, DocumentResultRefused } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

/** PRD §21.3 owner view of a document's latest result: state, months and slot usage only. */
export const GET = authenticated({ requires: "document.resolve" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!id.success) throw new HttpProblem("not-found", "That document was not found.");
  try { return await readDocumentResultState(db, ctx.householdId, id.data); }
  catch (e) { if (e instanceof DocumentResultRefused) throw new HttpProblem("not-found", "That document was not found."); throw e; }
});
export const dynamic = "force-dynamic";
