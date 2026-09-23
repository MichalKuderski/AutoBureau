import { z } from "zod";
import type { VerifiedPrincipal } from "./jwt";

const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const assurance = z.object({
  sessionId: z.string().uuid(),
  level: z.enum(["aal1", "aal2"]),
  methods: z.array(z.object({ method: z.string().min(1).max(32), timestamp: seconds }).strict()).min(1).max(16),
}).strict().refine(v => new Set(v.methods.map(m => m.method)).size === v.methods.length);
export type AccountAssurance = z.infer<typeof assurance>;

/** Call only AFTER signature/issuer/audience verification. Malformed optional
 * claims remove step-up authority without changing ordinary session behavior.
 * Neither token iat nor user-editable metadata establishes recent authentication. */
export function projectAccountAssurance(claims: Record<string, unknown>): { assurance?: AccountAssurance } {
  const parsed = assurance.safeParse({ sessionId: claims.session_id, level: claims.aal, methods: claims.amr });
  return parsed.success ? { assurance: parsed.data } : {};
}

const factorEvidence = z.object({
  userId: z.string().uuid(), sessionId: z.string().uuid(), checkedAt: seconds,
  verifiedTotp: z.boolean(),
}).strict();
export type FactorEvidence = z.infer<typeof factorEvidence>;
export class RecentAuthenticationRequired extends Error {
  constructor() { super("Recent account authentication is required"); }
}

/** Local security policy seam, not a provider/session-revocation check. The caller
 * must obtain fresh factor evidence from a server-side provider read bound to the
 * same verified user/session. Unknown/unavailable evidence refuses. No HTTP route
 * activates this seam yet; browser input must NEVER supply the factor evidence.
 *
 * Fifteen minutes follows the PRD's sensitive reveal re-auth ceiling. Verified MFA
 * requires aal2 AND recent TOTP, including when a fresh password exists. Without
 * MFA, require recent password. Recovery/refresh/link/signup alone never authorize
 * export, deletion or factor removal. Recovery completion needs its own flow. */
export function requireRecentAccountAuth(principal: VerifiedPrincipal, providerFactors: unknown, now: number) {
  const a = assurance.safeParse(principal.assurance), f = factorEvidence.safeParse(providerFactors);
  const refuse = (): never => { throw new RecentAuthenticationRequired(); };
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now || !a.success || !f.success) return refuse();
  if (f.data.userId !== principal.userId || f.data.sessionId !== a.data.sessionId ||
      f.data.checkedAt > now || now - f.data.checkedAt > 60) return refuse();
  if (a.data.methods.some(m => m.timestamp > now)) return refuse();
  const recent = (method: string) => a.data.methods.some(m => m.method === method && now - m.timestamp < 900);
  if (f.data.verifiedTotp) {
    if (a.data.level !== "aal2" || !recent("totp")) return refuse();
  } else if (a.data.level !== "aal1" || !recent("password")) return refuse();
  return { authorized: true as const, expiresAt: Math.min(principal.expiresAt,
    ...a.data.methods.filter(m => m.method === (f.data.verifiedTotp ? "totp" : "password")).map(m => m.timestamp + 900)),
    sessionRevocationVerified: false as const };
}
