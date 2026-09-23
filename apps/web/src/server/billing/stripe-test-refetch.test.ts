// @vitest-environment node
import Stripe from "stripe";
import { expect,it,vi } from "vitest";
import { createStripeTestReadPort,refetchStripeTestState,type TestBillingReadPort } from "./stripe-test-refetch";
import { deriveTestSubscription } from "./stripe-test-state";
const now=1790000000,binding={accountId:"acct_Synthetic",customerId:"cus_Synthetic",subscriptionId:"sub_Synthetic",livemode:false};
const catalog=[{plan:"monthly" as const,priceId:"price_Monthly",productId:"prod_Premium"}];
function fixture(){
 const sub={object:"subscription",id:binding.subscriptionId,customer:binding.customerId,livemode:false,status:"active",cancel_at_period_end:false,cancel_at:null as number|null,pause_collection:null,trial_end:null,latest_invoice:"in_Current",items:{has_more:false,data:[{quantity:1,current_period_start:now-86400,current_period_end:now+29*86400,price:{id:"price_Monthly"}}]},metadata:{PRIVATE_CANARY:"untrusted-household"}};
 const price={object:"price",id:"price_Monthly",livemode:false,active:true,type:"recurring",currency:"usd",unit_amount:1200,billing_scheme:"per_unit",recurring:{interval:"month",interval_count:1,usage_type:"licensed"},product:{object:"product",id:"prod_Premium",active:true,livemode:false}};
 const invoice={object:"invoice",id:"in_Current",customer:binding.customerId,livemode:false,currency:"usd",status:"paid",amount_remaining:0,parent:{type:"subscription_details",subscription_details:{subscription:binding.subscriptionId}}};
 const account={object:"account",id:binding.accountId},customer={object:"customer",id:binding.customerId,livemode:false};
 const port:TestBillingReadPort={account:vi.fn(async()=>account),customer:vi.fn(async()=>customer),subscription:vi.fn(async()=>structuredClone(sub)),invoice:vi.fn(async(id)=>({...invoice,id})),price:vi.fn(async()=>price)};
 return{sub,price,invoice,account,customer,port,read:()=>refetchStripeTestState(port,binding,catalog)};
}
it("independently refetches binding and returns only minimal TEST state",async()=>{
 const f=fixture(),state=await f.read();expect(state).toMatchObject({...binding,plan:"monthly",invoiceSettled:true});expect(JSON.stringify(state)).not.toContain("PRIVATE_CANARY");expect(f.port.subscription).toHaveBeenCalledTimes(2);
 expect(deriveTestSubscription(state,null,now)).toEqual({accountId:binding.accountId,customerId:binding.customerId,subscriptionId:binding.subscriptionId,state:"active",plan:"monthly",paidThrough:now+29*86400,premiumUntil:now+29*86400});
});
it.each(["account","customer","subscription","sub-customer","invoice-customer","invoice-subscription","price","product","live-customer","live-subscription","live-invoice","live-price","trial","pause","quantity","pagination","unknown-status","refetch-disagreement"])("refuses %s",async mode=>{
 const f=fixture();
 if(mode==="account")f.account.id="acct_Foreign";if(mode==="customer")f.customer.id="cus_Foreign";if(mode==="subscription")f.sub.id="sub_Foreign";if(mode==="sub-customer")f.sub.customer="cus_Foreign";
 if(mode==="invoice-customer")f.invoice.customer="cus_Foreign";if(mode==="invoice-subscription")f.invoice.parent.subscription_details.subscription="sub_Foreign";
 if(mode==="price")f.price.unit_amount=1201;if(mode==="product")f.price.product.id="prod_Foreign";
 if(mode==="live-customer")f.customer.livemode=true;if(mode==="live-subscription")f.sub.livemode=true;if(mode==="live-invoice")f.invoice.livemode=true;if(mode==="live-price")f.price.livemode=true;
 if(mode==="trial")Object.assign(f.sub,{trial_end:now+100});if(mode==="pause")Object.assign(f.sub,{pause_collection:{behavior:"void"}});
 if(mode==="quantity")f.sub.items.data[0]!.quantity=2;if(mode==="pagination")f.sub.items.has_more=true;if(mode==="unknown-status")f.sub.status="unknown";
 if(mode==="refetch-disagreement")vi.mocked(f.port.subscription).mockResolvedValueOnce(structuredClone(f.sub)).mockResolvedValueOnce({...f.sub,status:"canceled"});
 await expect(f.read()).rejects.toThrow("Test billing evidence could not be verified");
});
it("independently verifies a delayed invoice notice even when current invoice is paid",async()=>{
 const f=fixture();vi.mocked(f.port.invoice).mockImplementation(async id=>({...f.invoice,id,customer:id==="in_Old"?"cus_Foreign":binding.customerId}));
 await expect(refetchStripeTestState(f.port,binding,catalog,"in_Old")).rejects.toThrow();
});
it.each([429,500,503,504])("official SDK fixture refuses %i once without retry",async status=>{
 const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({error:{type:"api_error",message:"PRIVATE_CANARY"}}),{status,headers:{"content-type":"application/json"}}));
 const port=createStripeTestReadPort("sk_test_syntheticfixture",Stripe.createFetchHttpClient(fetcher));
 await expect(port.account()).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("official SDK fixture pins Clover and uses only GET provider reads",async()=>{
 const f=fixture(),calls:Array<{path:string;method:string|undefined;version:string|null}>=[];
 const fetcher:typeof fetch=async(url,init)=>{const u=new URL(String(url));calls.push({path:u.pathname,method:init?.method,version:new Headers(init?.headers).get("stripe-version")});
 const body=u.pathname==="/v1/account"?f.account:u.pathname.includes("/customers/")?f.customer:u.pathname.includes("/subscriptions/")?f.sub:u.pathname.includes("/invoices/")?f.invoice:f.price;
 return new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});};
 expect((await refetchStripeTestState(createStripeTestReadPort("sk_test_syntheticfixture",Stripe.createFetchHttpClient(fetcher)),binding,catalog)).invoiceSettled).toBe(true);
 expect(calls).toHaveLength(7);expect(calls.every(c=>c.method==="GET"&&c.version==="2026-02-25.clover")).toBe(true);
});
it.each(["sk_live_forbidden","rk_live_forbidden","unknown",""])("refuses non-TEST credential class without provider call",key=>expect(()=>createStripeTestReadPort(key)).toThrow());
it("uses refetched state rather than arrival order, including canceling and completed cancellation",async()=>{
 const f=fixture();f.sub.cancel_at_period_end=true;let state=await f.read();const paid=deriveTestSubscription(state,null,now);expect(paid.state).toBe("canceling");
 f.sub.status="canceled";state=await f.read();expect(deriveTestSubscription(state,paid,now)).toMatchObject({state:"canceled",premiumUntil:null});
});
it("seven-day grace cannot be extended by duplicate/delayed failures or grant first-invoice access",async()=>{
 const f=fixture();const paid=deriveTestSubscription(await f.read(),null,now);f.sub.status="past_due";f.invoice.status="open";f.invoice.amount_remaining=1200;
 const state=await f.read(),at=paid.paidThrough!+60,grace=deriveTestSubscription(state,paid,at);
 expect(grace).toMatchObject({state:"grace",premiumUntil:paid.paidThrough!+7*86400});expect(deriveTestSubscription(state,grace,at+86400)).toEqual(grace);
 expect(deriveTestSubscription(state,grace,paid.paidThrough!+7*86400)).toMatchObject({state:"past_due",premiumUntil:null});
 expect(deriveTestSubscription(state,null,at)).toMatchObject({state:"past_due",premiumUntil:null});
});
it.each(["incomplete","incomplete_expired","trialing","paused","unpaid"])("does not grant %s",async status=>{const f=fixture();f.sub.status=status;expect(deriveTestSubscription(await f.read(),null,now)).toMatchObject({state:"blocked",premiumUntil:null});});
it("active without a settled bound invoice cannot grant",async()=>{const f=fixture();f.invoice.amount_remaining=1;expect(deriveTestSubscription(await f.read(),null,now).premiumUntil).toBeNull();});

