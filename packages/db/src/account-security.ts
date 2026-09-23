import { UUID_RE } from "@autobureau/contracts";
import { currentActor, recordAudit } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";

export class AccountSecurityRefused extends Error { constructor() { super("Account security refused"); } }
const refuse = (): never => { throw new AccountSecurityRefused(); };
async function member(tx: ScopedClient, householdId: string, userId: string, role: "owner"|"member"|"viewer") {
  const actor = currentActor(); if (actor?.type !== "user" || actor.userId !== userId) return refuse();
  // Acquire the EXISTING exclusive privacy lock before reading owner/policy.
  // Every runtime household write takes this same lock; no new advisory protocol.
  try { await tx.$executeRaw`SELECT app.assert_household_open(${householdId}::uuid)`; }
  catch(e) {
    // SQLSTATE from the fixed privacy gate only; never parse an arbitrary message.
    if(e && typeof e==="object" && "code" in e && e.code==="P2010" && "meta" in e &&
      e.meta && typeof e.meta==="object" && "code" in e.meta && e.meta.code==="55000")return refuse();
    throw e;
  }
  const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${userId}::uuid AND status='active' FOR SHARE`;
  if (active.length !== 1) return refuse();
  if (!await tx.householdUser.findFirst({ where: { householdId, userId, role }, select: { userId: true } })) return refuse();
}
export interface AccountChallenge { userId: string; sessionId: string; factorId: string; challengeId: string; expiresAt: number }
function checked(hh: string, b: Omit<AccountChallenge,"expiresAt">) {
  if (![hh,b.userId,b.sessionId,b.factorId,b.challengeId].every(v => typeof v === "string" && UUID_RE.test(v))) return refuse();
}
export interface AccountSecurityAdmission { requiresMfa: boolean; now: number }
export type AccountSecurityCheck = (admission: AccountSecurityAdmission) => void;
export async function accountSecurityAdmissionInTransaction(tx: ScopedClient, householdId: string, userId: string) {
  return householdSessionAdmissionInTransaction(tx, householdId, userId, "owner");
}
export async function householdSessionAdmissionInTransaction(tx: ScopedClient, householdId: string, userId: string, role: "owner"|"member"|"viewer") {
  if (!["owner","member","viewer"].includes(role)) return refuse();
  await member(tx, householdId, userId, role);
  const [r] = await tx.$queryRaw<Array<{ requires_mfa: boolean; now: Date }>>`SELECT
    (EXISTS(SELECT 1 FROM item_secrets s JOIN items i ON i.id=s.item_id WHERE i.household_id=${householdId}::uuid)
    OR (SELECT count(*) FROM household_users WHERE household_id=${householdId}::uuid)>1) AS requires_mfa,
    clock_timestamp() AS now`;
  if (!r) return refuse();
  return { requiresMfa:r.requires_mfa, now:Math.floor(r.now.getTime()/1000) };
}
export async function readAccountSecurityAdmission(db: Database, householdId: string, userId: string) {
  if (![householdId,userId].every(v=>UUID_RE.test(v))) return refuse();
  return db.withHousehold(householdId, async tx => {
    const current = await accountSecurityAdmissionInTransaction(tx, householdId, userId);
    return { requiresMfa: current.requiresMfa };
  });
}
export async function putAccountChallenge(db: Database, householdId: string, binding: AccountChallenge, check?: AccountSecurityCheck) {
  checked(householdId,binding); if(!Number.isSafeInteger(binding.expiresAt)||binding.expiresAt<0||binding.expiresAt>8_640_000_000_000)return refuse();
  return db.withHousehold(householdId, async tx => {
    const current = await accountSecurityAdmissionInTransaction(tx,householdId,binding.userId);
    check?.(current);
    await tx.$executeRaw`INSERT INTO account_security_challenges(household_id,user_id,session_id,factor_id,challenge_id,expires_at)
      VALUES(${householdId}::uuid,${binding.userId}::uuid,${binding.sessionId}::uuid,${binding.factorId}::uuid,${binding.challengeId}::uuid,${new Date(binding.expiresAt*1000)})`;
  });
}
export async function consumeAccountChallenge(db: Database, householdId: string, binding: Omit<AccountChallenge,"expiresAt">, check?: AccountSecurityCheck) {
  checked(householdId,binding);
  return db.withHousehold(householdId, async tx => {
    const current = await accountSecurityAdmissionInTransaction(tx,householdId,binding.userId);
    check?.(current);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM account_security_challenges
      WHERE household_id=${householdId}::uuid AND user_id=${binding.userId}::uuid AND session_id=${binding.sessionId}::uuid
      AND factor_id=${binding.factorId}::uuid AND challenge_id=${binding.challengeId}::uuid FOR UPDATE`;
    if(rows.length!==1)return false;
    check?.(await accountSecurityAdmissionInTransaction(tx,householdId,binding.userId));
    // DB clock AFTER lock acquisition is authoritative. A waiting consumer cannot
    // extend validity with its earlier application timestamp. Consumption commits
    // before provider I/O; crash/ambiguous response requires a fresh challenge.
    const changed = await tx.$executeRaw`UPDATE account_security_challenges SET consumed_at=clock_timestamp()
      WHERE id=${rows[0]!.id}::uuid AND consumed_at IS NULL AND expires_at>clock_timestamp()`;
    return changed===1;
  });
}
export async function auditAccountSecurity(db: Database, householdId: string, userId: string,
  operation: "list"|"enroll"|"challenge"|"verify"|"remove"|"recovery",
  phase: "attempted"|"acknowledged"|"password-acknowledged"|"revocation-acknowledged", check?: AccountSecurityCheck) {
  if(!["list","enroll","challenge","verify","remove","recovery"].includes(operation)||!["attempted","acknowledged","password-acknowledged","revocation-acknowledged"].includes(phase))return refuse();
  return db.withHousehold(householdId,async tx=>{
    const current = await accountSecurityAdmissionInTransaction(tx,householdId,userId);
    check?.(current);
    await recordAudit(tx, phase==="attempted"?"auth.account_security_attempted":"auth.account_security_acknowledged", { type:`${operation}:${phase}`,id:userId });
  });
}

/** Revalidates the exact phase-one membership without widening owner-only account APIs. */
export async function readHouseholdSessionAdmission(db: Database, householdId: string, userId: string, role: "owner"|"member"|"viewer") {
  if (![householdId,userId].every(v=>UUID_RE.test(v))) return refuse();
  return db.withHousehold(householdId, tx=>householdSessionAdmissionInTransaction(tx,householdId,userId,role));
}
