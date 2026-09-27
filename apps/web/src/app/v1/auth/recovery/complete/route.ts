import { accountMount } from "@/server/auth/account-mount";
export async function POST(request: Request): Promise<Response> { return accountMount(request); }
