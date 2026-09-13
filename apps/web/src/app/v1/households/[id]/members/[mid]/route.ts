import { authenticated } from "@/server/http/route";
import { editMember, archiveMember } from "@/server/domain/members";

export const PATCH = authenticated({ requires: "member.manage" }, editMember);
export const DELETE = authenticated({ requires: "member.manage" }, archiveMember);
export const dynamic = "force-dynamic";
