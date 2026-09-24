import { authenticated } from "@/server/http/route";
import { resultAction } from "@/server/http/document-result-action";

/** Discards a held result: never charged; the original upload stays with the household. */
export const POST = authenticated({ requires: "document.resolve" }, ({ request, ctx, db }) => resultAction("discard", request, ctx.householdId, db));
export const dynamic = "force-dynamic";
