import { authenticated } from "@/server/http/route";
import { obligation } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, obligation);
export const dynamic = "force-dynamic";
