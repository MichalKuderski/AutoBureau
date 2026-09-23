import { authenticated } from "@/server/http/route";
import { timeline } from "@/server/domain/timeline";

export const GET = authenticated({ requires: "registry.read" }, timeline);
export const dynamic = "force-dynamic";
