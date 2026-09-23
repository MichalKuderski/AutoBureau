import { z } from "zod";
import type { AuthConfig } from "./config";
import type { AccountProvider } from "./account-provider";
import type { VerifiedPrincipal } from "./jwt";
import { requireRecentAccountAuth } from "./recent-auth";
import { accountOperationEvidence, authorizeAccountOperation, type AccountOperationEvidence } from "./account-operation-policy";
import { appendCookies, clearedSessionCookies, sessionCookies } from "./session";
import { assertSameSiteRequest } from "../http/csrf";
import { ProviderError } from "./provider";

const uuid = z.string().uuid().transform(v => v.toLowerCase());
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("enroll") }).strict(),
  z.object({ action: z.literal("challenge"), factorId: uuid }).strict(),
  z.object({ action: z.literal("verify"), factorId: uuid, challengeId: uuid, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("remove"), factorId: uuid }).strict(),
]);
export type AccountAction = z.infer<typeof command>["action"];
export type ChallengeBinding = Readonly<{ userId: string; sessionId: string; factorId: string; challengeId: string; expiresAt: number }>;
export interface AccountSecurityPorts {
  verifyJwt(token: string): Promise<VerifiedPrincipal>;
  /** Live owner/account/fence/MFA-policy lookup and shared durable per-account/IP
   * rate limit. Must fail closed. Never return browser-supplied factor/policy state.
   * No DB transaction may remain open across a provider call. */
  admit(request: Request, principal: VerifiedPrincipal, action: AccountAction, phase?: "begin" | "commit"): Promise<{ requiresMfa: boolean }>;
  /** Durable atomic insert and one-use compare/consume, scoped to all binding fields.
   * Local composed tests use a PostgreSQL journal; hosted invocation stays gated. */
  challenges: {
    put(binding: ChallengeBinding, evidence: AccountOperationEvidence): Promise<void>;
    consume(binding: Omit<ChallengeBinding, "expiresAt">, now: number, evidence: AccountOperationEvidence): Promise<boolean>;
  };
  /** Persist before any effect and after acknowledgement, opaque subject/action only.
   * An attempted-but-unacknowledged record requires reconciliation, not replay. */
  audit(principal: VerifiedPrincipal, action: AccountAction, phase: "attempted" | "acknowledged", evidence: AccountOperationEvidence): Promise<void>;
}
const refuse = (): never => { throw new Error("Account security request refused"); };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "cache-control": "no-store, private", "pragma": "no-cache", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
} });

/** Server controller: the synthetic-only local mount composes shared challenge/audit/
 * admission adapters with application-wide household session enforcement. A UI-only
 * second factor is not MFA enforcement. No browser-held provider session is used. */
