import { authenticated } from "@/server/http/route";
import { notificationSettings } from "@/server/domain/notifications";
export const GET = authenticated({ requires: "registry.read" }, notificationSettings);
export const PATCH = authenticated({ requires: "settings.manage" }, notificationSettings);
export const dynamic = "force-dynamic";
