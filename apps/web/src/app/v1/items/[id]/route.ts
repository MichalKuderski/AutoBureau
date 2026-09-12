import { authenticated } from "@/server/http/route";
import { item } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, item);
export const dynamic = "force-dynamic";
