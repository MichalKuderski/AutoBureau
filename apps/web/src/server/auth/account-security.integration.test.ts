import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import { generateKeyPair,exportJWK,SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import { createDatabase,runAsUser,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "@/test/integration/database";
import { createAccountProvider } from "./account-provider";
import { createLocalAccountRoutes } from "./local-account-routes";
import { createAccountSecurityController } from "./account-security";
import { createDatabaseAccountSecurityPorts } from "./account-security-ports";
import { createJwtVerifier } from "./jwt";
import type { AuthConfig } from "./config";
import { enforceRateLimit,MFA_VERIFY_POLICIES,SIGN_IN_POLICIES,bucketOf } from "../http/rate-limit";
let admin:PrismaClient,db:Database;const users:string[]=[],households:string[]=[];
const request=()=>new Request("https://pellum.invalid/local-only",{method:"POST",headers:{origin:"https://pellum.invalid","x-autobureau-request":"1","x-forwarded-for":"203.0.113.234"}});
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());},120000);
afterAll(async()=>{if(admin){await admin.accountSecurityChallenge.deleteMany({where:{householdId:{in:households}}});await admin.householdDeletion.deleteMany({where:{householdId:{in:households}}});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where:{householdId:{in:households}}});await admin.user.deleteMany({where:{id:{in:users}}});
 const buckets=users.flatMap(u=>["mfa.identifier","mfa.verify_identifier"].map(p=>bucketOf(p as "mfa.identifier",u)));buckets.push(bucketOf("mfa.ip","203.0.113.234"));await admin.authRateLimit.deleteMany({where:{bucket:{in:buckets}}});}
 await admin?.$disconnect();await db?.disconnect();});
