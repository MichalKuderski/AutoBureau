import { authenticated } from "@/server/http/route";
import { obligations } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, obligations);
export const dynamic = "force-dynamic";
