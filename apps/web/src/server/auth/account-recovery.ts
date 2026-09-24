import { z } from "zod";
import type { AuthConfig } from "./config";
import type { AccountProvider } from "./account-provider";
import type { VerifiedPrincipal } from "./jwt";
import { accountOperationEvidence, authorizeAccountOperation, type AccountOperationEvidence } from "./account-operation-policy";
import { ProviderError } from "./provider";
import { assertSameSiteRequest } from "../http/csrf";
import { appendCookies, clearedSessionCookies } from "./session";

const start = z.object({ email: z.string().email().max(320) }).strict();
const finish = z.object({ tokenHash: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/), password: z.string().min(1).max(1024),
  factorId: z.string().uuid().optional(), code: z.string().regex(/^\d{6}$/).optional(),
}).strict().refine(v => !v.factorId || Boolean(v.code));
export interface RecoveryPorts {
  verifyJwt(token: string): Promise<VerifiedPrincipal>;
  /** Shared durable rate limiter BEFORE provider; initiation uses normalized email,
   * completion IP only until trusted identity exists. Never log the request/body. */
  limit(request: Request, email?: string): Promise<boolean>;
  /** Required zxcvbn>=3 and k-anonymity breach policy. Unknown/unavailable refuses.
   * No plaintext password may enter logs or a third-party full-password request. */
  passwordAllowed(password: string): Promise<boolean>;
  /** Live account/owner/fence admission, not provider metadata. Also enforces current
   * identity policy/rate limit after token redemption. No transaction spans I/O. */
  admit(principal: VerifiedPrincipal, phase?: "redeemed" | "commit"): Promise<void>;
  audit(principal: VerifiedPrincipal, phase: "attempted" | "password-acknowledged" | "revocation-acknowledged", evidence: AccountOperationEvidence): Promise<void>;
}
const refuse = (): never => { throw new Error("Recovery refused"); };
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store, private", "pragma": "no-cache", "referrer-policy": "no-referrer" } });

/** Single-request recovery completion; mounted only through the synthetic-loopback gate. Hash redemption is provider-
 * consumed once; recovery never creates an application session or bypasses TOTP.
 * Token-hash email template/landing-page review and actual password-policy/admission
 * adapters are activation gates. No lost-factor reset path exists.
 *
 * This uses the recovery token-hash API and requires a reviewed server-mediated
 * email template. The default implicit-fragment callback is NOT supported. No
 * existing confirmation/magic-link route is widened. */
