import { localAccountMount } from "@/server/auth/local-account-mount";
export async function POST(request: Request): Promise<Response> { return localAccountMount(request); }
export const dynamic = "force-dynamic";