async function fixture(){
 const user=randomUUID(),hh=randomUUID(),factor=randomUUID(),session=randomUUID(),challenge=randomUUID();users.push(user);households.push(hh);
 await admin.user.create({data:{id:user,email:`${user}@example.test`}});await admin.household.create({data:{id:hh,name:"PUBLIC MFA",createdBy:user}});await admin.householdUser.create({data:{householdId:hh,userId:user,role:"owner"}});
 const pair=await generateKeyPair("ES256"),now=Math.floor(Date.now()/1000);
 const config:AuthConfig={issuer:"https://auth.invalid",audience:"authenticated",jwks:{keys:{keys:[{...await exportJWK(pair.publicKey),kid:"fixture",alg:"ES256"}]}},algorithms:["ES256"],apiUrl:"https://auth.invalid/auth/v1",anonKey:"public-fixture",cookieName:"ab_session",refreshCookieName:"ab_session_refresh",allowedOrigins:["https://pellum.invalid"]};
 const jwt=async(level:"aal1"|"aal2")=>new SignJWT({session_id:session,aal:level,amr:[{method:level==="aal2"?"totp":"password",timestamp:now}]}).setProtectedHeader({alg:"ES256",kid:"fixture"}).setSubject(user).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt(now).setExpirationTime(now+3600).sign(pair.privateKey);
 const access=await jwt("aal1"),elevated=await jwt("aal2");
 const fetcher=vi.fn<typeof fetch>(async(url)=>{
  const path=new URL(String(url)).pathname;
  const body=path.endsWith("/user")?{id:user,factors:[{id:factor,factor_type:"totp",status:"verified"}]}:path.endsWith("/challenge")?{id:challenge,type:"totp",expires_at:now+240}:path.endsWith("/verify")?{access_token:elevated,refresh_token:"synthetic.rotated.refresh",expires_in:3600}:{};
  return new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
 });
 const verifier=createJwtVerifier(config),provider=createAccountProvider(config,fetcher);
 const controller=()=>createAccountSecurityController(config,provider,createDatabaseAccountSecurityPorts(db,hh,verifier));
 return{user,hh,factor,challenge,access,elevated,fetcher,controller,config,provider,verifier};
}
it("composes real JWT verification, provider transport, durable challenge and RLS across controller restart",async()=>{
 const f=await fixture();const issued=await f.controller()(request(),f.access,{action:"challenge",factorId:f.factor});expect(issued.status).toBe(200);
 const value={action:"verify",factorId:f.factor,challengeId:f.challenge,code:"123456"};
 const req=request();req.headers.set("cookie",`ab_session=${f.access}`);req.headers.set("content-type","application/json");
 const httpRequest=new Request("https://pellum.invalid/v1/account/security",{method:"POST",headers:req.headers,body:JSON.stringify(value)});
 const closed=async()=>{throw new Error("Not this operation");};
 const route=createLocalAccountRoutes(f.config,{security:f.controller(),initiate:closed,complete:closed});
 const verified=await route(httpRequest);expect(verified.status).toBe(200);expect(await verified.json()).toEqual({verified:true});expect(verified.headers.getSetCookie()).toHaveLength(2);
 expect((await f.controller()(request(),f.access,value)).status).toBe(403);
 expect(f.fetcher.mock.calls.filter(c=>String(c[0]).endsWith("/verify"))).toHaveLength(1);
 const rows=await runAsUser(f.user,()=>db.withHousehold(f.hh,async tx=>({challenges:await tx.accountSecurityChallenge.count({where:{consumedAt:{not:null}}}),audit:await tx.auditLog.count()})));
 expect(rows.challenges).toBe(1);expect(rows.audit).toBeGreaterThanOrEqual(6);
});
it("real limiter rejects sixth MFA verification before provider while retaining durable attempts",async()=>{
 const f=await fixture();const body={action:"verify",factorId:f.factor,challengeId:randomUUID(),code:"123456"};
 for(let i=0;i<5;i++)expect((await f.controller()(request(),f.access,body)).status).toBe(403);
 const prior=f.fetcher.mock.calls.length;expect((await f.controller()(request(),f.access,body)).status).toBe(429);expect(f.fetcher).toHaveBeenCalledTimes(prior);
});
it("ownership change after challenge prevents provider verification",async()=>{
 const f=await fixture();expect((await f.controller()(request(),f.access,{action:"challenge",factorId:f.factor})).status).toBe(200);
 await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});
 const prior=f.fetcher.mock.calls.length;expect((await f.controller()(request(),f.access,{action:"verify",factorId:f.factor,challengeId:f.challenge,code:"123456"})).status).toBe(403);expect(f.fetcher).toHaveBeenCalledTimes(prior);
});
it("MFA counter outage fails closed while accepted public-auth degradation policy stays unchanged",async()=>{
 const broken={withGlobalTable:async()=>{throw new Error("Synthetic counter outage");}} as unknown as Database;
 const input={db:broken,request:request(),identifier:randomUUID(),traceId:randomUUID(),route:"local-only"};
 expect((await enforceRateLimit({...input,policies:MFA_VERIFY_POLICIES}))?.status).toBe(503);
 expect(await enforceRateLimit({...input,policies:SIGN_IN_POLICIES})).toBeNull();
});

it.each(["owner", "policy", "fence"])("real signed controller refuses %s drift during factor-provider I/O",async mode=>{
 const f=await fixture(),original=f.fetcher.getMockImplementation()!;
 f.fetcher.mockImplementationOnce(async(...args)=>{
  if(mode==="owner")await admin.householdUser.update({where:{householdId_userId:{householdId:f.hh,userId:f.user}},data:{role:"viewer"}});
  if(mode==="policy"){
   const item=await admin.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}});
   await admin.itemSecret.create({data:{itemId:item.id,field:"synthetic",ciphertext:Buffer.from("PUBLIC synthetic"),keyVersion:1}});
  }
  if(mode==="fence")await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.user,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
  return original(...args);
 });
 expect((await f.controller()(request(),f.elevated,{action:"remove",factorId:f.factor})).status).toBe(403);
 expect(f.fetcher.mock.calls.some(([,options])=>options?.method==="DELETE")).toBe(false);
});
