import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,it,expect } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser,runAsSystem } from "../../src/audit.js";
import { putAccountChallenge,consumeAccountChallenge,readAccountSecurityAdmission,auditAccountSecurity } from "../../src/account-security.js";
import { APP_URL,adminClient,bootstrapDatabase,grantAppUserLogin } from "./setup.js";
let admin:PrismaClient,app:PrismaClient,db:Database;
const owner=randomUUID(),other=randomUUID(),households:string[]=[];
beforeAll(async()=>{await bootstrapDatabase();await grantAppUserLogin();admin=adminClient();app=new PrismaClient({datasourceUrl:APP_URL});db=new Database(app);
 await admin.user.createMany({data:[owner,other].map(id=>({id,email:`${id}@example.test`}))});},120000);
afterAll(async()=>{if(admin){
 await admin.accountSecurityChallenge.deleteMany({where:{householdId:{in:households}}});
 await admin.householdDeletion.deleteMany({where:{householdId:{in:households}}});
 await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where:{householdId:{in:households}}});
 await admin.user.deleteMany({where:{id:{in:[owner,other]}}});}await app?.$disconnect();await admin?.$disconnect();});
async function fixture(){const hh=randomUUID();households.push(hh);await admin.household.create({data:{id:hh,name:"PUBLIC security fixture",createdBy:owner}});
 await admin.householdUser.create({data:{householdId:hh,userId:owner,role:"owner"}});
 return {hh,b:{userId:owner,sessionId:randomUUID(),factorId:randomUUID(),challengeId:randomUUID(),expiresAt:Math.floor(Date.now()/1000)+240}};}
