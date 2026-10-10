import { randomUUID,randomBytes,createSecretKey } from "node:crypto";
import { mkdtemp,chmod,rm,readdir } from "node:fs/promises";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,createLocalExportVault,readAccountSecurityAdmission,runAsUser,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "@/test/integration/database";
import { createLocalExportController } from "./local-export-controller";
import type { VerifiedPrincipal } from "../auth/jwt";
import type { AuthConfig } from "../auth/config";
let admin:PrismaClient,db:Database;const users:string[]=[],households:string[]=[],dirs:string[]=[];
const config:AuthConfig={allowedOrigins:["https://pellum.invalid"],cookieName:"ab_session",refreshCookieName:"ab_session_refresh",
 issuer:"https://auth.invalid",audience:"authenticated",jwks:{keys:{keys:[]}},algorithms:["ES256"],apiUrl:"https://auth.invalid/auth/v1",anonKey:"public-fixture"};
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());});
afterAll(async()=>{if(admin){const where={householdId:{in:households}};await admin.localExportArtifact.deleteMany({where});await admin.householdDeletion.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.outboxEvent.deleteMany({where});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:users}}});}await admin?.$disconnect();await db?.disconnect();for(const dir of dirs)await rm(dir,{recursive:true,force:true});});
async function fixture(){
 const user=randomUUID(),hh=randomUUID(),requestId=randomUUID();users.push(user);households.push(hh);
 await admin.user.create({data:{id:user,email:`${user}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC partial export",createdBy:user}});await admin.householdUser.create({data:{householdId:hh,userId:user,role:"owner"}});
 const dir=await mkdtemp(`${process.platform === 'linux' ? '/tmp' : '/private/tmp'}/pellum-local-export-http-`);dirs.push(dir);await chmod(dir,0o700);
 const vault=createLocalExportVault(dir,createSecretKey(randomBytes(32))),now=Math.floor(Date.now()/1000);
 const p:VerifiedPrincipal={userId:user,email:undefined,issuedAt:now,expiresAt:now+600,assurance:{sessionId:randomUUID(),level:"aal1",methods:[{method:"password",timestamp:now}]}};
 const ports={verifyJwt:vi.fn(async()=>p),factors:vi.fn(async()=>({userId:user,factors:[]})),limit:vi.fn(async()=>true),admit:(h:string,principal:VerifiedPrincipal)=>runAsUser(principal.userId,()=>readAccountSecurityAdmission(db,h,principal.userId))};
 const controller=createLocalExportController(config,db,hh,vault,ports);
 const req=(action:string)=>new Request("https://pellum.invalid/local/export",{method:"POST",headers:{origin:"https://pellum.invalid","x-autobureau-request":"1","content-type":"application/json",cookie:"ab_session=synthetic-verified-fixture"},body:JSON.stringify({action,requestId})});
 return{user,hh,requestId,dir,p,ports,vault,controller,req};
}
it("local HTTP request/build/retry/download/revoke uses encrypted journal plus central commit policy",async()=>{
 const f=await fixture();expect((await f.controller(f.req("request"))).status).toBe(202);
 for(let i=0;i<2;i++){const r=await f.controller(f.req("build"));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({complete:false,reused:i>0});}
 const downloaded=await f.controller(f.req("download"));expect(downloaded.status).toBe(200);expect(downloaded.headers.get("cache-control")).toContain("no-store");expect(downloaded.headers.get("content-disposition")).toContain("partial-export.jsonl");
 const lines=(await downloaded.text()).trim().split("\n").map(v=>JSON.parse(v));expect(lines[0]).toMatchObject({type:"manifest",complete:false});
 expect(lines[0].omissions).toContain("original-documents");expect(lines.some(r=>r.type==="account")).toBe(true);
 expect((await f.controller(f.req("revoke"))).status).toBe(200);expect((await f.controller(f.req("download"))).status).toBe(403);
 expect((await readdir(f.dir)).filter(n=>n.endsWith(".encrypted"))).toEqual([]);
 expect(await runAsUser(f.user,()=>db.withHousehold(f.hh,tx=>tx.localExportArtifact.findFirst({select:{state:true}})))).toEqual({state:"revoked"});
});
it.each(["stale","factor-required","bad-signature","limit","owner","fence"])("no export intent/artifact crosses failed local HTTP policy: %s",async mode=>{
 const f=await fixture();
 if(mode==="stale")f.p.assurance!.methods[0]!.timestamp-=900;
 if(mode==="factor-required"){const item=await admin.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}});await admin.itemSecret.create({data:{itemId:item.id,field:"synthetic",ciphertext:Buffer.from("PUBLIC"),keyVersion:1}});}
 if(mode==="bad-signature")f.ports.verifyJwt.mockRejectedValue(new Error("invalid"));
 if(mode==="limit")f.ports.limit.mockResolvedValue(false);
 if(mode==="owner")await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});
 if(mode==="fence")await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.user,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 expect((await f.controller(f.req("request"))).status).toBe(mode==="limit"?429:403);
 expect(await admin.outboxEvent.count({where:{householdId:f.hh}})).toBe(0);expect(await readdir(f.dir)).toEqual([]);
});
it("owner loss during file work refuses publication and data release",async()=>{
 const f=await fixture();await f.controller(f.req("request"));
 const vault={...f.vault,build:async(...args:Parameters<typeof f.vault.build>)=>{
  await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});return f.vault.build(...args);
 }};
 const controller=createLocalExportController(config,db,f.hh,vault,f.ports);
 expect((await controller(f.req("build"))).status).toBe(403);expect(await readdir(f.dir)).toEqual([]);
});
