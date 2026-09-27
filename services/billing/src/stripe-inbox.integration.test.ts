import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll,afterAll,it,expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,runAsUser,bindStripeTestSubscription,acceptStripeTestNotice,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "./test/database.js";
import { createStripeTestNoticeVerifier } from "./stripe-test-notice.js";
let admin:PrismaClient,db:Database,worker:Database;const users:string[]=[],households:string[]=[];
const secret="whsec_synthetic_journal_conformance_only",apiVersion="2026-02-25.clover";
const verify=createStripeTestNoticeVerifier((bytes,sig,key,tolerance)=>Stripe.webhooks.constructEvent(Buffer.from(bytes),sig,key,tolerance),{signingSecret:secret,apiVersion,mode:"test"});
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());await admin.$executeRawUnsafe("ALTER ROLE app_billing_test LOGIN PASSWORD 'stripe_composition_only'");const u=new URL(APP_URL());u.username="app_billing_test";u.password="stripe_composition_only";worker=createDatabase(u.toString());},120000);
afterAll(async()=>{if(admin){const where={householdId:{in:households}};await admin.stripeTestNotice.deleteMany({where});await admin.stripeTestRoute.deleteMany({where});await admin.stripeTestCheckout.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:users}}});await admin.$executeRawUnsafe("ALTER ROLE app_billing_test NOLOGIN PASSWORD NULL");}await admin?.$disconnect();await db?.disconnect();await worker?.disconnect();});
async function fixture(){const user=randomUUID(),hh=randomUUID(),suffix=randomUUID().replaceAll("-","");users.push(user);households.push(hh);await admin.user.create({data:{id:user,email:`${user}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC SDK fixture",createdBy:user}});await admin.householdUser.create({data:{householdId:hh,userId:user,role:"owner"}});
 const accountId="acct_Synthetic",sub=`sub_${suffix}`,binding=await runAsUser(user,()=>bindStripeTestSubscription(db,hh,{accountId,customerId:`cus_${suffix}`,subscriptionId:sub,livemode:false}));
 const body=JSON.stringify({id:`evt_${suffix}`,object:"event",livemode:false,api_version:apiVersion,created:Math.floor(Date.now()/1000),type:"customer.subscription.updated",data:{object:{id:sub,metadata:{private:"UNTRUSTED_CANARY"}}}});
 return{hh,binding,accountId,body,signature:Stripe.webhooks.generateTestHeaderString({payload:body,secret})};
}
async function accept(f:Awaited<ReturnType<typeof fixture>>,body=f.body,signature=f.signature){const result=verify(Buffer.from(body),signature);if(result.kind!=="reconcile")throw new Error("Synthetic event rejected");const {kind:_,customerId:__,...projection}=result;return acceptStripeTestNotice(worker,f.hh,f.binding,f.accountId,projection);}
it("official raw-body verification composes with durable RLS journal and exact duplicate replay",async()=>{
 const f=await fixture();expect(await accept(f)).toBe(await accept(f));
 const rows=await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.findMany());expect(rows).toHaveLength(1);expect(JSON.stringify(rows,(_,v)=>typeof v==="bigint"?v.toString():v)).not.toContain("UNTRUSTED_CANARY");expect(rows[0]?.state).toBe("pending");
});
it("invalid signature or changed bytes create no journal or entitlement",async()=>{
 const f=await fixture();await expect(accept(f,f.body.replace("subscription.updated","subscription.deleted"))).rejects.toThrow();await expect(accept(f,f.body,Stripe.webhooks.generateTestHeaderString({payload:f.body,secret:"whsec_other_synthetic_account"}))).rejects.toThrow();
 expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.count())).toBe(0);expect(await db.withHousehold(f.hh,tx=>tx.entitlement.count())).toBe(0);
});
it("server account binding cannot be overridden by an otherwise authentic event",async()=>{
 const f=await fixture();await expect(accept({...f,accountId:"acct_Unrelated"})).rejects.toThrow();expect(await worker.withHousehold(f.hh,tx=>tx.stripeTestNotice.count())).toBe(0);
});
