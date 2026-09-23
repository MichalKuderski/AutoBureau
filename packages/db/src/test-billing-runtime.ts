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
