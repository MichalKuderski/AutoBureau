import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,requestOwnerExport,readOwnerExportSnapshot,readAccountSecurityAdmission,runAsUser,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "@/test/integration/database";
import { createSensitiveOperationExecutor } from "./sensitive-operation";
import type { VerifiedPrincipal } from "./jwt";
let admin:PrismaClient,db:Database;const users:string[]=[],households:string[]=[];
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());});
afterAll(async()=>{if(admin){const where={householdId:{in:households}};await admin.householdDeletion.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.outboxEvent.deleteMany({where});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:users}}});}await admin?.$disconnect();await db?.disconnect();});
async function fixture(){
 const user=randomUUID(),hh=randomUUID(),session=randomUUID(),requestId=randomUUID();users.push(user);households.push(hh);
 await admin.user.create({data:{id:user,email:`${user}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC sensitive fixture",createdBy:user}});await admin.householdUser.create({data:{householdId:hh,userId:user,role:"owner"}});
 const now=Math.floor(Date.now()/1000),p:VerifiedPrincipal={userId:user,email:undefined,issuedAt:now,expiresAt:now+600,assurance:{sessionId:session,level:"aal1",methods:[{method:"password",timestamp:now}]}};
 const ports={verifyJwt:vi.fn(async()=>p),factors:vi.fn(async()=>({userId:user,factors:[]})),admit:(h:string,principal:VerifiedPrincipal)=>runAsUser(principal.userId,()=>readAccountSecurityAdmission(db,h,principal.userId))};
 return{user,hh,requestId,p,ports,execute:createSensitiveOperationExecutor(ports)};
}
it("one request policy protects export intent, snapshot and attributed audit in real scoped transactions",async()=>{
 const f=await fixture();const result=await f.execute("synthetic verified token",f.hh,"export.generate",async()=>{
  await requestOwnerExport(db,f.hh,f.requestId);return readOwnerExportSnapshot(db,f.hh,f.requestId);
 });
 expect(result.complete).toBe(false);expect(result.ownerId).toBe(f.user);expect(f.ports.factors).toHaveBeenCalledTimes(1);
 expect(await runAsUser(f.user,()=>db.withHousehold(f.hh,tx=>tx.outboxEvent.count({where:{aggregateId:f.requestId}})))).toBe(1);
});
it.each(["owner", "fence", "policy", "suspended"])("transaction-time policy refuses %s drift after provider preflight",async mode=>{
 const f=await fixture();
 await expect(f.execute("synthetic verified token",f.hh,"export.generate",async()=>{
  if(mode==="owner")await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});
  if(mode==="policy"){
   const item=await admin.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}});
   await admin.itemSecret.create({data:{itemId:item.id,field:"synthetic",ciphertext:Buffer.from("PUBLIC"),keyVersion:1}});
  }
  if(mode==="suspended")await admin.user.update({where:{id:f.user},data:{status:"suspended"}});
  if(mode==="fence")await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.user,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
  return requestOwnerExport(db,f.hh,f.requestId);
 })).rejects.toThrow();
 expect(await admin.outboxEvent.count({where:{householdId:f.hh,aggregateId:f.requestId}})).toBe(0);
});
it("late serialization cannot release data after owner loss even without another domain call",async()=>{
 const f=await fixture();await expect(f.execute("synthetic verified token",f.hh,"export.download",async()=>{
  await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});return "PUBLIC result withheld";
 })).rejects.toThrow();
});
it("unknown operation cannot enter a domain callback",async()=>{
 const f=await fixture(),task=vi.fn(async()=>true);await expect(f.execute("token",f.hh,"unknown" as never,task)).rejects.toThrow();expect(task).not.toHaveBeenCalled();
});
