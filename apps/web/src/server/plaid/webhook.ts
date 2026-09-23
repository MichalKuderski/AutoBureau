import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { z } from "zod";

const KEY = z.object({ alg: z.literal("ES256"), kty: z.literal("EC"), crv: z.literal("P-256"),
  use: z.literal("sig"), kid: z.string().uuid(), x: z.string().regex(/^[\w-]{43}$/), y: z.string().regex(/^[\w-]{43}$/),
  created_at: z.number().int().nonnegative(), expired_at: z.number().int().nonnegative().nullable() });
const NOTICE = z.object({ webhook_type: z.enum(["ITEM", "TRANSACTIONS", "LIABILITIES"]),
  webhook_code: z.string().regex(/^[A-Z_]{1,80}$/), item_id: z.string().min(1).max(256), environment: z.literal("sandbox") });
export type PlaidNotice = z.infer<typeof NOTICE>;
export class PlaidWebhookError extends Error {
  override name = "PlaidWebhookError";
  constructor() { super("Financial connection webhook could not be verified"); }
}
interface VerificationKeys { getVerificationKey(kid: string): Promise<unknown> }
/** Server-only verification boundary; no HTTP endpoint or provider activation is implied. */
export function createPlaidWebhookVerifier(provider: VerificationKeys, now: () => number = Date.now) {
  const cache = new Map<string, { key: JWK; until: number }>();
  const pending = new Map<string, Promise<JWK>>();
  async function key(kid: string): Promise<JWK> {
    const cached = cache.get(kid);
    if (cached && cached.until > now()) return cached.key;
    if (pending.has(kid)) return pending.get(kid)!;
    // Bound attacker-controlled key-id fan-out; outer HTTP rate limits remain necessary.
    if (pending.size >= 4) throw new PlaidWebhookError();
    const request = (async () => {
      const parsed = KEY.parse(await provider.getVerificationKey(kid));
      const seconds = Math.floor(now() / 1000);
      if (parsed.kid !== kid || parsed.created_at > seconds || parsed.expired_at !== null && parsed.expired_at <= seconds) throw new PlaidWebhookError();
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      const until = Math.min(now() + 60_000, parsed.expired_at === null ? Infinity : parsed.expired_at * 1000);
      cache.set(kid, { key: parsed, until }); return parsed;
    })();
    pending.set(kid, request);
    try { return await request; } finally { pending.delete(kid); }
  }
  return async (rawBody: Uint8Array, header: string | null): Promise<PlaidNotice> => {
    try {
      if (!header || header.length > 8192 || !rawBody.length || rawBody.length > 131072) throw new PlaidWebhookError();
      const h = decodeProtectedHeader(header);
      if (h.alg !== "ES256" || h.typ !== "JWT" || !z.string().uuid().safeParse(h.kid).success || h.jku || h.jwk || h.x5u || h.crit) throw new PlaidWebhookError();
      const k = await importJWK(await key(h.kid!), "ES256");
      const { payload } = await jwtVerify(header, k, { algorithms: ["ES256"], requiredClaims: ["iat", "request_body_sha256"], maxTokenAge: "5 min", currentDate: new Date(now()), clockTolerance: 0 });
      if (!Number.isInteger(payload.iat) || payload.iat! > Math.floor(now() / 1000)
        || typeof payload.request_body_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.request_body_sha256)) throw new PlaidWebhookError();
      const actual = createHash("sha256").update(rawBody).digest();
      if (!timingSafeEqual(actual, Buffer.from(payload.request_body_sha256, "hex"))) throw new PlaidWebhookError();
      // Parse only verified bytes; return only the minimal opaque routing projection.
      return NOTICE.parse(JSON.parse(Buffer.from(rawBody).toString("utf8")));
    } catch { throw new PlaidWebhookError(); } // Never retain provider errors, JWTs or body content.
  };
}
