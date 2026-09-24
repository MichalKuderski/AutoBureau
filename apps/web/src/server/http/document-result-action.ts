import { z } from "zod";
import { UuidSchema } from "@autobureau/contracts";
import { applyDocumentResult, discardDocumentResult, readDocumentResultState, DocumentResultRefused, type Database } from "@autobureau/db";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const BodySchema = z.object({ resultId: UuidSchema }).strict();
const MESSAGES = {
  capacity: "There's no processing room left this month, so this reading stays held. Nothing was charged.",
  "not-actionable": "This reading has already been filed or discarded.",
  unavailable: "This reading can't be changed right now. Nothing was charged.",
} as const;
/** Shared by the apply/discard routes: strict body, exact document binding, honest refusals. */
export async function resultAction(kind: "apply" | "discard", request: Request, householdId: string, db: Database) {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-3));
  if (!id.success) throw new HttpProblem("not-found", "That document was not found.");
  const { resultId } = await jsonBody(request, BodySchema, 256);
  try {
    if (kind === "apply") await applyDocumentResult(db, householdId, id.data, resultId);
    else await discardDocumentResult(db, householdId, id.data, resultId);
  } catch (e) {
    if (!(e instanceof DocumentResultRefused)) throw e;
    if (e.reason === "not-found") throw new HttpProblem("not-found", "That document was not found.");
    throw new HttpProblem("conflict", MESSAGES[e.reason]);
  }
  return readDocumentResultState(db, householdId, id.data);
}
