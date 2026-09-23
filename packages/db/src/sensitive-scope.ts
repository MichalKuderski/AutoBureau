import { AsyncLocalStorage } from "node:async_hooks";
import { UUID_RE } from "@autobureau/contracts";
import { currentActor } from "./audit.js";
import { AccountSecurityRefused, accountSecurityAdmissionInTransaction, householdSessionAdmissionInTransaction, type AccountSecurityCheck } from "./account-security.js";
import type { ScopedClient } from "./scoped.js";

interface Scope { readonly role: "owner"|"member"|"viewer"|undefined; readonly householdId: string; readonly userId: string; readonly check: AccountSecurityCheck; readonly lifetime: { closed: boolean } }
const context = new AsyncLocalStorage<Scope>();
const refuse = (): never => { throw new AccountSecurityRefused(); };

/** Server-authenticated request scope, not a serialized capability. The caller
 * must derive check from verified, immutable session/factor evidence. Nested scopes
 * cannot replace it. All scoped transactions validate before work and after audit
 * flush, before commit using live RLS owner, the existing privacy lock and database time.
 * No provider/network I/O occurs in this guard or in the check callback. */
export function runWithSensitiveScope<T>(householdId: string, userId: string, check: AccountSecurityCheck, fn: () => T): T {
  return scoped(householdId,userId,check,fn);
}
export function runWithHouseholdSessionScope<T>(householdId:string,userId:string,role:"owner"|"member"|"viewer",check:AccountSecurityCheck,fn:()=>T):T {
  if (!["owner","member","viewer"].includes(role)) return refuse();
  return scoped(householdId,userId,check,fn,role);
}
function scoped<T>(householdId:string,userId:string,check:AccountSecurityCheck,fn:()=>T,role?:"owner"|"member"|"viewer"):T {
  if (context.getStore() || !UUID_RE.test(householdId) || !UUID_RE.test(userId) || typeof check !== "function") return refuse();
  const actor=currentActor(); if(actor?.type!=="user" || actor.userId!==userId) return refuse();
  const lifetime={closed:false};
  return context.run(Object.freeze({householdId,userId,check,lifetime,role}),()=>{
    try {
      const result=fn();
      if(result && typeof (result as {then?:unknown}).then==="function") {
        return Promise.resolve(result).finally(()=>{lifetime.closed=true;}) as T;
      }
      lifetime.closed=true;return result;
    }catch(e){lifetime.closed=true;throw e;}
  });
}
export function refuseSensitiveScopeEscape(): void { if(context.getStore()) return refuse(); }
export async function assertSensitiveTransaction(tx: ScopedClient, householdId: string): Promise<void> {
  const scope=context.getStore(); if(!scope)return;
  const actor=currentActor();
  if(scope.lifetime.closed || householdId!==scope.householdId || actor?.type!=="user" || actor.userId!==scope.userId)return refuse();
  const result: unknown = scope.check(await (scope.role ? householdSessionAdmissionInTransaction(tx,householdId,scope.userId,scope.role) : accountSecurityAdmissionInTransaction(tx,householdId,scope.userId)));
  if(result!==undefined){
    if(result instanceof Promise)void result.catch(()=>undefined);
    return refuse();
  }
}