it("refuses invoice disagreement even when subscription projection remains unchanged",async()=>{
 const f=fixture();vi.mocked(f.port.invoice).mockResolvedValueOnce(structuredClone(f.invoice)).mockResolvedValueOnce({...f.invoice,status:"void"});await expect(f.read()).rejects.toThrow();
});

it.each(["foreign-subscription","infinite-paid-period","unknown-state"])("refuses malformed prior domain state: %s",async mode=>{
 const f=fixture(),current=await f.read(),previous=deriveTestSubscription(current,null,now);
 if(mode==="foreign-subscription")previous.subscriptionId="sub_Foreign";
 if(mode==="infinite-paid-period")previous.paidThrough=Infinity;
 if(mode==="unknown-state")previous.state="forged" as never;
 await expect(async()=>deriveTestSubscription(current,previous,now)).rejects.toThrow();
});

it("failed upgrade keeps the previously paid plan and cancellation bounds grace",async()=>{
 const f=fixture(),current=await f.read(),paid=deriveTestSubscription(current,null,now);
 const failed={...current,status:"past_due" as const,plan:"annual" as const,invoiceSettled:false};
 expect(deriveTestSubscription(failed,paid,paid.paidThrough!+60)).toMatchObject({state:"grace",plan:"monthly"});
 expect(deriveTestSubscription({...failed,cancelAtPeriodEnd:true},paid,paid.paidThrough!+60)).toMatchObject({state:"past_due",premiumUntil:null});
 expect(deriveTestSubscription({...failed,cancelAt:paid.paidThrough!+30},paid,paid.paidThrough!+60)).toMatchObject({state:"past_due",premiumUntil:null});
 expect(deriveTestSubscription(failed,{...paid,state:"canceling"},paid.paidThrough!+60)).toMatchObject({premiumUntil:null});
});
