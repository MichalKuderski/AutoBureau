import { assertTestBillingTransaction, billingWorkTable, type TestBillingWorkKind } from "./test-billing-runtime.js";
import { randomUUID } from "node:crypto";
import { StripeTestBindingSchema as Binding, StripeTestNoticeSchema as Notice, stripeTestId as id, UUID_RE } from "@autobureau/contracts";
import type { Database, ScopedClient } from "./scoped.js";
import { currentActor, runAsSystem } from "./audit.js";

const refuse = (): never => { throw new Error("Test billing journal refused"); };
async function openHousehold(tx: ScopedClient, hh: string) { await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`; }

/** Local immutable server-owned binding. The future caller must authenticate the
 * TEST account/customer/subscription with the provider outside this transaction.
 * Metadata, browser IDs and checkout URLs are NOT ownership evidence. There is no
 * route, anonymous resolver, replacement binding, or production adapter. */
export async function bindStripeTestSubscription(db: Database, householdId: string, input: unknown) {
 const p=Binding.safeParse(input);const actor=currentActor();if(!p.success||actor?.type!=="user")return refuse();
 return db.withHousehold(householdId,async tx=>{
  await openHousehold(tx,householdId);
  if(!await tx.householdUser.findFirst({where:{householdId,userId:actor.userId,role:"owner"}}))return refuse();
  const v=p.data;
  await tx.$executeRaw`INSERT INTO stripe_test_bindings(household_id,owner_id,account_id,customer_id,subscription_id)
   VALUES(${householdId}::uuid,${actor.userId}::uuid,${v.accountId},${v.customerId},${v.subscriptionId}) ON CONFLICT(household_id) DO NOTHING`;
  const [row]=await tx.$queryRaw<Array<{id:string;owner_id:string;account_id:string;customer_id:string;subscription_id:string}>>`SELECT id,owner_id,account_id,customer_id,subscription_id FROM stripe_test_bindings WHERE household_id=${householdId}::uuid`;
  if(!row||row.owner_id!==actor.userId||row.account_id!==v.accountId||row.customer_id!==v.customerId||row.subscription_id!==v.subscriptionId)return refuse();
  return row.id;
 });
}

/** Call only AFTER official raw-body verification using this account's pinned
 * signing secret. Closed projection persists no raw body, payment data or metadata.
 * Candidate household/binding comes from trusted server context, not Stripe metadata.
 * Pending is durable reconciliation intent; no outgoing side effect exists yet. */
export async function acceptStripeTestNotice(db: Database, householdId:string,bindingId:string,accountId:string,input:unknown){
 const p=Notice.safeParse(input);if(!p.success||!UUID_RE.test(bindingId)||!id("acct").safeParse(accountId).success)return refuse();
 const v=p.data;if(v.eventType.startsWith("invoice.")!==v.objectId.startsWith("in_"))return refuse();
 return runAsSystem("Persist verified TEST billing reconciliation intent",()=>db.withHousehold(householdId,async tx=>{
  await assertTestBillingTransaction(tx);await openHousehold(tx,householdId);
  const [binding]=await tx.$queryRaw<Array<{subscription_id:string}>>`SELECT subscription_id FROM stripe_test_bindings WHERE id=${bindingId}::uuid AND household_id=${householdId}::uuid AND account_id=${accountId} AND livemode=false`;
  if(!binding||v.objectId.startsWith("sub_")&&v.objectId!==binding.subscription_id)return refuse();
  await tx.$executeRaw`INSERT INTO stripe_test_notices(household_id,binding_id,account_id,event_id,event_type,object_id,provider_created)
   VALUES(${householdId}::uuid,${bindingId}::uuid,${accountId},${v.eventId},${v.eventType},${v.objectId},${v.created}) ON CONFLICT(account_id,event_id) DO NOTHING`;
  const [row]=await tx.$queryRaw<Array<{id:string;binding_id:string;event_type:string;object_id:string;provider_created:bigint}>>`SELECT id,binding_id,event_type,object_id,provider_created FROM stripe_test_notices WHERE household_id=${householdId}::uuid AND account_id=${accountId} AND event_id=${v.eventId}`;
  if(!row||row.binding_id!==bindingId||row.event_type!==v.eventType||row.object_id!==v.objectId||row.provider_created!==BigInt(v.created))return refuse();
  return row.id;
 }));
}

/** Bounded local reconciliation claim. 60s = three 10s parallel read phases, 2x(2s pool+
 * 5s transaction), 10s completion margin, rounded up. Maximum three claims; no
 * lease extension. Nothing marks payment/domain effects complete in this increment.
 * Network calls must run AFTER this transaction, with stale-token commit fencing. */
export async function claimStripeTestNotice(db:Database,householdId:string,noticeId:string,kind:TestBillingWorkKind="notice"){
 if(!UUID_RE.test(noticeId))return refuse();
 return runAsSystem("Claim bounded TEST billing reconciliation intent",()=>db.withHousehold(householdId,async tx=>{
  await assertTestBillingTransaction(tx);await openHousehold(tx,householdId);
  const [candidate]=await tx.$queryRaw<Array<{binding_id:string}>>`SELECT binding_id FROM ${billingWorkTable(kind)} WHERE id=${noticeId}::uuid AND household_id=${householdId}::uuid`;
  if(!candidate)return null;
  // Never hold a transaction or advisory lock across provider I/O. The durable
  // live lease excludes all other notices for this binding after commit.
  const [lock]=await tx.$queryRaw<Array<{held:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtextextended('pellum-test-billing/'||${candidate.binding_id},0)) AS held`;
  if(!lock?.held)return null;
  const [busy]=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM stripe_test_notices WHERE binding_id=${candidate.binding_id}::uuid AND household_id=${householdId}::uuid AND id<>${noticeId}::uuid AND state='leased' AND lease_until>clock_timestamp() UNION ALL SELECT id FROM stripe_test_intents WHERE binding_id=${candidate.binding_id}::uuid AND household_id=${householdId}::uuid AND id<>${noticeId}::uuid AND state='leased' AND lease_until>clock_timestamp()`;
  if(busy)return null;
  const [r]=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM ${billingWorkTable(kind)} WHERE id=${noticeId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
  if(!r)return null;
  const token=randomUUID();
  const rows=await tx.$queryRaw<Array<{id:string;lease_until:Date;attempts:number}>>`UPDATE ${billingWorkTable(kind)} SET state='leased',attempts=attempts+1,lease_token=${token}::uuid,lease_until=clock_timestamp()+interval '60 seconds'
   WHERE id=${r.id}::uuid AND attempts<3 AND (state='pending' OR (state='leased' AND lease_until<=clock_timestamp())) RETURNING id,lease_until,attempts`;
  return rows[0]?{id:rows[0].id,leaseToken:token,leaseUntil:rows[0].lease_until,attempt:rows[0].attempts}:null;
 }));
}
/** Poison/unsupported snapshots refuse, never grant. Expired/stale lease owners
 * cannot finalize even a refusal. Exhausted claims remain visible for reconciliation;
 * no auto-replay, deletion or journal-retirement capability is added. */
export async function refuseStripeTestNotice(db:Database,householdId:string,noticeId:string,leaseToken:string,kind:TestBillingWorkKind="notice"){
 if(![noticeId,leaseToken].every(v=>UUID_RE.test(v)))return refuse();
 return runAsSystem("Record refused TEST billing reconciliation evidence",()=>db.withHousehold(householdId,async tx=>{
  await assertTestBillingTransaction(tx);await openHousehold(tx,householdId);
  // Acquire lock first; evaluate lease on the DB clock after waiting.
  await tx.$queryRaw`SELECT id FROM ${billingWorkTable(kind)} WHERE id=${noticeId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
  return (await tx.$executeRaw`UPDATE ${billingWorkTable(kind)} SET state='refused',lease_token=NULL,lease_until=NULL WHERE id=${noticeId}::uuid AND household_id=${householdId}::uuid AND state='leased' AND lease_token=${leaseToken}::uuid AND lease_until>clock_timestamp()` )===1;
 }));
}

