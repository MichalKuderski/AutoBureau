import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,runAsUser,bindStripeTestSubscription,acceptStripeTestNotice,claimStripeTestNotice,readStripeTestClaim,commitStripeTestState,readStripeTestEligibility,requestOwnerExport,readOwnerExportSnapshot,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "./test/database.js";
import { reconcileStripeTestNotice } from "./stripe-test-reconcile.js";
import { refetchStripeTestState,type TestBillingReadPort } from "./stripe-test-refetch.js";
import { deriveTestSubscription } from "./stripe-test-state.js";
let admin:PrismaClient,db:Database,worker:Database;const users:string[]=[],households:string[]=[];
const catalog=[{plan:"monthly" as const,priceId:"price_Synthetic",productId:"prod_Synthetic"}];
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());await admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_reconcile_only'");const u=new URL(APP_URL());u.username="app_billing_test";u.password="stripe_reconcile_only";worker=createDatabase(u.toString());},120000);
afterAll(async()=>{if(admin){const where={householdId:{in:households}};await admin.stripeTestState.deleteMany({where});await admin.stripeTestNotice.deleteMany({where});await admin.stripeTestIntent.deleteMany({where});await admin.stripeTestRoute.deleteMany({where});await admin.stripeTestCheckout.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});await admin.householdDeletion.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:users}}});await admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");}await admin?.$disconnect();await db?.disconnect();await worker?.disconnect();});
async function fixture(){
 const owner=randomUUID(),hh=randomUUID(),suffix=randomUUID().replaceAll("-","");users.push(owner);households.push(hh);
 await admin.user.create({data:{id:owner,email:`${owner}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC TEST reconciliation",createdBy:owner}});await admin.householdUser.create({data:{householdId:hh,userId:owner,role:"owner"}});
 const b={accountId:"acct_Synthetic",customerId:`cus_${suffix}`,subscriptionId:`sub_${suffix}`,livemode:false as const};
 const binding=await runAsUser(owner,()=>bindStripeTestSubscription(db,hh,b));const now=Math.floor(Date.now()/1000);
 const sub={object:"subscription",id:b.subscriptionId,customer:b.customerId,livemode:false,status:"active",cancel_at_period_end:false,cancel_at:null,pause_collection:null,trial_end:null,latest_invoice:`in_${suffix}`,items:{has_more:false,data:[{quantity:1,current_period_start:now-86400,current_period_end:now+29*86400,price:{id:catalog[0]!.priceId}}]}};
 const invoice={object:"invoice",id:sub.latest_invoice,customer:b.customerId,livemode:false,currency:"usd",status:"paid",amount_remaining:0,parent:{type:"subscription_details",subscription_details:{subscription:b.subscriptionId}}};
 const port:TestBillingReadPort={account:vi.fn(async()=>({object:"account",id:b.accountId})),customer:vi.fn(async()=>({object:"customer",id:b.customerId,livemode:false})),subscription:vi.fn(async()=>structuredClone(sub)),invoice:vi.fn(async()=>structuredClone(invoice)),price:vi.fn(async()=>({object:"price",id:catalog[0]!.priceId,livemode:false,active:true,type:"recurring",currency:"usd",unit_amount:1200,billing_scheme:"per_unit",recurring:{interval:"month",interval_count:1,usage_type:"licensed"},product:{object:"product",id:catalog[0]!.productId,active:true,livemode:false}}))};
 const notice=()=>acceptStripeTestNotice(worker,hh,binding,b.accountId,{eventId:`evt_${randomUUID().replaceAll("-","")}`,eventType:"customer.subscription.updated",objectId:b.subscriptionId,created:now});
 const reconcile=(id:string)=>reconcileStripeTestNotice(worker,hh,id,port,catalog);
 return{owner,hh,b,binding,now,sub,invoice,port,notice,reconcile};
}
async function proposal(f:Awaited<ReturnType<typeof fixture>>,id:string){
 const lease=(await claimStripeTestNotice(worker,f.hh,id))!,context=await readStripeTestClaim(worker,f.hh,id,lease.leaseToken);
 const state=deriveTestSubscription(await refetchStripeTestState(f.port,context.binding,catalog,context.noticeObjectId),context.previous,context.now);
 return{lease,context,state,commit:(revision=context.revision)=>commitStripeTestState(worker,f.hh,id,lease.leaseToken,revision,state)};
}
async function counts(hh:string){return worker.withHousehold(hh,async tx=>({states:await tx.stripeTestState.count(),events:await tx.outboxEvent.count({where:{eventType:"billing.test_state_reconciled"}}),audits:await tx.auditLog.count({where:{action:{in:["stripe_test_states.insert","stripe_test_states.update"]}}})}));}
it("commits durable decision, terminal notice, audit and opaque outbox together without activating caps",async()=>{
 const f=await fixture(),id=await f.notice();expect(await f.reconcile(id)).toEqual({kind:"reconciled",revision:1,applicationEntitlementActivated:false});
 expect(await counts(f.hh)).toEqual({states:1,events:1,audits:1});expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({state:"active",eligible:true,applicationEntitlementActivated:false});
 expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.findUnique({where:{id}}))).toMatchObject({state:"reconciled",leaseToken:null});
 expect(await db.withHousehold(f.hh,tx=>tx.entitlement.count())).toBe(0);
 expect(await worker.withHousehold(f.hh,tx=>tx.outboxEvent.findFirst({where:{eventType:"billing.test_state_reconciled"},select:{payload:true}}))).toMatchObject({payload:{revision:1}});
});
it("response-loss replay does not repeat provider reads or effects after a committed decision",async()=>{
 const f=await fixture(),id=await f.notice();await f.reconcile(id);expect(await f.reconcile(id)).toEqual({kind:"not-claimed"});expect(f.port.account).toHaveBeenCalledTimes(1);expect(await counts(f.hh)).toEqual({states:1,events:1,audits:1});
});
it("serializes different concurrent notices for one subscription before provider access",async()=>{
 const f=await fixture(),ids=await Promise.all(Array.from({length:6},()=>f.notice()));
 const claims=await Promise.all(ids.map(id=>claimStripeTestNotice(worker,f.hh,id)));expect(claims.filter(Boolean)).toHaveLength(1);
 const blocked=ids.find((_,i)=>claims[i]===null)!;await expect(worker.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE stripe_test_notices SET state='leased',attempts=1,lease_token=${randomUUID()}::uuid,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=${blocked}::uuid`)).rejects.toThrow();
});
it("different households progress independently and cannot claim each other's notices",async()=>{
 const f=await fixture(),g=await fixture(),a=await f.notice(),b=await g.notice();
 expect(await claimStripeTestNotice(worker,g.hh,a)).toBeNull();expect((await Promise.all([f.reconcile(a),g.reconcile(b)])).every(r=>r.kind==="reconciled")).toBe(true);
 expect(await readStripeTestEligibility(db,randomUUID())).toBeNull();
});
it.each(["expired","wrong-token","wrong-revision","wrong-binding"])("refuses stale or mismatched %s completion with no domain effects",async mode=>{
 const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 if(mode==="expired")await admin.stripeTestNotice.update({where:{id},data:{leaseUntil:new Date(0)}});
 await expect(mode==="wrong-token"?commitStripeTestState(worker,f.hh,id,randomUUID(),0,p.state):mode==="wrong-binding"?commitStripeTestState(worker,f.hh,id,p.lease.leaseToken,0,{...p.state,customerId:"cus_Foreign"}):p.commit(mode==="wrong-revision"?1:0)).rejects.toThrow();
 expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});
});
it("crash after provider read expires safely; a newer notice wins and fences the old writer",async()=>{
 const f=await fixture(),old=await f.notice(),p=await proposal(f,old);await admin.stripeTestNotice.update({where:{id:old},data:{leaseUntil:new Date(0)}});
 f.sub.status="canceled";await f.reconcile(await f.notice());await expect(p.commit()).rejects.toThrow();
 expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({state:"canceled",eligible:false,revision:1});expect(await counts(f.hh)).toEqual({states:1,events:1,audits:1});
});
it("deletion or ownership loss during provider reads prevents committing",async()=>{
 for(const mode of ["deletion","owner"]){const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 if(mode==="deletion")await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 else await admin.householdUser.updateMany({where:{householdId:f.hh,userId:f.owner},data:{role:"viewer"}});
 await expect(p.commit()).rejects.toThrow();expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});}
});
it("rolls back state/audit/notice when outbox insert fails",async()=>{
 const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 // Local synthetic trigger targets this exact fixture; no shared role-grant changes.
 await admin.$executeRawUnsafe(`CREATE FUNCTION public.billing_fixture_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.household_id='${f.hh}'::uuid AND NEW.event_type='billing.test_state_reconciled' THEN RAISE EXCEPTION 'Synthetic outbox unavailable'; END IF; RETURN NEW; END $$`);
 await admin.$executeRawUnsafe('CREATE TRIGGER billing_fixture_refuse BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION public.billing_fixture_refuse()');
 try{await expect(p.commit()).rejects.toThrow();expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.findUnique({where:{id}}))).toMatchObject({state:"leased"});}
 finally{await admin.$executeRawUnsafe('DROP TRIGGER billing_fixture_refuse ON outbox_events');await admin.$executeRawUnsafe('DROP FUNCTION public.billing_fixture_refuse()');}
 expect(await p.commit()).toMatchObject({revision:1});
});
it("pending/unknown evidence cannot be marked reconciled or directly forged by the app role",async()=>{
 const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 await expect(worker.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE stripe_test_notices SET state='reconciled',lease_token=NULL,lease_until=NULL WHERE id=${id}::uuid`)).rejects.toThrow();
 await expect(commitStripeTestState(db,f.hh,id,p.lease.leaseToken,0,p.state)).rejects.toThrow();
 await expect(worker.withHousehold(f.hh,tx=>tx.$executeRaw`DELETE FROM stripe_test_states`)).rejects.toThrow();
 expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});
});
it.each(["timeout","429","504","live","disagreement"])("provider %s leaves a bounded lease without persisting a decision",async mode=>{
 const f=await fixture(),id=await f.notice();
 if(["timeout","429","504"].includes(mode))vi.mocked(f.port.account).mockRejectedValue(new Error("Synthetic provider failure"));
 if(mode==="live")f.sub.livemode=true;
 if(mode==="disagreement")vi.mocked(f.port.subscription).mockResolvedValueOnce(structuredClone(f.sub)).mockResolvedValueOnce({...f.sub,status:"canceled"});
 await expect(f.reconcile(id)).rejects.toThrow("Test billing evidence could not be verified");expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});expect(f.port.account).toHaveBeenCalledTimes(1);
 expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.findUnique({where:{id}}))).toMatchObject({state:"leased",attempts:1});
});
it("renewal, cancellation and late old notices use current refetch and increment one binding revision",async()=>{
 const f=await fixture();await f.reconcile(await f.notice());f.sub.items.data[0]!.current_period_end+=30*86400;await f.reconcile(await f.notice());
 f.sub.cancel_at_period_end=true;await f.reconcile(await f.notice());expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({state:"canceling",eligible:true,revision:3});
 const late=await f.notice();f.sub.status="canceled";await f.reconcile(late);expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({state:"canceled",eligible:false,revision:4});expect(await counts(f.hh)).toEqual({states:1,events:4,audits:4});
});
it("read-time expiry denies eligibility even when no worker runs",async()=>{
 const f=await fixture();await f.reconcile(await f.notice());
 await admin.stripeTestState.updateMany({where:{householdId:f.hh},data:{paidThrough:1n,premiumUntil:1n}});
 expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({eligible:false,applicationEntitlementActivated:false});
 await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT source_lease_token,account_id FROM stripe_test_states`)).rejects.toThrow();
});

