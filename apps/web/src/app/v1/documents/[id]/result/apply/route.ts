import { authenticated } from "@/server/http/route";
import { resultAction } from "@/server/http/document-result-action";

/** Files a held result in the CURRENT month (one slot, capacity permitting); never reprocesses. */
export const POST = authenticated({ requires: "document.resolve" }, ({ request, ctx, db }) => resultAction("apply", request, ctx.householdId, db));
export const dynamic = "force-dynamic";
