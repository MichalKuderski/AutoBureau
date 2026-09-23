import { z } from "zod";
import type { VerifiedPrincipal } from "./jwt";
import { requireRecentAccountAuth } from "./recent-auth";

const uuid = z.string().uuid();
const factorsSchema = z.object({ userId: uuid, factors: z.array(z.object({
  id: uuid, factor_type: z.literal("totp"), status: z.enum(["verified", "unverified"]),
}).strict()).max(10) }).strict().refine(s => new Set(s.factors.map(f => f.id)).size === s.factors.length);
export type AccountOperation = "list" | "enroll" | "challenge" | "verify" | "remove" | "recovery";
export interface AccountOperationEvidence {
  /** Signature/issuer/audience verified server-side, never decoded browser input. */
  readonly principal: VerifiedPrincipal;
  readonly factors: z.infer<typeof factorsSchema>;
  /** BEGINNING of bounded provider read; slow I/O must not manufacture freshness. */
  readonly checkedAt: number;
  readonly factorId?: string;
}
const refuse = (): never => { throw new Error("Account operation refused"); };

/** Closed, shared controller/transaction policy. Enrollment/step-up are bootstrap
 * exceptions, not authority to export, reveal or remove a required verified factor.
 * Provider state cannot be locked atomically with PostgreSQL; evidence lasts at most
 * 60 seconds and does not establish global access-JWT/session revocation. */
export function authorizeAccountOperation(operation: AccountOperation, e: AccountOperationEvidence,
  requiresMfa: boolean, now: number) {
  if (!["list", "enroll", "challenge", "verify", "remove", "recovery"].includes(operation) ||
      typeof requiresMfa !== "boolean" || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(e.checkedAt) || e.checkedAt < 0 || e.checkedAt > now || now - e.checkedAt > 60) return refuse();
  const p = e.principal, a = p.assurance, state = factorsSchema.parse(e.factors);
  if (!uuid.safeParse(p.userId).success || !a || !uuid.safeParse(a.sessionId).success ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || state.userId !== p.userId ||
      !["aal1", "aal2"].includes(a.level) || a.methods.length === 0 || a.methods.length > 16 ||
      new Set(a.methods.map(m => m.method)).size !== a.methods.length ||
      a.methods.some(m => !Number.isSafeInteger(m.timestamp) || m.timestamp < 0 || m.timestamp > now)) return refuse();
  const verifiedTotp = state.factors.some(f => f.status === "verified");
  const selected = e.factorId ? state.factors.find(f => f.id === e.factorId) : undefined;
  if (["challenge", "verify", "remove"].includes(operation) && !selected) return refuse();
  const recent = () => requireRecentAccountAuth(p, { userId: p.userId, sessionId: a.sessionId,
    checkedAt: e.checkedAt, verifiedTotp }, now);
  if (operation === "enroll" || operation === "remove" ||
      ((operation === "challenge" || operation === "verify") && selected?.status === "unverified")) recent();
  if (operation === "enroll" && state.factors.length >= 10) return refuse();
  if (operation === "remove" && selected?.status === "verified" && requiresMfa) return refuse();
  if (operation === "recovery") {
    if (requiresMfa && !verifiedTotp) return refuse();
    if (verifiedTotp) {
      if (!selected || selected.status !== "verified") return refuse();
      recent();
    } else if (a.level !== "aal1" || !Number.isSafeInteger(p.issuedAt) || p.issuedAt! > now ||
      now - p.issuedAt! > 60 || !a.methods.some(m => m.method === "recovery" || m.method === "otp")) return refuse();
  }
  return { sessionRevocationVerified: false as const };
}

/** Snapshot only projected evidence. Raw access/refresh tokens never enter it. */
export function accountOperationEvidence(principal: VerifiedPrincipal, factors: unknown, checkedAt: number,
  factorId?: string): AccountOperationEvidence {
  const state = factorsSchema.parse(factors);
  const evidence = { principal: structuredClone(principal), factors: state, checkedAt,
    ...(factorId === undefined ? {} : { factorId }) };
  for (const method of evidence.principal.assurance?.methods ?? []) Object.freeze(method);
  Object.freeze(evidence.principal.assurance?.methods);
  Object.freeze(evidence.principal.assurance);
  Object.freeze(evidence.principal);
  for (const factor of state.factors) Object.freeze(factor);
  Object.freeze(state.factors); Object.freeze(state);
  return Object.freeze(evidence);
}
