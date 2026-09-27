import Stripe from "stripe";
import { z } from "zod";
import { StripeTestBindingSchema, stripeTestId } from "@autobureau/contracts";
import { validateStripeTestPrice, StripeTestPolicyError, type StripeTestPriceBinding } from "./stripe-test-policy.js";

const seconds=z.number().int().nonnegative().max(8_640_000_000_000);
const objectId=(prefix:string)=>z.union([stripeTestId(prefix),z.object({id:stripeTestId(prefix)})]).transform(v=>typeof v==="string"?v:v.id);
const subscription=z.object({object:z.literal("subscription"),id:stripeTestId("sub"),customer:objectId("cus"),livemode:z.literal(false),
 status:z.enum(["incomplete","incomplete_expired","trialing","active","past_due","canceled","unpaid","paused"]),
 cancel_at_period_end:z.boolean(),cancel_at:seconds.nullable(),pause_collection:z.null(),trial_end:z.null(),
 latest_invoice:objectId("in").nullable(),items:z.object({has_more:z.literal(false),data:z.array(z.object({quantity:z.literal(1),
 current_period_start:seconds,current_period_end:seconds,price:z.object({id:stripeTestId("price")})})).length(1)}),
}).transform(v=>({subscriptionId:v.id,customerId:v.customer,status:v.status,cancelAtPeriodEnd:v.cancel_at_period_end,cancelAt:v.cancel_at,
 latestInvoice:v.latest_invoice,periodStart:v.items.data[0]!.current_period_start,periodEnd:v.items.data[0]!.current_period_end,priceId:v.items.data[0]!.price.id}));
const invoice=z.object({object:z.literal("invoice"),id:stripeTestId("in"),customer:objectId("cus"),livemode:z.literal(false),currency:z.literal("usd"),
 status:z.enum(["draft","open","paid","uncollectible","void"]),amount_remaining:z.number().int().nonnegative(),
 parent:z.object({type:z.literal("subscription_details"),subscription_details:z.object({subscription:objectId("sub")})}),
}).transform(v=>({invoiceId:v.id,customerId:v.customer,subscriptionId:v.parent.subscription_details.subscription,status:v.status,amountRemaining:v.amount_remaining}));
export interface TestBillingReadPort {
 account():Promise<unknown>; customer(id:string):Promise<unknown>; subscription(id:string):Promise<unknown>;
 invoice(id:string):Promise<unknown>; price(id:string):Promise<unknown>;
}
/** Official SDK, fixed TEST credentials/API pin, no automatic network retries.
 * Optional HTTP client is a local fixture seam; no environment fallback. SDK
 * TypeScript types describe Dahlia; runtime responses are validated against our
 * explicit Clover projection instead of asserting those types are wire evidence. */
export function createStripeTestReadPort(key:string,httpClient?:Stripe.HttpClient):TestBillingReadPort {
 if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))throw new StripeTestPolicyError();
 const sdk=new Stripe(key,{apiVersion:"2026-02-25.clover" as Stripe.LatestApiVersion,maxNetworkRetries:0,timeout:10000,...(httpClient?{httpClient}:{})});
 return {account:()=>sdk.accounts.retrieve(null),customer:id=>sdk.customers.retrieve(id),subscription:id=>sdk.subscriptions.retrieve(id),
  invoice:id=>sdk.invoices.retrieve(id),price:id=>sdk.prices.retrieve(id,{expand:["product"]})};
}
/** Account/customer/subscription, then price/current invoice (+ notice invoice if
 * distinct), then subscription again. At most 3 parallel phases x 10 seconds, no
 * DB transaction across I/O. Final projection disagreement refuses; provider
 * reads are still not an atomic Stripe snapshot. No webhook metadata authority. */
export async function refetchStripeTestState(port:TestBillingReadPort,binding:unknown,catalog:readonly StripeTestPriceBinding[],noticeObjectId?:string){
 try{
  const b=StripeTestBindingSchema.parse(binding);
  const [rawAccount,rawCustomer,rawSubscription]=await Promise.all([port.account(),port.customer(b.customerId),port.subscription(b.subscriptionId)]);
  const a=z.object({object:z.literal("account"),id:stripeTestId("acct")}).parse(rawAccount);
  const c=z.object({object:z.literal("customer"),id:stripeTestId("cus"),livemode:z.literal(false),deleted:z.literal(false).optional()}).parse(rawCustomer);
  const s=subscription.parse(rawSubscription);
  if(a.id!==b.accountId||c.id!==b.customerId||s.customerId!==b.customerId||s.subscriptionId!==b.subscriptionId||s.periodEnd<=s.periodStart)throw new StripeTestPolicyError();
  if(noticeObjectId && noticeObjectId!==s.subscriptionId && !stripeTestId("in").safeParse(noticeObjectId).success)throw new StripeTestPolicyError();
  const matches=catalog.filter(p=>p.priceId===s.priceId);if(matches.length!==1)throw new StripeTestPolicyError();
  const noticeInvoice=noticeObjectId?.startsWith("in_")&&noticeObjectId!==s.latestInvoice?noticeObjectId:undefined;
  const [rawPrice,rawInvoice,rawNotice]=await Promise.all([port.price(s.priceId),s.latestInvoice?port.invoice(s.latestInvoice):null,noticeInvoice?port.invoice(noticeInvoice):null]);
  const price=validateStripeTestPrice(rawPrice,matches[0]!);
  const product=z.object({product:z.object({object:z.literal("product"),id:stripeTestId("prod"),active:z.literal(true),livemode:z.literal(false)})}).parse(rawPrice).product;
  if(product.id!==price.productId)throw new StripeTestPolicyError();
  const current=rawInvoice===null?null:invoice.parse(rawInvoice),noticed=rawNotice===null?null:invoice.parse(rawNotice);
  for(const i of [current,noticed])if(i&&(i.customerId!==b.customerId||i.subscriptionId!==b.subscriptionId))throw new StripeTestPolicyError();
  if(current?.invoiceId!==s.latestInvoice && s.latestInvoice!==null || noticed && noticed.invoiceId!==noticeInvoice)throw new StripeTestPolicyError();
  const [lastSubscription,lastInvoice]=await Promise.all([port.subscription(b.subscriptionId),s.latestInvoice?port.invoice(s.latestInvoice):null]);
  const final=subscription.parse(lastSubscription);
  if(JSON.stringify(lastInvoice===null?null:invoice.parse(lastInvoice))!==JSON.stringify(current))throw new StripeTestPolicyError();
  if(JSON.stringify(final)!==JSON.stringify(s))throw new StripeTestPolicyError();
  return Object.freeze({...b,...s,plan:price.plan,invoiceStatus:current?.status??null,invoiceSettled:current?.status==="paid"&&current.amountRemaining===0});
 }catch{throw new StripeTestPolicyError();}
}
export type RefetchedTestState=Awaited<ReturnType<typeof refetchStripeTestState>>;
