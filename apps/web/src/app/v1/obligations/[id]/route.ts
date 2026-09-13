import { authenticated } from "@/server/http/route";
import { obligation } from "@/server/domain/read";
import { updateObligation } from "@/server/domain/obligation-actions";

export const GET = authenticated({ requires: "registry.read" }, obligation);
export const PATCH = authenticated({ requires: "obligation.write" }, updateObligation);
export const dynamic = "force-dynamic";
