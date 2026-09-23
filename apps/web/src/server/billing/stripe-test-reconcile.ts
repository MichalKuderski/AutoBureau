import { claimStripeTestNotice, readStripeTestClaim, commitStripeTestState, type Database } from "@autobureau/db";
import { refetchStripeTestState, type TestBillingReadPort } from "./stripe-test-refetch";
import { deriveTestSubscription } from "./stripe-test-state";
import { StripeTestPolicyError, type StripeTestPriceBinding } from "./stripe-test-policy";
/** Explicit bounded local invocation. No scheduler, webhook route, outbound
 * provider mutation, gateway entitlement grant or automatic credential retry.
 * Failed/ambiguous reads leave the lease until expiry; maximum three notice claims.
 * Do not call this on a generic document worker with billing credentials. */
export async function reconcileStripeTestNotice(db:Database,householdId:string,noticeId:string,provider:TestBillingReadPort,catalog:readonly StripeTestPriceBinding[],kind:"notice"|"intent"="notice"){
 try{
  const lease=await claimStripeTestNotice(db,householdId,noticeId,kind);if(!lease)return {kind:"not-claimed" as const};
  const context=await readStripeTestClaim(db,householdId,noticeId,lease.leaseToken,kind);
  const observed=await refetchStripeTestState(provider,context.binding,catalog,context.noticeObjectId);
  const decision=deriveTestSubscription(observed,context.previous,context.now);
  const result=await commitStripeTestState(db,householdId,noticeId,lease.leaseToken,context.revision,decision,kind);
  return {kind:"reconciled" as const,...result};
 }catch{throw new StripeTestPolicyError();}
}
