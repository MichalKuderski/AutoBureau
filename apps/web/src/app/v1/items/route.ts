import { authenticated } from "@/server/http/route";
import { items } from "@/server/domain/read";

export const GET = authenticated({ requires: "registry.read" }, items);
export const dynamic = "force-dynamic";
