import { authenticated } from "@/server/http/route";
import { obligation } from "@/server/domain/read";
import { updateObligationStatus } from "@/server/domain/obligation-actions";

export const GET = authenticated({ requires: "registry.read" }, obligation);
export const PATCH = authenticated({ requires: "obligation.write" }, updateObligationStatus);
export const dynamic = "force-dynamic";
