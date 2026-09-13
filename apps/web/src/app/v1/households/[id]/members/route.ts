import { authenticated } from "@/server/http/route";
import { listMembers, addMember } from "@/server/domain/members";

export const GET = authenticated({ requires: "registry.read" }, listMembers);
export const POST = authenticated({ requires: "member.manage" }, addMember);
export const dynamic = "force-dynamic";
