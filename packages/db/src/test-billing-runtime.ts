import { Prisma } from "@prisma/client";
import { createDatabase, type ScopedClient } from "./scoped.js";
export type TestBillingWorkKind="notice"|"intent";
export function billingWorkTable(kind:TestBillingWorkKind){
 if(kind!=="notice"&&kind!=="intent")throw new Error("TEST billing work refused");
 return Prisma.raw(kind==="notice"?"stripe_test_notices":"stripe_test_intents");
}
export async function assertTestBillingTransaction(tx:ScopedClient){
 const [r]=await tx.$queryRaw<Array<{role:string}>>`SELECT current_user AS role`;
 if(r?.role!=="app_billing_test")throw new Error("Dedicated TEST billing authority required");
}
/** Only synthetic loopback invocation is activated. No default/ambient connection,
 * role assumption or provider credential accompanies this factory. SQL column grants
 * and RLS remain the authority even if a caller bypasses this convenience factory. */
export function createLocalTestBillingDatabase(url:string){
 const u=new URL(url);
 if(u.protocol!=="postgresql:"||u.hostname!=="127.0.0.1"||u.username!=="app_billing_test"||!u.pathname.startsWith('/pellum_')||u.search||u.hash||process.env.VERCEL||process.env.AWS_EXECUTION_ENV||process.env.NODE_ENV==="production")throw new Error("Local TEST billing unavailable");
 return createDatabase(url);
}
/** ADR-020 hosted amendment: the dedicated billing runtime's own connection, and only on a
 * hosted production build. The login is app_billing_test (the pooler may suffix it with the
 * project ref); loopback, a different role or any other runtime refuses before connecting.
 * Every billing transaction still asserts current_user itself (assertTestBillingTransaction). */
export function createHostedTestBillingDatabase(url:string,env:Readonly<Record<string,string|undefined>>=process.env){
 let u:URL;try{u=new URL(url);}catch{throw new Error("Hosted TEST billing unavailable");}
 const user=decodeURIComponent(u.username);
 if(env.VERCEL!=="1"||env.NODE_ENV!=="production"||env.BILLING_RUNTIME!=="stripe-test"||u.protocol!=="postgresql:"
  ||!/^app_billing_test(\.[a-z0-9]{20})?$/.test(user)||!u.password||["127.0.0.1","localhost","::1","[::1]"].includes(u.hostname)
  ||u.pathname!=="/postgres"||u.hash)throw new Error("Hosted TEST billing unavailable");
 return createDatabase(url);
}
