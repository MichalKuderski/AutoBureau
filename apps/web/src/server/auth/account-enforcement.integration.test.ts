import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import { generateKeyPair,exportJWK,SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "@/test/integration/database";
import { createDatabaseSensitiveOperationPolicy } from "./sensitive-operation";
import { createDatabaseRecoveryPorts } from "./account-recovery-ports";
import { createRecoveryController } from "./account-recovery";
import { createJwtVerifier } from "./jwt";
import type { AccountProvider } from "./account-provider";
import type { AuthConfig } from "./config";
import { bucketOf, type PolicyName } from "../http/rate-limit";
let admin:PrismaClient,db:Database;const users:string[]=[],households:string[]=[],buckets:string[]=[];
const request=(ip="203.0.113.212")=>new Request("https://pellum.invalid/local-only",{method:"POST",headers:{origin:"https://pellum.invalid","x-autobureau-request":"1",...(ip?{"x-forwarded-for":ip}:{})}});
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());},120000);
afterAll(async()=>{if(admin){await admin.householdDeletion.deleteMany({where:{householdId:{in:households}}});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where:{householdId:{in:households}}});await admin.user.deleteMany({where:{id:{in:users}}});await admin.authRateLimit.deleteMany({where:{bucket:{in:buckets}}});}await admin?.$disconnect();await db?.disconnect();});
async function fixture(){
 const user=randomUUID(),hh=randomUUID(),session=randomUUID(),factor=randomUUID();users.push(user);households.push(hh);
 await admin.user.create({data:{id:user,email:`${user}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC POLICY",createdBy:user}});await admin.householdUser.create({data:{householdId:hh,userId:user,role:"owner"}});
 const pair=await generateKeyPair("ES256"),now=Math.floor(Date.now()/1000);
 const config:AuthConfig={issuer:"https://auth.invalid",audience:"authenticated",jwks:{keys:{keys:[{...await exportJWK(pair.publicKey),kid:"fixture",alg:"ES256"}]}},algorithms:["ES256"],apiUrl:"https://auth.invalid/auth/v1",anonKey:"public-fixture",cookieName:"ab_session",refreshCookieName:"ab_session_refresh",allowedOrigins:["https://pellum.invalid"]};
 const jwt=async(level:"aal1"|"aal2"="aal1",method="password",subject=user)=>new SignJWT({session_id:session,aal:level,amr:[{method,timestamp:now}]}).setProtectedHeader({alg:"ES256",kid:"fixture"}).setSubject(subject).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt(now).setExpirationTime(now+3600).sign(pair.privateKey);
 const token=await jwt(),verifier=createJwtVerifier(config);
 const provider={factors:vi.fn(async()=>({userId:user,factors:[] as Array<{id:string;factor_type:"totp";status:"verified"}>})),recover:vi.fn(async()=>undefined),redeemRecovery:vi.fn(async()=>({accessToken:await jwt("aal1","recovery"),refreshToken:"synthetic",expiresIn:3600})),updatePassword:vi.fn(async()=>({userId:user})),revoke:vi.fn(async()=>undefined)} as unknown as AccountProvider;
 const req=request();for(const p of ["recovery.ip","recovery.complete_ip"] as PolicyName[])buckets.push(bucketOf(p,"203.0.113.212"));buckets.push(bucketOf("recovery.user",user));
 return{user,hh,session,factor,config,provider,verifier,jwt,token,req,ports:()=>createDatabaseRecoveryPorts(db,hh,req,verifier,async()=>"allowed")};
}
it("central sensitive policy verifies real signature and live restricted-role ownership",async()=>{
 const f=await fixture(),p=createDatabaseSensitiveOperationPolicy(db,f.verifier,f.provider);expect((await p(f.token,f.hh,"export.download")).authorized).toBe(true);
 await expect(p(f.token+"x",f.hh,"export.download")).rejects.toThrow();
 await expect(p(await f.jwt("aal1","password",randomUUID()),f.hh,"export.download")).rejects.toThrow();
 await expect(p(f.token,randomUUID(),"export.download")).rejects.toThrow();
});
it("required policy survives missing provider factor and stale AAL",async()=>{
 const f=await fixture(),other=randomUUID();users.push(other);await admin.user.create({data:{id:other,email:`${other}@example.test`}});await admin.householdUser.create({data:{householdId:f.hh,userId:other,role:"viewer"}});
 const p=createDatabaseSensitiveOperationPolicy(db,f.verifier,f.provider);await expect(p(f.token,f.hh,"billing.manage")).rejects.toThrow();
 vi.mocked(f.provider.factors).mockResolvedValue({userId:f.user,factors:[{id:f.factor,factor_type:"totp",status:"verified"}]});
 await expect(p(f.token,f.hh,"billing.manage")).rejects.toThrow();expect((await p(await f.jwt("aal2","totp"),f.hh,"billing.manage")).authorized).toBe(true);
});
it.each(["demotion","fence"])("rechecks %s after provider read",async mode=>{
 const f=await fixture();vi.mocked(f.provider.factors).mockImplementationOnce(async()=>{
 if(mode==="demotion")await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});
 else await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.user,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 return{userId:f.user,factors:[]};});
 await expect(createDatabaseSensitiveOperationPolicy(db,f.verifier,f.provider)(f.token,f.hh,"export.generate")).rejects.toThrow();
});
it("recovery composes signed redemption, live admission, audit and forced signin",async()=>{
 const f=await fixture();const result=await createRecoveryController(f.config,f.provider,f.ports()).complete(f.req,{tokenHash:"synthetic-single-use",password:"synthetic-passphrase"});
 expect(result.status).toBe(200);expect(await result.json()).toMatchObject({passwordChanged:true,signInRequired:true});expect(f.provider.updatePassword).toHaveBeenCalledTimes(1);expect(f.provider.revoke).toHaveBeenCalledTimes(1);
 expect(await admin.auditLog.count({where:{householdId:f.hh,action:{startsWith:"auth.account_security"}}})).toBe(3);
});
it("recovery limiter persists across adapter restart, normalizes email and refuses missing ingress IP",async()=>{
 const f=await fixture(),email=`${f.user}@example.test`;buckets.push(bucketOf("recovery.identifier",email));
 for(let i=0;i<3;i++)expect(await f.ports().limit(f.req,email)).toBe(true);
 expect(await f.ports().limit(f.req,email.toUpperCase())).toBe(false);
 const noIp=request("");expect(await createDatabaseRecoveryPorts(db,f.hh,noIp,f.verifier,async()=>"allowed").limit(noIp)).toBe(false);
});
it("recovery rejects required MFA even if the provider returns no factor",async()=>{
 const f=await fixture(),other=randomUUID();users.push(other);await admin.user.create({data:{id:other,email:`${other}@example.test`}});await admin.householdUser.create({data:{householdId:f.hh,userId:other,role:"viewer"}});
 expect((await createRecoveryController(f.config,f.provider,f.ports()).complete(f.req,{tokenHash:"synthetic-single-use",password:"synthetic-passphrase"})).status).toBe(403);expect(f.provider.updatePassword).not.toHaveBeenCalled();
});
it("recovery counter failure refuses before an email or token provider call",async()=>{
 const f=await fixture(),broken={withGlobalTable:async()=>{throw new Error("synthetic counter unavailable");}} as unknown as Database;
 const ports=createDatabaseRecoveryPorts(broken,f.hh,f.req,f.verifier,async()=>"allowed");
 expect((await createRecoveryController(f.config,f.provider,ports).complete(f.req,{tokenHash:"synthetic-single-use",password:"synthetic-passphrase"})).status).toBe(503);expect(f.provider.redeemRecovery).not.toHaveBeenCalled();
});