it("persists single-use challenge and content-free audit across client restart",async()=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 const another=new PrismaClient({datasourceUrl:APP_URL});try{
  expect(await runAsUser(owner,()=>consumeAccountChallenge(new Database(another),f.hh,f.b))).toBe(true);
  expect(await runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))).toBe(false);
  const count=await runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.auditLog.count({where:{action:{startsWith:"account_security_challenges."}}})));expect(count).toBe(2);
 }finally{await another.$disconnect();}
});
it("concurrent consume commits exactly once",async()=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 const values=await Promise.all(Array.from({length:8},()=>runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))));
 expect(values.filter(Boolean)).toHaveLength(1);
});
it.each(["userId","sessionId","factorId","challengeId"] as const)("refuses changed %s binding",async key=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 const changed={...f.b,[key]:randomUUID()};
 if(key==="userId")await expect(runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,changed))).rejects.toThrow();
 else expect(await runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,changed))).toBe(false);
 expect(await runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))).toBe(true);
});
it("real RLS hides rows from another principal, household and unscoped connection",async()=>{
 const f=await fixture(),g=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 expect(await app.accountSecurityChallenge.count()).toBe(0);
 expect(await runAsUser(other,()=>db.withHousehold(f.hh,tx=>tx.accountSecurityChallenge.count()))).toBe(0);
 expect(await runAsUser(owner,()=>db.withHousehold(g.hh,tx=>tx.accountSecurityChallenge.count()))).toBe(0);
 await expect(runAsUser(owner,()=>putAccountChallenge(db,g.hh,{...f.b,userId:other}))).rejects.toThrow();
});
it("expired challenge and duplicate registration never reset consumption",async()=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 await admin.accountSecurityChallenge.updateMany({where:{householdId:f.hh},data:{createdAt:new Date(Date.now()-300000),expiresAt:new Date(Date.now()-1000)}});
 expect(await runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))).toBe(false);
 await expect(runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b))).rejects.toThrow();
});
it("database rejects TTL widening, identity rewrites and replay reset",async()=>{
 const f=await fixture();await expect(runAsUser(owner,()=>putAccountChallenge(db,f.hh,{...f.b,expiresAt:Math.floor(Date.now()/1000)+600}))).rejects.toThrow();
 await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE account_security_challenges SET expires_at=clock_timestamp()+interval '1 hour' WHERE challenge_id=${f.b.challengeId}::uuid`))).rejects.toThrow();
 await runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b));
 await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE account_security_challenges SET consumed_at=NULL WHERE challenge_id=${f.b.challengeId}::uuid`))).rejects.toThrow();
});
it("live policy requires MFA for secrets or multiple users, not user metadata",async()=>{
 const f=await fixture();expect(await runAsUser(owner,()=>readAccountSecurityAdmission(db,f.hh,owner))).toEqual({requiresMfa:false});
 const item=await admin.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}});
 await admin.itemSecret.create({data:{itemId:item.id,field:"synthetic",ciphertext:Buffer.from("SYNTHETIC ONLY"),keyVersion:1}});
 expect(await runAsUser(owner,()=>readAccountSecurityAdmission(db,f.hh,owner))).toEqual({requiresMfa:true});
 await admin.itemSecret.deleteMany({where:{itemId:item.id}});
 await admin.householdUser.create({data:{householdId:f.hh,userId:other,role:"viewer"}});
 expect(await runAsUser(owner,()=>readAccountSecurityAdmission(db,f.hh,owner))).toEqual({requiresMfa:true});
});
it("demotion and deletion fence stop existing challenges and audit admission",async()=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:owner}},data:{role:"viewer"}});
 await expect(runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))).rejects.toThrow();
 await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:owner}},data:{role:"owner"}});
 await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 await expect(runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b))).rejects.toThrow();
 await expect(runAsUser(owner,()=>auditAccountSecurity(db,f.hh,owner,"verify","attempted"))).rejects.toThrow();
});
it("system actor cannot replace live owner authorization",async()=>{
 const f=await fixture();await expect(runAsSystem("PUBLIC fixture",()=>putAccountChallenge(db,f.hh,f.b))).rejects.toThrow();
});
it("wait on a lock cannot extend a challenge lifetime",async()=>{
 const f=await fixture();await runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b));
 let locked!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{locked=r;}),barrier=new Promise<void>(r=>{release=r;});
 const holder=admin.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM account_security_challenges WHERE challenge_id=${f.b.challengeId}::uuid FOR UPDATE`;locked();await barrier;
  await tx.accountSecurityChallenge.updateMany({where:{challengeId:f.b.challengeId},data:{createdAt:new Date(Date.now()-300000),expiresAt:new Date(Date.now()-1)}});});
 await ready;const waiting=runAsUser(owner,()=>consumeAccountChallenge(db,f.hh,f.b));release();await holder;expect(await waiting).toBe(false);
});
it.each(["suspended","deletion_pending"] as const)("inactive account %s cannot enter the security boundary",async status=>{
 const f=await fixture();await admin.user.update({where:{id:owner},data:{status}});
 try {await expect(runAsUser(owner,()=>readAccountSecurityAdmission(db,f.hh,owner))).rejects.toThrow();await expect(runAsUser(owner,()=>putAccountChallenge(db,f.hh,f.b))).rejects.toThrow();}
 finally {await admin.user.update({where:{id:owner},data:{status:"active"}});}
});
it.each(["owner", "policy", "fence", "expired"])("transaction admission rechecks %s after waiting on the runtime serialization lock", async mode=>{
 const f=await fixture();
 let locked!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>{locked=r;}),barrier=new Promise<void>(r=>{release=r;});
 const holder=admin.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${f.hh}`},0))`;
  locked();await barrier;
  if(mode==="owner")await tx.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:owner}},data:{role:"viewer"}});
  if(mode==="policy")await tx.householdUser.create({data:{householdId:f.hh,userId:other,role:"viewer"}});
  if(mode==="fence")await tx.householdDeletion.create({data:{householdId:f.hh,requestedBy:owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 });
 await ready;
 let expires=Number.MAX_SAFE_INTEGER,checks=0;
 const waiting=runAsUser(owner,()=>auditAccountSecurity(db,f.hh,owner,"enroll","attempted",current=>{
  checks++;if(current.requiresMfa || current.now>=expires)throw new Error("Synthetic authority expired");
 }));
 // Wait until the actual app query is blocked, so moving owner admission ahead
 // of the lock is deterministically caught rather than scheduler-dependent.
 let blocked=false;
 for(let i=0;i<100;i++){
  const [r]=await admin.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%assert_household_open%'`;
  if(Number(r?.n)>0){blocked=true;break;}await new Promise(r=>setTimeout(r,5));
 }
 if(!blocked){release();await holder;await waiting;throw new Error("Fixture never reached lock wait");}
 // Handle rejection before releasing the concurrent fixture transaction.
 const assertion=expect(waiting).rejects.toThrow();
 if(mode==="expired")expires=0;
 release();await holder;await assertion;
 expect(await admin.auditLog.count({where:{householdId:f.hh,action:"auth.account_security_attempted"}})).toBe(0);
 expect(checks).toBe(mode==="owner"||mode==="fence"?0:1);
});
it("sensitive admission commits an attributed audit under the existing lock",async()=>{
 const f=await fixture();let blocked=false;
 await runAsUser(owner,()=>auditAccountSecurity(db,f.hh,owner,"enroll","attempted",current=>{
  expect(current.requiresMfa).toBe(false);expect(current.now).toBeGreaterThan(0);blocked=true;
 }));
 expect(blocked).toBe(true);
 expect(await runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.auditLog.count({where:{action:"auth.account_security_attempted"}})))).toBe(1);
});
it("sensitive scope checks twice, refuses actor/household/capability changes and cannot be replaced",async()=>{
 const {runWithSensitiveScope}=await import("../../src/sensitive-scope.js");const f=await fixture(),g=await fixture();let checks=0;
 await runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{checks++;},()=>db.withHousehold(f.hh,tx=>tx.household.count())));
 expect(checks).toBe(2);
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>db.withHousehold(g.hh,tx=>tx.household.count())))).rejects.toThrow();
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>runAsUser(other,()=>db.withHousehold(f.hh,tx=>tx.household.count()))))).rejects.toThrow();
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>db.withPrincipal(owner,async()=>true)))).rejects.toThrow();
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>db.withGlobalTable("auth_rate_limits",async()=>true)))).rejects.toThrow();
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>db.unsafeAcrossAllHouseholds("PUBLIC attempt",async()=>true)))).rejects.toThrow();
 expect(()=>runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},()=>runWithSensitiveScope(g.hh,owner,()=>{},()=>true)))).toThrow();
});
it("commit-time scope failure rolls back domain and audit together",async()=>{
 const {runWithSensitiveScope}=await import("../../src/sensitive-scope.js");const f=await fixture();let checks=0;
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{if(++checks===2)throw new Error("Synthetic stale authority");},()=>db.withHousehold(f.hh,tx=>tx.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}}))))).rejects.toThrow();
 expect(checks).toBe(2);
 expect(await runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.item.count()))).toBe(0);
 expect(await runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.auditLog.count({where:{action:"item.created"}})))).toBe(0);
});

it("detached continuation cannot reuse completed sensitive scope",async()=>{
 const {runWithSensitiveScope}=await import("../../src/sensitive-scope.js");const f=await fixture();
 let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let escaped!:Promise<unknown>;
 await runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,()=>{},async()=>{
  escaped=(async()=>{await barrier;return db.withHousehold(f.hh,tx=>tx.household.count());})();
 }));
 const denied=expect(escaped).rejects.toThrow();release();await denied;
});
it("asynchronous policy callback cannot silently bypass commit admission",async()=>{
 const {runWithSensitiveScope}=await import("../../src/sensitive-scope.js");const f=await fixture();
 await expect(runAsUser(owner,()=>runWithSensitiveScope(f.hh,owner,async()=>{},()=>db.withHousehold(f.hh,tx=>tx.household.count())))).rejects.toThrow();
});
