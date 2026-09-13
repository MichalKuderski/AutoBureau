import { authenticated } from "@/server/http/route";
import { notifications } from "@/server/domain/notifications";
export const GET = authenticated({ requires: "registry.read" }, notifications);
export const dynamic = "force-dynamic";
