import { StripeTestStateSchema, type StripeTestState, UUID_RE } from "@autobureau/contracts";
import { runAsSystem } from "./audit.js";
import { Prisma } from "@prisma/client";
import { assertTestBillingTransaction,billingWorkTable,type TestBillingWorkKind } from "./test-billing-runtime.js";
import type { Database, ScopedClient } from "./scoped.js";
const refuse=():never=>{throw new Error("TEST reconciliation refused");};
const ids=(...values:string[])=>{if(!values.every(v=>UUID_RE.test(v)))refuse();};
async function open(tx:ScopedClient,hh:string){await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;}
async function bindingLock(tx:ScopedClient,id:string){
 const [lock]=await tx.$queryRaw<Array<{held:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||${id},0)) AS held`;
 if(!lock?.held)refuse();
}
type Bound={binding_id:string;account_id:string;customer_id:string;subscription_id:string;object_id:string;state:string;lease_token:string|null;live:boolean;now:number};
async function claim(tx:ScopedClient,hh:string,notice:string,token:string,kind:TestBillingWorkKind="notice"){
 const [r]=await tx.$queryRaw<Bound[]>`SELECT n.binding_id,b.account_id,b.customer_id,b.subscription_id,${kind==="notice"?Prisma.sql`n.object_id`:Prisma.sql`b.subscription_id AS object_id`},n.state,n.lease_token,
 n.lease_until>clock_timestamp() AS live,floor(extract(epoch FROM clock_timestamp()))::double precision AS now
 FROM ${billingWorkTable(kind)} n JOIN stripe_test_bindings b ON b.id=n.binding_id AND b.household_id=n.household_id
 WHERE n.id=${notice}::uuid AND n.household_id=${hh}::uuid AND b.livemode=false
 AND EXISTS(SELECT 1 FROM household_users h WHERE h.household_id=b.household_id AND h.user_id=b.owner_id AND h.role='owner')`;
 if(!r||r.state!=="leased"||r.lease_token!==token||!r.live)return refuse();
 return r;
}
async function prior(tx:ScopedClient,hh:string,b:Bound){
 const [r]=await tx.$queryRaw<Array<{revision:number;state:string;plan:string;paid_through:bigint|null;premium_until:bigint|null}>>`SELECT revision,state,plan,paid_through,premium_until FROM stripe_test_states WHERE binding_id=${b.binding_id}::uuid AND household_id=${hh}::uuid`;
 return {revision:r?.revision??0,previous:r?StripeTestStateSchema.parse({accountId:b.account_id,customerId:b.customer_id,subscriptionId:b.subscription_id,
 state:r.state,plan:r.plan,paidThrough:r.paid_through===null?null:Number(r.paid_through),premiumUntil:r.premium_until===null?null:Number(r.premium_until)}):null};
}
/** Authenticated refetch begins only from a live notice and independent immutable
 * server binding. The returned snapshot carries no payment/session credential.
 * Subsequent I/O must occur after this scoped transaction closes. */
export async function readStripeTestClaim(db:Database,hh:string,notice:string,token:string,kind:TestBillingWorkKind="notice"){
 ids(notice,token);
 return db.withHousehold(hh,async tx=>{
  await assertTestBillingTransaction(tx);await open(tx,hh);const b=await claim(tx,hh,notice,token,kind),p=await prior(tx,hh,b);
  return {...p,now:b.now,noticeObjectId:b.object_id,binding:{accountId:b.account_id,customerId:b.customer_id,subscriptionId:b.subscription_id,livemode:false as const}};
 });
}
/** No cap grant: persist a TEST decision, terminal notice, trigger audit and opaque
 * outbox fact atomically. Lease/token/revision checks occur on the DB clock after
 * all locks. A crash after commit is observed as an already reconciled notice by
 * the next claim; no second side effect is emitted. There is no raw-body persistence.
 * This function is internal worker authority, never a browser-callable operation. */
export async function commitStripeTestState(db:Database,hh:string,notice:string,token:string,expectedRevision:number,input:unknown,kind:TestBillingWorkKind="notice"){
 ids(notice,token);const decision=StripeTestStateSchema.parse(input);
 if(!Number.isInteger(expectedRevision)||expectedRevision<0)return refuse();
 return runAsSystem("Commit authenticated TEST subscription decision",()=>db.withHousehold(hh,async tx=>{
  await assertTestBillingTransaction(tx);await open(tx,hh);
  const before=await claim(tx,hh,notice,token,kind);await bindingLock(tx,before.binding_id);
  await tx.$queryRaw`SELECT id FROM ${billingWorkTable(kind)} WHERE id=${notice}::uuid AND household_id=${hh}::uuid FOR UPDATE`;
  const b=await claim(tx,hh,notice,token,kind),p=await prior(tx,hh,b);
  if(p.revision!==expectedRevision||decision.accountId!==b.account_id||decision.customerId!==b.customer_id||decision.subscriptionId!==b.subscription_id
   ||decision.premiumUntil!==null&&decision.premiumUntil<=b.now)return refuse();
  const rows=await tx.$queryRaw<Array<{id:string;revision:number}>>(p.revision===0?Prisma.sql`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_notice_id,source_intent_id,source_lease_token,state,plan,paid_through,premium_until)
   VALUES(${hh}::uuid,${b.binding_id}::uuid,${b.account_id},${kind==="notice"?notice:null}::uuid,${kind==="intent"?notice:null}::uuid,${token}::uuid,${decision.state},${decision.plan},${decision.paidThrough},${decision.premiumUntil}) RETURNING id,revision`
   :Prisma.sql`UPDATE stripe_test_states SET source_notice_id=${kind==="notice"?notice:null}::uuid,source_intent_id=${kind==="intent"?notice:null}::uuid,source_lease_token=${token}::uuid,
   state=${decision.state},plan=${decision.plan},paid_through=${decision.paidThrough},premium_until=${decision.premiumUntil}
   WHERE binding_id=${b.binding_id}::uuid AND household_id=${hh}::uuid AND revision=${p.revision} RETURNING id,revision`);
  const row=rows[0];if(!row)return refuse();
  if((await tx.$executeRaw`UPDATE ${billingWorkTable(kind)} SET state='reconciled',lease_token=NULL,lease_until=NULL WHERE id=${notice}::uuid AND household_id=${hh}::uuid AND state='leased' AND lease_token=${token}::uuid AND lease_until>clock_timestamp()`)!==1)return refuse();
  await tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${hh}::uuid,'billing.test_state_reconciled','stripe-test-state',${row.id}::uuid,jsonb_build_object('revision',${row.revision}::integer))`;
  return {revision:row.revision,applicationEntitlementActivated:false as const};
 }));
}
/** Clock-bounded diagnostic projection. This is not a gateway cap decision: the
 * reviewed caps, independent billing role, runtime expiry and UI rollout are still
 * activation gates. Expired decisions never report currently eligible, even if no
 * worker runs. No provider IDs or lease capabilities are returned. */
export async function readStripeTestEligibility(db:Database,hh:string){
 return db.withHousehold(hh,async tx=>{await open(tx,hh);
  const [r]=await tx.$queryRaw<Array<{state:StripeTestState["state"];plan:StripeTestState["plan"];revision:number;eligible:boolean}>>`SELECT state,plan,revision,
   eligible FROM billing_test_eligibility WHERE household_id=${hh}::uuid`;
  return r?{...r,applicationEntitlementActivated:false as const}:null;
 });
}
