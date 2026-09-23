import { auditAccountSecurity, consumeAccountChallenge, putAccountChallenge, readAccountSecurityAdmission, runAsUser, type Database } from "@autobureau/db";
import { authorizeAccountOperation, type AccountOperationEvidence } from "./account-operation-policy";
import type { AccountAction } from "./account-security";
import type { JwtVerifier } from "./jwt";
import type { AccountSecurityPorts } from "./account-security";
import { ProviderError } from "./provider";
import { enforceRateLimit, MFA_POLICIES, MFA_VERIFY_POLICIES } from "../http/rate-limit";
import { traceIdFrom } from "../observability";

/** Concrete local-testable ports. householdId is a candidate, never authority:
 * every DB entry repeats live owner/fence checks under the signed principal.
 * This does not grant access to auth.sessions or claim global JWT revocation.
 * Mounted only through the explicitly synthetic loopback account adapter; hosted
 * activation remains closed. */
export function createDatabaseAccountSecurityPorts(db: Database, householdId: string, verifier: JwtVerifier): AccountSecurityPorts {
  const check = (action: AccountAction, userId: string, evidence: AccountOperationEvidence, sessionId: string | undefined, factorId?: string) =>
    (current: { requiresMfa: boolean; now: number }) => {
      if (evidence.principal.userId !== userId || evidence.principal.assurance?.sessionId !== sessionId || (factorId !== undefined && evidence.factorId !== factorId)) throw new Error("Account security refused");
      authorizeAccountOperation(action, evidence, current.requiresMfa, current.now);
    };
  return {
    verifyJwt: token => verifier.verify(token),
    async admit(request, principal, action, phase = "begin") {
      if (phase === "begin") {
        const limited = await enforceRateLimit({ db, request, identifier: principal.userId,
          policies: action === "verify" ? MFA_VERIFY_POLICIES : MFA_POLICIES,
          traceId: traceIdFrom(request), route: "account-security" });
        if (limited) throw new ProviderError(limited.status === 429 ? "rate-limited" : "unavailable", "Account security is unavailable");
      }
      return runAsUser(principal.userId, () => readAccountSecurityAdmission(db, householdId, principal.userId));
    },
    challenges: {
      put: (binding, evidence) => runAsUser(binding.userId, () => putAccountChallenge(db, householdId, binding, check("challenge", binding.userId, evidence, binding.sessionId, binding.factorId))),
      consume: (binding, _now, evidence) => runAsUser(binding.userId, () => consumeAccountChallenge(db, householdId, binding, check("verify", binding.userId, evidence, binding.sessionId, binding.factorId))),
    },
    audit: (principal,action,phase,evidence) => runAsUser(principal.userId, () => auditAccountSecurity(db,householdId,principal.userId,action,phase,check(action,principal.userId,evidence,principal.assurance?.sessionId))),
  };
}
