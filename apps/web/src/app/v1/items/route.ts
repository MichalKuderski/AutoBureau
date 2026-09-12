import { authenticated } from "@/server/http/route";
import { items } from "@/server/domain/read";
import { createItem } from "@/server/domain/item-actions";

export const GET = authenticated({ requires: "registry.read" }, items);
export const POST = authenticated({ requires: "item.write" }, createItem);
export const dynamic = "force-dynamic";
