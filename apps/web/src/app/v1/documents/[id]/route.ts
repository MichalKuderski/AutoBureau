import { authenticated } from "@/server/http/route";
import { document } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, document);
export const dynamic = "force-dynamic";
