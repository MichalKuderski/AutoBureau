import { z } from "zod";
import type { AuthConfig } from "./config";
import { ProviderError } from "./provider";
import { discardProviderBody, readProviderJson, ProviderBodyError } from "./provider-body";
import { parseProviderTokens } from "./provider-shape";
import type { SessionTokens } from "./session";

const uuid = z.string().uuid().transform(v => v.toLowerCase());
const factor = z.object({ id: uuid, factor_type: z.literal("totp"), status: z.enum(["verified", "unverified"]) });
export type TotpFactor = z.infer<typeof factor>;
export interface AccountProvider {
  factors(accessToken: string): Promise<{ userId: string; factors: TotpFactor[] }>;
  enroll(accessToken: string): Promise<{ id: string; secret: string }>;
  challenge(accessToken: string, factorId: string): Promise<{ id: string; expiresAt: number }>;
  verify(accessToken: string, factorId: string, challengeId: string, code: string): Promise<SessionTokens>;
  remove(accessToken: string, factorId: string): Promise<void>;
  recover(email: string): Promise<void>;
  redeemRecovery(tokenHash: string): Promise<SessionTokens>;
  updatePassword(accessToken: string, password: string): Promise<{ userId: string }>;
  revoke(accessToken: string): Promise<void>;
}
const invalid = (): never => { throw new ProviderError("unavailable", "Account security is unavailable"); };
const input = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value); if (!parsed.success) return invalid(); return parsed.data;
};
const token = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9._~-]+$/);

/** Server-only GoTrue account lifecycle transport. No service-role key, SDK session,
 * metadata authorization, retry, redirect or error-body logging. Separate interface
 * leaves the proven signup/confirmation transport unchanged. Mounted only via account-mount.ts. */
export function createAccountProvider(config: AuthConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): AccountProvider {
  async function call(path: string, method: "GET" | "POST" | "PUT" | "DELETE", access?: string, body?: object, empty = false): Promise<unknown> {
    if (access !== undefined) input(token, access);
    const signal = AbortSignal.timeout(timeoutMs), start = performance.now();
    let response: Response;
    const diagnostics = (failure: "http" | "network" | "timeout" | "invalid-response") => {
      const id = response?.headers.get("sb-request-id");
      return { failure, durationMs: Math.max(0, Math.round(performance.now() - start)),
        ...(id && z.string().uuid().safeParse(id).success ? { requestId: id } : {}) };
    };
    try {
      response = await fetchImpl(`${config.apiUrl}${path}`, { method, headers: { apikey: config.anonKey,
        "content-type": "application/json", ...(access ? { authorization: `Bearer ${access}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: "no-store", redirect: "manual" });
    } catch { throw new ProviderError("unavailable", "Account security is unavailable", undefined, diagnostics(signal.aborted ? "timeout" : "network")); }
    if (!response.ok) {
      discardProviderBody(response);
      throw new ProviderError(response.status === 429 ? "rate-limited" : [400,401,403,404,422].includes(response.status) ? "invalid-code" : "unavailable",
        "Account security request was refused", response.status, diagnostics("http"));
    }
    if (empty) { discardProviderBody(response); return undefined; }
    try { return await readProviderJson(response, signal); }
    catch (e) { throw new ProviderError("unavailable", "Account security is unavailable", response.status,
      diagnostics(e instanceof ProviderBodyError ? e.failure : "invalid-response")); }
  }
  function tokens(value: unknown) {
    const parsed = parseProviderTokens(value); if (!parsed) return invalid();
    input(token, parsed.accessToken); input(token, parsed.refreshToken);
    if (parsed.expiresIn > 86_400) return invalid();
    return parsed;
  }
  return {
    async factors(access) {
      const raw = await call("/user", "GET", access);
      // Bound before schema traversal. Unknown factor types/statuses fail closed,
      // rather than accidentally downgrading an account to password-only policy.
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
      const list = "factors" in raw ? raw.factors : [];
      if (!Array.isArray(list) || list.length > 10) return invalid();
      const user = input(z.object({ id: uuid }), raw);
      const factors = input(z.array(factor), list);
      if (new Set(factors.map(f => f.id)).size !== factors.length) return invalid();
      return { userId: user.id, factors };
    },
    async enroll(access) {
      const value = input(z.object({ id: uuid, type: z.literal("totp"), totp: z.object({ secret: z.string().min(16).max(128).regex(/^[A-Z2-7]+$/) }) }),
        await call("/factors", "POST", access, { factor_type: "totp", issuer: "Pellum" }));
      // The setup secret must be displayed once to enroll. Never persist/log it;
      // discard provider SVG/URI/friendly-name fields, including markup and URLs.
      return { id: value.id, secret: value.totp.secret };
    },
    async challenge(access, factorId) {
      const value = input(z.object({ id: uuid, type: z.literal("totp"), expires_at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
        await call(`/factors/${input(uuid, factorId)}/challenge`, "POST", access, {}));
      return { id: value.id, expiresAt: value.expires_at };
    },
    async verify(access, factorId, challengeId, code) {
      return tokens(await call(`/factors/${input(uuid, factorId)}/verify`, "POST", access,
        { challenge_id: input(uuid, challengeId), code: input(z.string().regex(/^\d{6}$/), code) }));
    },
    async remove(access, factorId) {
      const id = input(uuid, factorId);
      const result = input(z.object({ id: uuid }), await call(`/factors/${id}`, "DELETE", access));
      if (result.id !== id) return invalid();
    },
    async recover(email) {
      const redirect = `${config.allowedOrigins[0]}/auth/recovery`;
      await call(`/recover?redirect_to=${encodeURIComponent(redirect)}`, "POST", undefined,
        { email: input(z.string().email().max(320), email) }, true);
    },
    async redeemRecovery(tokenHash) {
      return tokens(await call("/verify", "POST", undefined, { type: "recovery", token_hash: input(z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/), tokenHash) }));
    },
    async updatePassword(access, password) {
      const value = input(z.object({ id: uuid }), await call("/user", "PUT", access, { password: input(z.string().min(1).max(1024), password) }));
      return { userId: value.id };
    },
    async revoke(access) { await call("/logout?scope=global", "POST", access, undefined, true); },
  };
}