it("persists anchored grace, does not extend it on failure replay, and recovers on paid refetch",async()=>{
 const f=await fixture();await f.reconcile(await f.notice());const paid=f.now-60;
 await admin.stripeTestState.updateMany({where:{householdId:f.hh},data:{paidThrough:BigInt(paid),premiumUntil:BigInt(paid)}});
 f.sub.status="past_due";f.invoice.status="open";f.invoice.amount_remaining=1200;
 await f.reconcile(await f.notice());await f.reconcile(await f.notice());
 expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestState.findFirst())).toMatchObject({state:"grace",paidThrough:BigInt(paid),premiumUntil:BigInt(paid+604800),revision:3});
 f.sub.status="active";f.invoice.status="paid";f.invoice.amount_remaining=0;await f.reconcile(await f.notice());
 expect(await readStripeTestEligibility(db,f.hh)).toMatchObject({state:"active",eligible:true,revision:4});
});
it("export contains the safe TEST subscription projection, never provider or lease identifiers",async()=>{
 const f=await fixture();await f.reconcile(await f.notice());const id=randomUUID();
 await runAsUser(f.owner,()=>requestOwnerExport(db,f.hh,id));const snapshot=await runAsUser(f.owner,()=>readOwnerExportSnapshot(db,f.hh,id));
 expect(snapshot.testSubscription).toMatchObject({mode:"test",state:"active",plan:"monthly",applicationEntitlementActivated:false});
 expect(JSON.stringify(snapshot)).not.toContain(f.b.customerId);expect(JSON.stringify(snapshot)).not.toContain(f.b.subscriptionId);
 expect(Object.keys(snapshot.testSubscription!)).toEqual(expect.arrayContaining(["state","plan","paidThrough","premiumUntil","mode","applicationEntitlementActivated","reconciledAt"]));
 expect(Object.keys(snapshot.testSubscription!)).toHaveLength(7);expect(snapshot.complete).toBe(false);
});

