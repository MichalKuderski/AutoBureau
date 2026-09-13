import { authenticated } from "@/server/http/route";
import { readNotifications } from "@/server/domain/notifications";
export const POST = authenticated({ requires: "registry.read" }, readNotifications);
export const dynamic = "force-dynamic";
