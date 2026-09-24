import { z } from "zod";
import { AccountSecurityRefused, readHouseholdSessionAdmission, runAsUser, runWithHouseholdSessionScope, type Database } from "@autobureau/db";
import type { RequestContext } from "./context";
import type { VerifiedPrincipal } from "./jwt";
import type { AccountProvider } from "./account-provider";
import { requireRecentAccountAuth } from "./recent-auth";
import type { Capability } from "./policy";

const factors = z.object({ userId:z.string().uuid(), factors:z.array(z.object({id:z.string().uuid(),
  factor_type:z.literal("totp"),status:z.enum(["verified","unverified"])}).strict()).max(10) }).strict()
  .refine(v=>new Set(v.factors.map(f=>f.id)).size===v.factors.length);
const refuse=():never=>{throw new AccountSecurityRefused();};
/** Every existing capability has an explicit policy. New capabilities fail closed.
 * Ordinary access is session-lived; export/delete/reveal retain 15-minute re-auth.
 * MFA enrollment/challenge/recovery are separate bootstrap boundaries, never exempt
 * ordinary reads or mutations. No browser input chooses this policy. */
export const CAPABILITY_SESSION_POLICY = {
  "member-session":"session", "registry.read":"session", "document.upload":"session",
  "document.review":"session", "item.write":"session", "obligation.write":"session",
  "member.manage":"session", "settings.manage":"session", "secret.reveal":"recent",
  "household.delete":"recent", "household.export":"recent", "financial.read":"session", "financial.manage":"recent",
  "document.resolve":"session",
} as const satisfies Record<Capability|"member-session","session"|"recent">;

export async function withHouseholdSession<T>(db:Database,ctx:RequestContext,principal:VerifiedPrincipal,
  token:string,provider:Pick<AccountProvider,"factors">,capability:Capability|undefined,task:()=>Promise<T>,
  clock=()=>Math.floor(Date.now()/1000)):Promise<T> {
  const mode=CAPABILITY_SESSION_POLICY[capability ?? "member-session"];
  const p=structuredClone(principal), a=p.assurance;
  if(!mode || p.userId!==ctx.userId || !a || !z.string().uuid().safeParse(a.sessionId).success)return refuse();
  const admission=()=>readHouseholdSessionAdmission(db,ctx.householdId,ctx.userId,ctx.role);
  return runAsUser(ctx.userId,async()=>{
    const before=await admission();
    if(p.expiresAt<=before.now)return refuse();
    const checkedAt=clock();
    const state=factors.parse(await provider.factors(token));
    if(state.userId!==p.userId)return refuse();
    const verifiedTotp=state.factors.some(f=>f.status==="verified");
    const check=(current:{requiresMfa:boolean;now:number})=>{
      const now=current.now;
      if(!Number.isSafeInteger(now)||now<checkedAt||now-checkedAt>60||p.expiresAt<=now||
        !["aal1","aal2"].includes(a.level)||a.methods.length===0||a.methods.some(m=>!Number.isSafeInteger(m.timestamp)||m.timestamp<0||m.timestamp>now))return refuse();
      if(before.requiresMfa||current.requiresMfa||verifiedTotp){
        if(!verifiedTotp||a.level!=="aal2"||!a.methods.some(m=>m.method==="totp"))return refuse();
      } else if(a.level!=="aal1")return refuse();
      if(mode==="recent")requireRecentAccountAuth(p,{userId:p.userId,sessionId:a.sessionId,checkedAt,verifiedTotp},now);
    };
    check(await admission());
    return runWithHouseholdSessionScope(ctx.householdId,ctx.userId,ctx.role,check,async()=>{
      const result=await task();
      check(await admission()); // no serialized body/capability escapes after policy drift
      return result;
    });
  });
}
