import { UuidSchema } from "@autobureau/contracts";
import { readDocumentWork } from "@autobureau/db";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

/** Processing state of one document, metadata only (no content, result or path). */
export const GET = authenticated({ requires: "registry.read" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  const work = id.success ? await readDocumentWork(db, ctx.householdId, id.data) : null;
  if (!work) throw new HttpProblem("not-found", "That document was not found.");
  return work;
});
export const dynamic = "force-dynamic";