export function createRecoveryController(config: AuthConfig, provider: AccountProvider, ports: RecoveryPorts, clock = () => Math.floor(Date.now()/1000)) {
  return {
    initiate: createRecoveryInitiator(config, provider, ports),
    async complete(request: Request, input: unknown): Promise<Response> {
      let consumed = false;
      try {
        if (request.method !== "POST") return refuse(); assertSameSiteRequest(request, config);
        const parsed = finish.safeParse(input); if (!parsed.success) return refuse();
        const value = parsed.data;
        if (await ports.limit(request) !== true) return reply({ error: "Try again later." }, 429);
        if (await ports.passwordAllowed(value.password) !== true) return refuse();
        consumed = true; const startedAt = clock();
        let tokens = await provider.redeemRecovery(value.tokenHash);
        let principal = await ports.verifyJwt(tokens.accessToken);
        const now = clock();
        if (!principal.assurance || principal.expiresAt <= now || principal.issuedAt === undefined || principal.issuedAt < startedAt - 1 || principal.issuedAt > now || !Number.isSafeInteger(now)) return refuse();
        await ports.admit(principal, "redeemed");
        const factorReadAt = clock();
        const factors = await provider.factors(tokens.accessToken);
        if (clock() - factorReadAt > 60) return refuse();
        if (factors.userId !== principal.userId) return refuse();
        // A recovery link cannot know the factor ID before its one-use token is redeemed, so a
        // code alone selects the account's SINGLE verified factor. Several verified factors
        // still require an explicit ID; no code, a wrong code or no factor still refuses.
        const verifiedNow = factors.factors.filter(f => f.status === "verified");
        const factorId = value.factorId?.toLowerCase() ?? (verifiedNow.length === 1 ? verifiedNow[0]!.id : undefined);
        if (verifiedNow.length > 0) {
          if (!factorId || !value.code || !verifiedNow.some(f => f.id === factorId)) return refuse();
          const challenge = await provider.challenge(tokens.accessToken, factorId), at = clock();
          if (challenge.expiresAt <= at || challenge.expiresAt > at + 300) return refuse();
          tokens = await provider.verify(tokens.accessToken, factorId, challenge.id, value.code);
          const elevated = await ports.verifyJwt(tokens.accessToken);
          if (elevated.userId !== principal.userId || elevated.assurance?.sessionId !== principal.assurance.sessionId || elevated.assurance.level !== "aal2"
            || elevated.expiresAt <= clock() || !elevated.assurance.methods.some(m => m.method === "totp" && m.timestamp >= at - 1 && m.timestamp <= clock())) return refuse();
          principal = elevated;
        } else if (value.factorId || value.code || principal.assurance.level !== "aal1") return refuse();
        // Re-read after challenge/verification: a removed factor, newly enrolled
        // factor or user mismatch cannot authorize a password change from stale state.
        const checkedAt = clock();
        const currentFactors = await provider.factors(tokens.accessToken);
        if (currentFactors.userId !== principal.userId) return refuse();
        const verified = currentFactors.factors.filter(f => f.status === "verified");
        const usedFactor = verifiedNow.length > 0 ? factorId : undefined;
        if (usedFactor) {
          if (!verified.some(f => f.id === usedFactor)) return refuse();
        } else if (verified.length > 0) return refuse();
        const evidence = accountOperationEvidence(principal, currentFactors, checkedAt, usedFactor);
        authorizeAccountOperation("recovery", evidence, false, clock());
        await ports.admit(principal, "commit");
        await ports.audit(principal, "attempted", evidence);
        authorizeAccountOperation("recovery", evidence, false, clock());
        const updated = await provider.updatePassword(tokens.accessToken, value.password);
        if (updated.userId !== principal.userId) return refuse();
        await ports.audit(principal, "password-acknowledged", evidence);
        await provider.revoke(tokens.accessToken);
        await ports.audit(principal, "revocation-acknowledged", evidence);
        return appendCookies(reply({ passwordChanged: true, signInRequired: true, accessTokensMayRemainValidUntilExpiry: true }), clearedSessionCookies(config));
      } catch (e) {
        const failed = reply({ error: "Recovery request could not be completed. Request a new recovery link before trying again." }, e instanceof ProviderError && e.reason === "unavailable" ? 503 : 403);
        // An ambiguous provider outcome is never retried. Local cookies are cleared
        // without claiming the provider mutation/revocation did or did not commit.
        return consumed ? appendCookies(failed, clearedSessionCookies(config)) : failed;
      }
    },
  };
}

/** Public initiation is account-independent by construction, including its ports. */
export function createRecoveryInitiator(config: AuthConfig, provider: Pick<AccountProvider, "recover">,
  ports: Pick<RecoveryPorts, "limit">) {
  return async (request: Request, input: unknown): Promise<Response> => {
      try {
        if (request.method !== "POST") return refuse(); assertSameSiteRequest(request, config);
        const value = start.safeParse(input); if (!value.success) return refuse();
        if (await ports.limit(request, value.data.email.trim().toLowerCase()) !== true) return reply({ error: "Try again later." }, 429);
        try { await provider.recover(value.data.email); }
        catch (e) {
          // Account-dependent statuses (including downstream email throttling) must
          // not become a membership oracle. Local rate limiting is account-agnostic.
          if (!(e instanceof ProviderError)) throw e;
          if (e.reason === "unavailable") return reply({ error: "Recovery is briefly unavailable." }, 503);
        }
        return reply({ status: "If the address can recover an account, instructions will be sent." }, 202);
      } catch (e) { return reply({ error: "Recovery request could not be completed." }, e instanceof ProviderError && e.reason === "unavailable" ? 503 : 403); }
  };
}
