import { authenticated } from "@/server/http/route";
import { item } from "@/server/domain/read";
import { editItem } from "@/server/domain/item-actions";

export const GET = authenticated({ requires: "registry.read" }, item);
export const PATCH = authenticated({ requires: "item.write" }, editItem);
export const dynamic = "force-dynamic";
