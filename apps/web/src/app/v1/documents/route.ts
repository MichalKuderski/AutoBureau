import { authenticated } from "@/server/http/route";
import { documents } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, documents);
export const dynamic = "force-dynamic";
