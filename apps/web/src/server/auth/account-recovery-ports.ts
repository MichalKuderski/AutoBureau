import { auditAccountSecurity, readAccountSecurityAdmission, runAsUser, type Database } from "@autobureau/db";
import type { JwtVerifier } from "./jwt";
import type { RecoveryPorts } from "./account-recovery";
import { ProviderError } from "./provider";
import { authorizeAccountOperation } from "./account-operation-policy";
import { requireRecentAccountAuth } from "./recent-auth";
import { createPasswordPolicy, type PasswordVerdict } from "./password-policy";
import { clientIpFrom, enforceRateLimit, RECOVERY_START_POLICIES, RECOVERY_COMPLETE_POLICIES, RECOVERY_USER_POLICIES, type PolicyName } from "../http/rate-limit";
import { traceIdFrom } from "../observability";

/** Candidate household is never authority. A request-scoped adapter, not a global
 * recovery session. Current owner/fence is read via signed principal under RLS.
 * Public recovery needs a trusted ingress IP; absent IP fails closed, unlike the
 * pre-existing public-signin policy. No secrets are used as rate-limit subjects. */
export function createDatabaseRecoveryPorts(db: Database, householdId: string, request: Request, verifier: JwtVerifier,
  passwordPolicy: (password: string) => Promise<PasswordVerdict> = createPasswordPolicy()): RecoveryPorts {
  async function limit(identifier: string, policies: readonly PolicyName[]) {
    const result = await enforceRateLimit({ db, request, identifier, policies, traceId: traceIdFrom(request), route: "account-recovery" });
    if (result?.status === 503) throw new ProviderError("unavailable", "Recovery is briefly unavailable");
    return result === null;
  }
  return {
    verifyJwt: token => verifier.verify(token),
    ...createDatabaseRecoveryInitiationPorts(db, request),
    async passwordAllowed(password) {
      const verdict = await passwordPolicy(password);
      if (verdict === "unavailable") throw new ProviderError("unavailable", "Recovery is briefly unavailable");
      return verdict === "allowed";
    },
    async admit(principal, phase = "redeemed") {
      if (!principal.assurance || principal.expiresAt <= Math.floor(Date.now()/1000)) throw new Error("Recovery refused");
      if (phase === "redeemed" && !await limit(principal.userId, RECOVERY_USER_POLICIES)) throw new ProviderError("rate-limited", "Recovery refused");
      const admission = await runAsUser(principal.userId, () => readAccountSecurityAdmission(db, householdId, principal.userId));
      if (phase === "commit" && admission.requiresMfa) {
        const now = Math.floor(Date.now()/1000);
        // Controller independently refreshes the exact verified factor before this
        // call. Policy requires signed AAL2/TOTP too; provider recovery alone cannot.
        requireRecentAccountAuth(principal, { userId: principal.userId, sessionId: principal.assurance.sessionId, checkedAt: now, verifiedTotp: true }, now);
      }
    },
    audit: (p, phase, evidence) => runAsUser(p.userId, () => auditAccountSecurity(db, householdId, p.userId, "recovery", phase, current => {
      if (evidence.principal.userId !== p.userId || evidence.principal.assurance?.sessionId !== p.assurance?.sessionId) throw new Error("Recovery refused");
      authorizeAccountOperation("recovery", evidence, current.requiresMfa, current.now);
    })),
  };
}

/** No household or account lookup is available on public initiation. */
export function createDatabaseRecoveryInitiationPorts(db: Database, request: Request): Pick<RecoveryPorts, "limit"> {
  return { async limit(candidate, email) {
    if (candidate !== request || clientIpFrom(request) === null) return false;
    const result = await enforceRateLimit({ db, request, identifier: email ?? "recovery-completion",
      policies: email === undefined ? RECOVERY_COMPLETE_POLICIES : RECOVERY_START_POLICIES,
      traceId: traceIdFrom(request), route: "account-recovery" });
    if (result?.status === 503) throw new ProviderError("unavailable", "Recovery is briefly unavailable");
    return result === null;
  } };
}
