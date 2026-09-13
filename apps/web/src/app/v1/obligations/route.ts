import { authenticated } from "@/server/http/route";
import { obligations } from "@/server/domain/read";
import { createObligation } from "@/server/domain/obligation-actions";

export const GET = authenticated({ requires: "registry.read" }, obligations);
export const POST = authenticated({ requires: "obligation.write" }, createObligation);
export const dynamic = "force-dynamic";
