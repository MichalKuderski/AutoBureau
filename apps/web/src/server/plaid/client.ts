import { createHash } from "node:crypto";
import { z } from "zod";

import { PlaidError, type PlaidConfig } from "./errors";
import { createPlaidSandboxTransport, type PlaidSandboxRoute } from "./transport";
export { PlaidError } from "./errors";
export function plaidSandboxConfig(env: NodeJS.ProcessEnv = process.env): PlaidConfig {
  if (env.PLAID_SANDBOX_ENABLED !== "true" || env.PLAID_ENVIRONMENT !== "sandbox"
    || env.AUTH_ISSUER !== "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1"
    || env.VERCEL_PROJECT_ID !== "prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR" || !["preview", "production"].includes(env.VERCEL_ENV ?? "")
    || !/^[a-f0-9]{24}$/.test(env.PLAID_CLIENT_ID ?? "") || !/^[^\s]{16,256}$/.test(env.PLAID_SANDBOX_SECRET ?? "")
    || env.PLAID_PRODUCTION_SECRET || env.NEXT_PUBLIC_PLAID_SECRET || env.NEXT_PUBLIC_PLAID_SANDBOX_SECRET) throw new PlaidError("unconfigured");
  return { clientId: env.PLAID_CLIENT_ID!, secret: env.PLAID_SANDBOX_SECRET!, scope: env.VERCEL_ENV === "preview" ? "preview" : "stg" };
}
const opaque = z.string().min(1).max(256);
const sandboxToken = (kind: "public" | "access" | "link") => z.string().min(1).max(1024).regex(new RegExp(`^${kind}-sandbox-[A-Za-z0-9_-]+$`));
const keyResponse = z.object({ key: z.unknown() });
const linkResponse = z.object({ link_token: sandboxToken("link"), expiration: z.string().datetime() });
const exchangeResponse = z.object({ access_token: sandboxToken("access"), item_id: opaque });
const removeResponse = z.object({ request_id: opaque });
const binding = z.object({ userId: z.string().uuid(), householdId: z.string().uuid() }).strict();
/** No SDK response/error objects or configurable endpoint URLs cross this module. */
export function createPlaidSandboxClient(config: PlaidConfig, fetchImpl: typeof fetch = fetch) {
  const { scope } = config;
  const request = createPlaidSandboxTransport(config, fetchImpl);
  async function post<T>(route: PlaidSandboxRoute, data: unknown, schema: z.ZodType<T>): Promise<T> {
    const value = await request(route, data);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new PlaidError("unavailable");
    return parsed.data;
  }
  return {
    async createLinkToken(owner: z.infer<typeof binding>, accessToken?: string) {
      let id: z.infer<typeof binding>;
      try { id = binding.parse(owner); if (accessToken) sandboxToken("access").parse(accessToken); } catch { throw new PlaidError("invalid"); }
      const clientUserId = createHash("sha256").update(`${scope}:${id.userId}:${id.householdId}`).digest("hex");
      return post("/link/token/create", { client_name: "Pellum", language: "en", country_codes: ["US"], user: { client_user_id: clientUserId },
        ...(accessToken ? { access_token: accessToken } : { products: ["transactions"], optional_products: ["liabilities"] }) }, linkResponse);
    },
    async exchangePublicToken(publicToken: string) {
      try { sandboxToken("public").parse(publicToken); } catch { throw new PlaidError("invalid"); }
      return post("/item/public_token/exchange", { public_token: publicToken }, exchangeResponse);
    },
    async removeItem(accessToken: string) {
      try { sandboxToken("access").parse(accessToken); } catch { throw new PlaidError("invalid"); }
      await post("/item/remove", { access_token: accessToken }, removeResponse);
    },
    async getVerificationKey(kid: string) {
      if (!z.string().uuid().safeParse(kid).success) throw new PlaidError("invalid");
      return (await post("/webhook_verification_key/get", { key_id: kid }, keyResponse)).key;
    },
  };
}
