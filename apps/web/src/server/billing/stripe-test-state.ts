import { z } from "zod";
import { StripeTestStateSchema, type StripeTestState } from "@autobureau/contracts";
import { StripeTestPolicyError } from "./stripe-test-policy";
import type { RefetchedTestState } from "./stripe-test-refetch";
export type ReconciledTestSubscription=StripeTestState;
const time=z.number().int().nonnegative().max(8_640_000_000_000);
const prior=StripeTestStateSchema;
/** Domain proposal for authenticated TEST refetch only. Arrival/event time is not
 * state authority. Seven-day grace is anchored to a previously reconciled paid
 * period, never extended by retries, delayed notices or an unpaid first invoice.
 * No trials are approved. A bounded timestamp is not an entitlement write. */
export function deriveTestSubscription(current:RefetchedTestState,previous:ReconciledTestSubscription|null,now:number):ReconciledTestSubscription {
 if(!Number.isSafeInteger(now)||now<0||current.livemode!==false||current.periodEnd<=current.periodStart)throw new StripeTestPolicyError();
 if(previous){
  const parsed=prior.safeParse(previous);
  if(!parsed.success||previous.accountId!==current.accountId||previous.customerId!==current.customerId||previous.subscriptionId!==current.subscriptionId)throw new StripeTestPolicyError();
 }
 if(!time.safeParse(current.periodStart).success||!time.safeParse(current.periodEnd).success||!["monthly","annual"].includes(current.plan)||typeof current.invoiceSettled!=="boolean")throw new StripeTestPolicyError();
 const result=(state:ReconciledTestSubscription["state"],paidThrough=previous?.paidThrough??null,premiumUntil:number|null=null)=>({accountId:current.accountId,customerId:current.customerId,subscriptionId:current.subscriptionId,state,plan:current.plan,paidThrough,premiumUntil});
 if(current.status==="canceled")return result("canceled");
 if(current.status==="active"&&current.invoiceSettled&&current.periodStart<=now&&current.periodEnd>now){
  const until=current.cancelAt===null?current.periodEnd:Math.min(current.periodEnd,current.cancelAt);
  if(until<=now)return result("inactive");
  return result(current.cancelAtPeriodEnd||current.cancelAt!==null?"canceling":"active",current.periodEnd,until);
 }
 if(current.status==="past_due"){
  const paid=previous?.paidThrough;
  // Only an established paid state can enter grace. Persisted paidThrough is a
  // reviewed state field, never taken from an arbitrary invoice event payload.
  if(paid!==null&&paid!==undefined&&paid+7*86400>now&&previous?.state!=="canceled"&&previous?.state!=="blocked"){
   // An unpaid plan change cannot confer the new plan's authority. Scheduled
   // cancellation is a ceiling, not an opportunity to restart renewal grace.
   const until=Math.min(paid+7*86400,current.cancelAt??Infinity,
    current.cancelAtPeriodEnd||previous?.state==="canceling"?paid:Infinity);
   if(until>now)return {...result("grace",paid,until),plan:previous!.plan};
  }
  return result("past_due");
 }
 return result("blocked");
}
