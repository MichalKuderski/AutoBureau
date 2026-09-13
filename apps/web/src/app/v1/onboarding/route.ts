import { authenticated } from "@/server/http/route";
import { onboarding } from "@/server/domain/onboarding";

export const GET = authenticated({ requires: "settings.manage" }, onboarding);
export const PATCH = authenticated({ requires: "settings.manage" }, onboarding);
export const dynamic = "force-dynamic";