export async function requestStripeTestReconciliation(db:Database,householdId:string,bindingId:string,requestKey:string,reason:"missed-webhook"|"scheduled-recheck"|"operator-reconcile"|"checkout-return"){
 if(![bindingId,requestKey].every(v=>UUID_RE.test(v))||!["missed-webhook","scheduled-recheck","operator-reconcile","checkout-return"].includes(reason))return refuse();
 return runAsSystem("Persist internal TEST reconciliation intent",()=>db.withHousehold(householdId,async tx=>{
  await assertTestBillingTransaction(tx);await openHousehold(tx,householdId);
  const [b]=await tx.$queryRaw<Array<{account_id:string}>>`SELECT account_id FROM stripe_test_bindings WHERE household_id=${householdId}::uuid AND id=${bindingId}::uuid AND livemode=false`;
  if(!b)return refuse();
  await tx.$executeRaw`INSERT INTO stripe_test_intents(household_id,binding_id,account_id,request_key,reason) VALUES(${householdId}::uuid,${bindingId}::uuid,${b.account_id},${requestKey}::uuid,${reason}) ON CONFLICT(binding_id,request_key) DO NOTHING`;
  const [r]=await tx.$queryRaw<Array<{id:string;reason:string}>>`SELECT id,reason FROM stripe_test_intents WHERE household_id=${householdId}::uuid AND binding_id=${bindingId}::uuid AND request_key=${requestKey}::uuid`;
  if(!r||r.reason!==reason)return refuse();return r.id;
 }));
}