export function createAccountSecurityController(config: AuthConfig, provider: AccountProvider, ports: AccountSecurityPorts, clock = () => Math.floor(Date.now() / 1000)) {
  return async (request: Request, accessToken: string, value: unknown): Promise<Response> => {
    let discardSession = false;
    try {
      if (request.method !== "POST") return refuse();
      assertSameSiteRequest(request, config);
      const parsed = command.safeParse(value); if (!parsed.success) return refuse();
      const c = parsed.data, principal = await ports.verifyJwt(accessToken);
      const now = clock(), a = principal.assurance;
      if (!Number.isSafeInteger(now) || now < 0 || !a || principal.expiresAt <= now) return refuse();
      const admission = await ports.admit(request, principal, c.action);
      if (!admission || typeof admission.requiresMfa !== "boolean") return refuse();
      const checkedAt = clock();
      const state = await provider.factors(accessToken);
      let evidence = accountOperationEvidence(principal, state, checkedAt, "factorId" in c ? c.factorId : undefined);
      authorizeAccountOperation(c.action, evidence, admission.requiresMfa, clock());
      // Re-read after provider I/O for every action, including inventory/step-up.
      const current = await ports.admit(request, principal, c.action, "commit");
      authorizeAccountOperation(c.action, evidence, admission.requiresMfa || current.requiresMfa, clock());
      if (c.action === "list") return response({ factors: evidence.factors.factors, level: a.level, requiresMfa: current.requiresMfa, lostFactorSelfService: false });
      await ports.audit(principal, c.action, "attempted", evidence);
      // Audit can wait on a lock; it must not extend signed-session/factor freshness.
      authorizeAccountOperation(c.action, evidence, admission.requiresMfa || current.requiresMfa, clock());
      if (c.action === "enroll") {
        const enrolled = await provider.enroll(accessToken);
        await ports.audit(principal, c.action, "acknowledged", evidence);
        return response({ factorId: enrolled.id, setupSecret: enrolled.secret, verified: false });
      }
      if (c.action === "challenge") {
        const issued = await provider.challenge(accessToken, c.factorId), at = clock();
        if (!Number.isSafeInteger(at) || issued.expiresAt <= at || issued.expiresAt > at + 300) return refuse();
        await ports.challenges.put(Object.freeze({ userId: principal.userId, sessionId: a.sessionId, factorId: c.factorId,
          challengeId: issued.id, expiresAt: issued.expiresAt }), evidence);
        await ports.audit(principal, c.action, "acknowledged", evidence);
        return response({ challengeId: issued.id, expiresAt: issued.expiresAt });
      }
      if (c.action === "verify") {
        if (await ports.challenges.consume({ userId: principal.userId, sessionId: a.sessionId, factorId: c.factorId, challengeId: c.challengeId }, clock(), evidence) !== true) return refuse();
        const startedAt = clock(); discardSession = true;
        const tokens = await provider.verify(accessToken, c.factorId, c.challengeId, c.code);
        const elevated = await ports.verifyJwt(tokens.accessToken);
        if (elevated.userId !== principal.userId || elevated.assurance?.sessionId !== a.sessionId || elevated.assurance.level !== "aal2"
          || !elevated.assurance.methods.some(m => m.method === "totp" && m.timestamp >= startedAt - 1 && m.timestamp <= clock())) return refuse();
        const refreshedAt = clock();
        const checked = await provider.factors(tokens.accessToken);
        if (checked.userId !== principal.userId || !checked.factors.some(f => f.id === c.factorId && f.status === "verified")) return refuse();
        requireRecentAccountAuth(elevated, { userId: principal.userId, sessionId: a.sessionId, checkedAt: refreshedAt, verifiedTotp: true }, clock());
        evidence = accountOperationEvidence(elevated, checked, refreshedAt, c.factorId);
        await ports.admit(request, elevated, c.action, "commit"); // owner/fence may have changed during provider I/O
        await ports.audit(elevated, c.action, "acknowledged", evidence);
        requireRecentAccountAuth(elevated, { userId: principal.userId, sessionId: a.sessionId, checkedAt: refreshedAt, verifiedTotp: true }, clock());
        return appendCookies(response({ verified: true }), sessionCookies(config, tokens));
      }
      // Removing a factor does not immediately invalidate signed access tokens.
      // Require a fresh login afterward; do not claim global JWT revocation.
      discardSession = true;
      await provider.remove(accessToken, c.factorId);
      await provider.revoke(accessToken);
      await ports.audit(principal, c.action, "acknowledged", evidence);
      return appendCookies(response({ removed: true, signInRequired: true, accessTokensMayRemainValidUntilExpiry: true }), clearedSessionCookies(config));
    } catch (error) {
      const status = error instanceof ProviderError && error.reason === "unavailable" ? 503
        : error instanceof ProviderError && error.reason === "rate-limited" ? 429 : 403;
      const denied = response({ error: "Account security request could not be completed." }, status);
      return discardSession ? appendCookies(denied, clearedSessionCookies(config)) : denied;
    }
  };
}
