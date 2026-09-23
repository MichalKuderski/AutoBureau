import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,it,expect } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { bindStripeTestSubscription,acceptStripeTestNotice,claimStripeTestNotice,refuseStripeTestNotice } from "../../src/stripe-test-inbox.js";
import { ADMIN_URL,APP_URL,adminClient,bootstrapDatabase,grantAppUserLogin } from "./setup.js";
let admin:PrismaClient,app:PrismaClient,worker:PrismaClient,db:Database,work:Database;
const owner=randomUUID(),other=randomUUID(),households:string[]=[];
const notice=(sub:string)=>({eventId:`evt_${randomUUID().replaceAll("-","")}`,eventType:"customer.subscription.updated",objectId:sub,created:Math.floor(Date.now()/1000)});
beforeAll(async()=>{
 await bootstrapDatabase();await grantAppUserLogin();admin=adminClient();app=new PrismaClient({datasourceUrl:APP_URL});db=new Database(app);
 await admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_local_only'");const u=new URL(ADMIN_URL);u.username="app_billing_test";u.password="stripe_local_only";worker=new PrismaClient({datasourceUrl:u.toString()});work=new Database(worker);
 await admin.user.createMany({data:[owner,other].map(id=>({id,email:`${id}@example.test`}))});
},120000);
afterAll(async()=>{
 if(admin){const where={householdId:{in:households}};
 await admin.stripeTestNotice.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});await admin.householdDeletion.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:[owner,other]}}});
 await admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");}
 await Promise.all([admin,app,worker].map(c=>c?.$disconnect()));
});
async function fixture(){const hh=randomUUID();households.push(hh);await admin.household.create({data:{id:hh,name:"PUBLIC billing fixture",createdBy:owner}});await admin.householdUser.create({data:{householdId:hh,userId:owner,role:"owner"}});
 const suffix=randomUUID().replaceAll("-","");const b={accountId:"acct_Synthetic",customerId:`cus_${suffix}`,subscriptionId:`sub_${suffix}`,livemode:false as const};
 return {hh,b};
}
async function bound(){const f=await fixture();const bindingId=await runAsUser(owner,()=>bindStripeTestSubscription(db,f.hh,f.b));return {...f,bindingId};}
it("binds once under owner authority and refuses metadata, Live and replacement ownership",async()=>{
 const f=await bound();expect(await runAsUser(owner,()=>bindStripeTestSubscription(db,f.hh,f.b))).toBe(f.bindingId);
 for(const b of [{...f.b,livemode:true},{...f.b,customerId:"cus_Attacker"},{...f.b,metadata:{householdId:f.hh}}])await expect(runAsUser(owner,()=>bindStripeTestSubscription(db,f.hh,b))).rejects.toThrow();
 await expect(runAsUser(other,()=>bindStripeTestSubscription(db,f.hh,f.b))).rejects.toThrow();
 const g=await fixture();await expect(runAsUser(owner,()=>bindStripeTestSubscription(db,g.hh,f.b))).rejects.toThrow();
 await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE stripe_test_bindings SET customer_id='cus_Attacker'`)).rejects.toThrow();
});
it("commits one event identity/audit across duplicate concurrency and process restart",async()=>{
 const f=await bound(),n=notice(f.b.subscriptionId);
 const ids=await Promise.all(Array.from({length:6},()=>acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n)));
 expect(new Set(ids).size).toBe(1);
 const u=new URL(ADMIN_URL);u.username="app_billing_test";u.password="stripe_local_only";const restarted=new PrismaClient({datasourceUrl:u.toString()});try{expect(await acceptStripeTestNotice(new Database(restarted),f.hh,f.bindingId,f.b.accountId,n)).toBe(ids[0]);}finally{await restarted.$disconnect();}
 expect(await work.withHousehold(f.hh,tx=>tx.stripeTestNotice.count())).toBe(1);
 expect(await work.withHousehold(f.hh,tx=>tx.auditLog.count({where:{action:"stripe_test_notices.insert"}}))).toBe(1);
 expect(await db.withHousehold(f.hh,tx=>tx.entitlement.count())).toBe(0);
});
it("refuses changed event identity and cross-account/subscription/household binding",async()=>{
 const f=await bound(),g=await bound(),n=notice(f.b.subscriptionId);await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n);
 await expect(acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,{...n,created:n.created-1})).rejects.toThrow();
 await expect(acceptStripeTestNotice(work,f.hh,f.bindingId,"acct_Wrong",n)).rejects.toThrow();
 await expect(acceptStripeTestNotice(work,g.hh,f.bindingId,f.b.accountId,n)).rejects.toThrow();
 await expect(acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,{...n,eventId:"evt_FreshWrongSubscription",objectId:g.b.subscriptionId})).rejects.toThrow();
 await expect(acceptStripeTestNotice(work,g.hh,g.bindingId,g.b.accountId,{...n,objectId:g.b.subscriptionId})).rejects.toThrow();
});
it("old authenticated arrival cannot overwrite newer notice or grant entitlement",async()=>{
 const f=await bound(),n=notice(f.b.subscriptionId);
 await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n);
 await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,{...n,eventId:"evt_Older",created:n.created-5000});
 expect(await work.withHousehold(f.hh,tx=>tx.stripeTestNotice.count({where:{state:"pending"}}))).toBe(2);
 expect(await work.withHousehold(f.hh,tx=>tx.outboxEvent.count())).toBe(0);
});
it("RLS hides foreign/unscoped notices and app role cannot forge webhook writes",async()=>{
 const f=await bound(),g=await bound(),n=notice(f.b.subscriptionId);await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n);
 expect(await worker.stripeTestNotice.count()).toBe(0);expect(await app.stripeTestBinding.count()).toBe(0);
 expect(await work.withHousehold(g.hh,tx=>tx.stripeTestNotice.count())).toBe(0);
 await expect(acceptStripeTestNotice(db,f.hh,f.bindingId,f.b.accountId,notice(f.b.subscriptionId))).rejects.toThrow();
 await expect(work.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE stripe_test_notices SET object_id='sub_Attacker'`)).rejects.toThrow();
 await expect(work.withHousehold(f.hh,tx=>tx.$executeRaw`DELETE FROM stripe_test_notices`)).rejects.toThrow();
});
it("claims once concurrently; crash recovery replaces expired lease and fences stale refusal",async()=>{
 const f=await bound(),id=await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,notice(f.b.subscriptionId));
 const claims=await Promise.all(Array.from({length:5},()=>claimStripeTestNotice(work,f.hh,id)));expect(claims.filter(Boolean)).toHaveLength(1);const first=claims.find(Boolean)!;
 expect(first.leaseUntil.getTime()-Date.now()).toBeGreaterThan(55000);
 await admin.stripeTestNotice.update({where:{id},data:{leaseUntil:new Date(0)}});
 expect(await refuseStripeTestNotice(work,f.hh,id,first.leaseToken)).toBe(false);
 const second=(await claimStripeTestNotice(work,f.hh,id))!;expect(second.attempt).toBe(2);expect(second.leaseToken).not.toBe(first.leaseToken);
 expect(await refuseStripeTestNotice(work,f.hh,id,first.leaseToken)).toBe(false);
 expect(await refuseStripeTestNotice(work,f.hh,id,second.leaseToken)).toBe(true);
 expect(await claimStripeTestNotice(work,f.hh,id)).toBeNull();
});
it("bounds poison/crash retry at three and forbids direct attempt reset",async()=>{
 const f=await bound(),id=await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,notice(f.b.subscriptionId));
 for(let i=1;i<=3;i++){expect((await claimStripeTestNotice(work,f.hh,id))?.attempt).toBe(i);await admin.stripeTestNotice.update({where:{id},data:{leaseUntil:new Date(0)}});}
 expect(await claimStripeTestNotice(work,f.hh,id)).toBeNull();
 await expect(work.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE stripe_test_notices SET state='pending',attempts=0,lease_token=NULL,lease_until=NULL WHERE id=${id}::uuid`)).rejects.toThrow();
});
it("deletion fence blocks notice replay, new receipt and pending claims",async()=>{
 const f=await bound(),n=notice(f.b.subscriptionId),id=await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n);
 await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 await expect(acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,n)).rejects.toThrow();await expect(claimStripeTestNotice(work,f.hh,id)).rejects.toThrow();
 await expect(runAsUser(owner,()=>bindStripeTestSubscription(db,f.hh,f.b))).rejects.toThrow();
});
it.each([{objectId:"in_Mismatch"},{eventType:"checkout.session.completed"},{created:Math.floor(Date.now()/1000)+900},{metadata:{email:"must-not-persist"}},{customerId:"cus_Attacker"}])("rejects malformed/unsupported/unsafe projection %j",async change=>{
 const f=await bound();await expect(acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,{...notice(f.b.subscriptionId),...change})).rejects.toThrow();
});
it("expired lease after a lock wait cannot finalize a refusal",async()=>{
 const f=await bound(),id=await acceptStripeTestNotice(work,f.hh,f.bindingId,f.b.accountId,notice(f.b.subscriptionId)),lease=(await claimStripeTestNotice(work,f.hh,id))!;
 let ready!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
 const holder=admin.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM stripe_test_notices WHERE id=${id}::uuid FOR UPDATE`;ready();await gate;await tx.stripeTestNotice.update({where:{id},data:{leaseUntil:new Date(0)}});});
 await started;const stale=refuseStripeTestNotice(work,f.hh,id,lease.leaseToken);release();await holder;expect(await stale).toBe(false);
});
