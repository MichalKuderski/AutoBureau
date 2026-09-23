import { z } from "zod";
import { readAccountSecurityAdmission, runAsUser, runWithSensitiveScope, type Database } from "@autobureau/db";
import type { AccountProvider } from "./account-provider";
import type { JwtVerifier, VerifiedPrincipal } from "./jwt";
import { requireRecentAccountAuth } from "./recent-auth";

import { recentOperations, type RecentOperation } from "./operation-matrix";
export const sensitiveOperations = recentOperations;
export type SensitiveOperation = RecentOperation;
const operationSchema = z.custom<SensitiveOperation>(v => typeof v === "string" && sensitiveOperations.includes(v as SensitiveOperation));
const uuid = z.string().uuid();
const factorsSchema = z.object({ userId: uuid, factors: z.array(z.object({ id: uuid,
  factor_type: z.literal("totp"), status: z.enum(["verified", "unverified"]),
}).strict()).max(10) }).strict().refine(v => new Set(v.factors.map(f => f.id)).size === v.factors.length);
const admissionSchema = z.object({ requiresMfa: z.boolean() }).strict();
const refuse = (): never => { throw new Error("Sensitive operation refused"); };
export interface SensitiveOperationPorts {
  verifyJwt: JwtVerifier["verify"];
  factors: AccountProvider["factors"];
  /** Must read live owner, household deletion fence and MFA requirement under RLS.
   * Called before AND after provider I/O. Never accepts browser policy/evidence. */
  admit(householdId: string, principal: VerifiedPrincipal): Promise<{ requiresMfa: boolean }>;
}

/** Short-lived decision, NOT a transferable capability or proof of session revocation.
 * Each invocation verifies the signed token and refreshes provider state. Domain
 * mutations must still repeat owner/fence checks inside their committing transaction;
 * a preflight cannot lock out a subsequent concurrent deletion or policy change.
 * No route is mounted by creating this foundation. */
export function createSensitiveOperationPolicy(ports: SensitiveOperationPorts, clock = () => Math.floor(Date.now()/1000)) {
  return async (accessToken: string, householdId: string, operation: SensitiveOperation) => {
    if (!uuid.safeParse(householdId).success || !operationSchema.safeParse(operation).success) return refuse();
    const principal = await ports.verifyJwt(accessToken);
    if (!uuid.safeParse(principal.userId).success || !principal.assurance || principal.expiresAt <= clock()) return refuse();
    const before = admissionSchema.parse(await ports.admit(householdId, principal));
    const checkedAt = clock();
    const state = factorsSchema.parse(await ports.factors(accessToken));
    if (state.userId !== principal.userId) return refuse();
    const after = admissionSchema.parse(await ports.admit(householdId, principal));
    const verifiedTotp = state.factors.some(f => f.status === "verified");
    // A missing/revoked factor never downgrades a required household to password.
    // If policy tightened during the provider read, the stricter requirement wins.
    if ((before.requiresMfa || after.requiresMfa) && !verifiedTotp) return refuse();
    const decision = requireRecentAccountAuth(principal, { userId: state.userId,
      sessionId: principal.assurance.sessionId, checkedAt, verifiedTotp }, clock());
    return Object.freeze({ ...decision, userId: principal.userId, householdId,
      sessionId: principal.assurance.sessionId, operation });
  };
}
export function createDatabaseSensitiveOperationPolicy(db: Database, verifier: JwtVerifier, provider: AccountProvider) {
  return createSensitiveOperationPolicy({ verifyJwt: token => verifier.verify(token), factors: token => provider.factors(token),
    admit: (hh, p) => runAsUser(p.userId, () => readAccountSecurityAdmission(db, hh, p.userId)) });
}

/** Local composition for request/domain/file operations. Every Database transaction
 * opened by the task inherits commit-time checks; slow provider/file work is outside
 * those transactions. No Next route or hosted activation is introduced here. */
export function createSensitiveOperationExecutor(ports: SensitiveOperationPorts, clock = () => Math.floor(Date.now()/1000)) {
  return async function execute<T>(accessToken: string, householdId: string, operation: SensitiveOperation, task: () => Promise<T>): Promise<T> {
    let principal: VerifiedPrincipal | undefined;
    let state: z.infer<typeof factorsSchema> | undefined;
    let checkedAt = -1;
    const policy = createSensitiveOperationPolicy({
      verifyJwt: async token => { principal = structuredClone(await ports.verifyJwt(token)); return principal; },
      factors: async token => { checkedAt = clock(); state = factorsSchema.parse(await ports.factors(token)); return state; },
      admit: ports.admit,
    }, clock);
    await policy(accessToken, householdId, operation);
    const p = structuredClone(principal!), factors = structuredClone(state!);
    const verifiedTotp = factors.factors.some(f=>f.status==="verified");
    const check = (current: { requiresMfa: boolean; now: number }) => {
      if(typeof current.requiresMfa!=="boolean" || current.requiresMfa && !verifiedTotp)return refuse();
      requireRecentAccountAuth(p,{userId:factors.userId,sessionId:p.assurance!.sessionId,checkedAt,verifiedTotp},current.now);
    };
    return runAsUser(p.userId, () => runWithSensitiveScope(householdId,p.userId,check,async()=>{
      const result = await task();
      // Refuse release after a slow serialization/provider step, even if no further
      // domain write was needed. Admission still opens its own short transaction.
      const current=await ports.admit(householdId,p);
      check({...current,now:clock()});
      return result;
    }));
  };
}
