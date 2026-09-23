import { authenticated } from "@/server/http/route";
import { restoreMember } from "@/server/domain/members";

export const POST = authenticated({ requires: "member.manage" }, restoreMember);
export const dynamic = "force-dynamic";