it("uses a distinct idempotent internal intent for missed webhooks without fabricating a Stripe event",async()=>{
 const {requestStripeTestReconciliation}=await import("@autobureau/db");const f=await fixture(),key=randomUUID();
 const ids=await Promise.all([1,2].map(()=>requestStripeTestReconciliation(worker,f.hh,f.binding,key,"missed-webhook")));
 expect(ids[0]).toBe(ids[1]);expect(await admin.stripeTestNotice.count({where:{householdId:f.hh}})).toBe(0);
 expect(await reconcileStripeTestNotice(worker,f.hh,ids[0]!,f.port,catalog,"intent")).toMatchObject({kind:"reconciled",revision:1});
 expect(await admin.stripeTestIntent.findUnique({where:{id:ids[0]!}})).toMatchObject({state:"reconciled",expectedRevision:0});
 expect(await reconcileStripeTestNotice(worker,f.hh,ids[0]!,f.port,catalog,"intent")).toEqual({kind:"not-claimed"});
 await expect(requestStripeTestReconciliation(worker,f.hh,f.binding,key,"scheduled-recheck")).rejects.toThrow();
 expect(await counts(f.hh)).toEqual({states:1,events:1,audits:1});
});
it("notice and internal intent cannot concurrently own one subscription",async()=>{
 const {requestStripeTestReconciliation}=await import("@autobureau/db");const f=await fixture();
 const intent=await requestStripeTestReconciliation(worker,f.hh,f.binding,randomUUID(),"scheduled-recheck"),notice=await f.notice();
 const claims=await Promise.all([claimStripeTestNotice(worker,f.hh,intent,"intent"),claimStripeTestNotice(worker,f.hh,notice)]);
 expect(claims.filter(Boolean)).toHaveLength(1);
});
it("SQL refuses partial state commit even with a valid lease",async()=>{
 const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 await expect(worker.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_notice_id,source_lease_token,state,plan,paid_through,premium_until)
 VALUES(${f.hh}::uuid,${f.binding}::uuid,${f.b.accountId},${id}::uuid,${p.lease.leaseToken}::uuid,'active','monthly',${p.state.paidThrough},${p.state.premiumUntil})`)).rejects.toThrow("TEST billing atomic commit refused");
 expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});expect((await admin.stripeTestNotice.findUniqueOrThrow({where:{id}})).state).toBe("leased");
});
it("SQL refuses lease expiry between state transition and transaction commit",async()=>{
 const f=await fixture(),id=await f.notice(),p=await proposal(f,id);
 await admin.stripeTestNotice.update({where:{id},data:{leaseUntil:new Date(Date.now()+600)}});
 await expect(worker.withHousehold(f.hh,async tx=>{
  const [s]=await tx.$queryRaw<Array<{id:string}>>`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_notice_id,source_lease_token,state,plan,paid_through,premium_until)
   VALUES(${f.hh}::uuid,${f.binding}::uuid,${f.b.accountId},${id}::uuid,${p.lease.leaseToken}::uuid,'active','monthly',${p.state.paidThrough},${p.state.premiumUntil}) RETURNING id`;
  await tx.$executeRaw`UPDATE stripe_test_notices SET state='reconciled',lease_token=NULL,lease_until=NULL WHERE id=${id}::uuid`;
  await tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${f.hh}::uuid,'billing.test_state_reconciled','stripe-test-state',${s!.id}::uuid,'{"revision":1}'::jsonb)`;
  await tx.$executeRaw`SELECT pg_sleep(0.7)`;
 })).rejects.toThrow();expect(await counts(f.hh)).toEqual({states:0,events:0,audits:0});
});
it.each(["documents","item_secrets","household_members","job_deliveries","job_inbox","users","user_profiles","entitlements"])("dedicated TEST billing cannot read unrelated %s data",async table=>{
 const f=await fixture();const {Prisma}=await import("@autobureau/db");
 await expect(worker.withHousehold(f.hh,tx=>tx.$queryRaw(Prisma.sql`SELECT * FROM ${Prisma.raw(table)}`))).rejects.toThrow();
});
it("dedicated role cannot forge arbitrary audit/outbox, change bindings/catalog or assume worker authority",async()=>{
 const f=await fixture();
 for(const sql of ["INSERT INTO audit_log(household_id,actor_type,action,target_type) VALUES(app.current_household(),'system','stripe_test_states.insert','stripe_test_states')",
 "INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(app.current_household(),'item.created','item',gen_random_uuid(),'{}')",
 "UPDATE stripe_test_bindings SET customer_id='cus_Forged'","UPDATE plan_catalog SET managed_humans=NULL","UPDATE local_plan_activation SET test_enabled=true","SET ROLE app_job_worker"]){
 const {Prisma}=await import("@autobureau/db");await expect(worker.withHousehold(f.hh,tx=>tx.$executeRaw(Prisma.raw(sql)))).rejects.toThrow();}
 const rows=await admin.$queryRaw<Array<{privilege:boolean}>>`SELECT has_any_column_privilege('app_job_worker','stripe_test_notices','SELECT,INSERT,UPDATE') OR has_any_column_privilege('app_job_worker','stripe_test_states','SELECT,INSERT,UPDATE') OR has_any_column_privilege('app_job_worker','stripe_test_bindings','SELECT,INSERT,UPDATE') AS privilege`;
 expect(rows).toEqual([{privilege:false}]);
 expect(await admin.$queryRaw`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname='app_billing_test'`).toEqual([]);
});
it("catalog is read-only, has exact approved policy, and TEST caps default disabled",async()=>{
 const {readEffectivePlan}=await import("@autobureau/db");const f=await fixture();await admin.entitlement.create({data:{householdId:f.hh,periodStart:new Date()}});await f.reconcile(await f.notice());
 expect(await db.withHousehold(f.hh,tx=>readEffectivePlan(tx,f.hh))).toEqual({tier:"free",version:1,documentsPerMonth:10,documentWarning:8,managedHumans:1});
 await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
 try{expect(await db.withHousehold(f.hh,tx=>readEffectivePlan(tx,f.hh))).toEqual({tier:"premium",version:1,documentsPerMonth:50,documentWarning:40,managedHumans:null});}
 finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
 await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE local_plan_activation SET test_enabled=true`)).rejects.toThrow();
 await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE plan_catalog SET documents_per_month=999`)).rejects.toThrow();
});
async function memberFixture(){const f=await fixture();await admin.entitlement.create({data:{householdId:f.hh,periodStart:new Date()}});
 const add=(kind="adult",userId:string|null=null)=>runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$queryRaw<Array<{id:string}>>`INSERT INTO household_members(household_id,display_name,kind,user_id,updated_at) VALUES(${f.hh}::uuid,'PUBLIC synthetic person',${kind}::"MemberKind",${userId}::uuid,clock_timestamp()) RETURNING id`));
 return {...f,add};}
