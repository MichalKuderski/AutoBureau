import { createHash } from "node:crypto";
import { z } from "zod";

export class PlaidError extends Error {
  override name = "PlaidError";
  constructor(readonly code: "unavailable" | "reconnect" | "rate-limited" | "invalid" | "unconfigured") { super(`Financial connection: ${code}`); }
}
interface PlaidConfig { clientId: string; secret: string; scope: "stg" | "preview" }
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
const routes = ["/link/token/create", "/item/public_token/exchange", "/item/remove", "/webhook_verification_key/get"] as const;
/** No SDK response/error objects or configurable endpoint URLs cross this module. */
export function createPlaidSandboxClient(config: PlaidConfig, fetchImpl: typeof fetch = fetch) {
  if (!/^[a-f0-9]{24}$/.test(config.clientId) || !/^[^\s]{16,256}$/.test(config.secret) || !["stg", "preview"].includes(config.scope)) throw new PlaidError("unconfigured");
  const { clientId, secret, scope } = config;
  async function post<T>(route: typeof routes[number], data: unknown, schema: z.ZodType<T>): Promise<T> {
    if (!routes.includes(route)) throw new PlaidError("invalid");
    try {
      const response = await fetchImpl(`https://sandbox.plaid.com${route}`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret, "Plaid-Version": "2020-09-14" }, body: JSON.stringify(data) });
      // Bound untrusted provider response bodies before parsing. No automatic retry of
      // one-time exchange/removal: ambiguity is reconciled by the durable caller.
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      if (!reader) throw new PlaidError("unavailable");
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length;
          if (length > 65536) throw new PlaidError("unavailable"); chunks.push(value); }
      } finally { await reader.cancel().catch(() => undefined); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        const e = z.object({ error_code: z.string() }).safeParse(value);
        if (response.status === 429) throw new PlaidError("rate-limited");
        if (e.success && e.data.error_code === "ITEM_LOGIN_REQUIRED") throw new PlaidError("reconnect");
        throw new PlaidError("unavailable");
      }
      const parsed = schema.safeParse(value); if (!parsed.success) throw new PlaidError("unavailable"); return parsed.data;
    } catch (e) { if (e instanceof PlaidError) throw e; throw new PlaidError("unavailable"); }
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