it("counts managed humans only, never DOB; excludes explicit self, pets, entities and archives",async()=>{
 const f=await memberFixture();await f.add("adult",f.owner);await f.add("pet");await f.add("entity");const [person]=await f.add("dependent");
 await expect(f.add("child")).rejects.toThrow("Managed member allowance reached");
 await runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE household_members SET archived_at=clock_timestamp() WHERE id=${person!.id}::uuid`));
 await f.add("child");await expect(f.add("adult",f.owner)).rejects.toThrow("Self binding refused");
 expect(await admin.householdMember.count({where:{householdId:f.hh}})).toBe(5);
});
it("simultaneous Free human additions cannot both consume the one allowance",async()=>{
 const f=await memberFixture(),r=await Promise.allSettled([f.add(),f.add()]);expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect(await admin.householdMember.count({where:{householdId:f.hh}})).toBe(1);
});
it("pet-to-human changes and restores cannot bypass a full Free allowance",async()=>{
 const f=await memberFixture();await f.add();const [pet]=await f.add("pet");
 await expect(runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE household_members SET kind='adult' WHERE id=${pet!.id}::uuid`))).rejects.toThrow("Managed member allowance reached");
 const archived=await admin.householdMember.create({data:{householdId:f.hh,kind:"child",displayName:"PUBLIC archive",archivedAt:new Date()}});
 await expect(runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE household_members SET archived_at=NULL WHERE id=${archived.id}::uuid`))).rejects.toThrow("Managed member allowance reached");
});
it("concurrent archive/add never leaves more than one active managed human",async()=>{
 const f=await memberFixture(),[person]=await f.add();
 await Promise.allSettled([f.add(),runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE household_members SET archived_at=clock_timestamp() WHERE id=${person!.id}::uuid`))]);
 expect(await admin.householdMember.count({where:{householdId:f.hh,archivedAt:null}})).toBeLessThanOrEqual(1);
});
it("Premium downgrade preserves all existing members and blocks only new consuming work",async()=>{
 const f=await memberFixture();await f.reconcile(await f.notice());await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
 try{
  const [first]=await f.add();await f.add();await f.add();
  f.sub.status="canceled";await f.reconcile(await f.notice());
  await expect(f.add()).rejects.toThrow("Managed member allowance reached");await f.add("pet");
  await runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE household_members SET display_name='PUBLIC edited' WHERE id=${first!.id}::uuid`));
  expect(await admin.householdMember.count({where:{householdId:f.hh,archivedAt:null}})).toBe(4);
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it("database-time grace expiry before commit rolls back an otherwise valid member addition",async()=>{
 const f=await memberFixture();await f.add();await f.reconcile(await f.notice());
 await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
 try{
  await admin.stripeTestState.updateMany({where:{householdId:f.hh},data:{premiumUntil:BigInt(Math.ceil(Date.now()/1000)+1)}});
  await expect(runAsUser(f.owner,()=>db.withHousehold(f.hh,async tx=>{
   await tx.$executeRaw`INSERT INTO household_members(household_id,display_name,kind,updated_at) VALUES(${f.hh}::uuid,'PUBLIC expires','adult',clock_timestamp())`;
   await tx.$executeRaw`SELECT pg_sleep(2.1)`;
  }))).rejects.toThrow("Managed member allowance reached");
  expect(await admin.householdMember.count({where:{householdId:f.hh}})).toBe(1);
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it("a billing-owned temporary trigger cannot forge a second journal audit",async()=>{
 const f=await fixture(),id=await f.notice();
 await expect(worker.withHousehold(f.hh,async tx=>{
  await tx.$executeRaw`CREATE TEMP TABLE billing_audit_probe(id uuid,household_id uuid) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE FUNCTION pg_temp.billing_audit_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   INSERT INTO public.audit_log(household_id,actor_type,action,target_type,target_id) VALUES(NEW.household_id,'system','stripe_test_notices.insert','stripe_test_notices',NEW.id); RETURN NEW; END $$`;
  await tx.$executeRaw`CREATE TRIGGER billing_audit_probe AFTER INSERT ON billing_audit_probe FOR EACH ROW EXECUTE FUNCTION pg_temp.billing_audit_probe()`;
  await tx.$executeRaw`INSERT INTO billing_audit_probe VALUES(${id}::uuid,${f.hh}::uuid)`;
 })).rejects.toThrow("TEST audit cardinality refused");
});
it("ordinary application authority cannot spoof the reserved billing audit namespace",async()=>{
 const f=await fixture(),id=await f.notice();
 await expect(runAsUser(f.owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO audit_log(household_id,actor_type,action,target_type,target_id,meta) VALUES(${f.hh}::uuid,'user','stripe_test_notices.insert','stripe_test_notices',${id}::uuid,'{"billing_transition":1}'::jsonb)`))).rejects.toThrow("TEST audit authority refused");
});
it("a downgrade that wins the privacy lock fences an already queued member addition",async()=>{
 const f=await memberFixture();await f.add();await f.reconcile(await f.notice());await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
 let locked!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{locked=r;}),barrier=new Promise<void>(r=>{release=r;});
 const holder=admin.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${f.hh}`},0))`;locked();await barrier;
  await tx.stripeTestState.updateMany({where:{householdId:f.hh},data:{state:"canceled",premiumUntil:null}});
 });
 await ready;const pending=f.add();const observed=pending.then(()=>"accepted",()=>"refused");
 try{
  let blocked=false;for(let i=0;i<100;i++){const [r]=await admin.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND usename='app_user'`;if(Number(r?.n)>0){blocked=true;break;}await new Promise(r=>setTimeout(r,5));}
  expect(blocked).toBe(true);release();await holder;expect(await observed).toBe("refused");
  expect(await admin.householdMember.count({where:{householdId:f.hh}})).toBe(1);
 }finally{release();await holder;await observed;await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it("billing cadence changes and cancellation never reset the entitlement usage period",async()=>{
 const f=await memberFixture();await admin.entitlement.update({where:{householdId:f.hh},data:{docsUsedThisPeriod:9}});
 const before=await admin.entitlement.findUniqueOrThrow({where:{householdId:f.hh}});await f.reconcile(await f.notice());
 f.sub.items.data[0]!.price.id="price_AnnualSynthetic";
 vi.mocked(f.port.price).mockResolvedValue({object:"price",id:"price_AnnualSynthetic",livemode:false,active:true,type:"recurring",currency:"usd",unit_amount:9900,billing_scheme:"per_unit",recurring:{interval:"year",interval_count:1,usage_type:"licensed"},product:{object:"product",id:"prod_Synthetic",active:true,livemode:false}});
 const annual=[{plan:"annual" as const,priceId:"price_AnnualSynthetic",productId:"prod_Synthetic"}];
 await reconcileStripeTestNotice(worker,f.hh,await f.notice(),f.port,annual);f.sub.status="canceled";await reconcileStripeTestNotice(worker,f.hh,await f.notice(),f.port,annual);
 expect(await admin.entitlement.findUniqueOrThrow({where:{householdId:f.hh}})).toEqual(before);
});
