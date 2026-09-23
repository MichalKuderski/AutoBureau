import { afterAll, beforeAll, afterEach, it, expect } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";
import { resetBoundaryCache } from "../http/route";
import { GET } from "@/app/v1/households/current/route";
import { PATCH } from "@/app/v1/me/route";
let f:Awaited<ReturnType<typeof domainHarness>>;
beforeAll(async()=>{f=await domainHarness();resetBoundaryCache();},120000);
afterAll(async()=>{await f?.close();resetBoundaryCache();});
afterEach(async()=>{
 f.security.beforeFactors=undefined;f.security.factorFailure=false;
 await f.admin.householdDeletion.deleteMany({where:{householdId:f.household}});
 await f.admin.user.update({where:{id:f.owner},data:{status:"active"}});
 await f.admin.householdUser.update({where:{householdId_userId:{householdId:f.household,userId:f.owner}},data:{role:"owner"}});
});
it("mounted read and mutation refuse AAL1 for enrolled MFA before domain access",async()=>{
 expect((await GET(await f.request('/v1/households/current',{assurance:"aal1"}))).status).toBe(403);
 const before=await f.admin.userProfile.findUniqueOrThrow({where:{userId:f.owner}});
 expect((await PATCH(await f.request('/v1/me',{method:"PATCH",assurance:"aal1",body:{display_name:"must not persist"}}))).status).toBe(403);
 expect((await f.admin.userProfile.findUniqueOrThrow({where:{userId:f.owner}})).displayName).toBe(before.displayName);
});
it("missing signed assurance does not inherit ordinary authorization",async()=>{
 expect((await GET(await f.request('/v1/households/current',{assurance:"missing"}))).status).toBe(403);
});
it("valid signed AAL2 allows registry reads and keeps existing viewer permissions",async()=>{
 expect((await GET(await f.request('/v1/households/current'))).status).toBe(200);
 expect((await GET(await f.request('/v1/households/current',{user:f.viewer}))).status).toBe(200);
});
it.each(["owner","inactive","fence"])("mounted mutation refuses %s drift during factor I/O",async mode=>{
 const before=await f.admin.userProfile.findUniqueOrThrow({where:{userId:f.owner}});
 f.security.beforeFactors=async()=>{
  if(mode==="owner")await f.admin.householdUser.update({where:{householdId_userId:{householdId:f.household,userId:f.owner}},data:{role:"viewer"}});
  if(mode==="inactive")await f.admin.user.update({where:{id:f.owner},data:{status:"suspended"}});
  if(mode==="fence")await f.admin.householdDeletion.create({data:{householdId:f.household,requestedBy:f.owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:"fenced",fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 };
 const res=await PATCH(await f.request('/v1/me',{method:"PATCH",body:{display_name:"must not persist"}}));
 expect([403,409]).toContain(res.status);
 expect((await f.admin.userProfile.findUniqueOrThrow({where:{userId:f.owner}})).displayName).toBe(before.displayName);
});
it("provider outage fails closed without returning household data or clearing cookies",async()=>{
 f.security.factorFailure=true;
 const r=await GET(await f.request('/v1/households/current'));
 expect(r.status).toBe(503);expect(r.headers.getSetCookie()).toEqual([]);expect(await r.text()).not.toContain(f.household);
});
it("sixty-second provider evidence expiry refuses before the handler",async()=>{
 const {createDatabase}=await import('@autobureau/db');const {APP_URL}=await import('@/test/integration/database');
 const {withHouseholdSession}=await import('./household-session');const {createJwtVerifier}=await import('./jwt');const {authConfigFromEnv}=await import('./config');
 const db=createDatabase(APP_URL()),token=(await f.request('/v1/me')).headers.get('cookie')!.split('=')[1]!;
 const p=await createJwtVerifier(authConfigFromEnv()).verify(token);let reached=false;
 try{await expect(withHouseholdSession(db,{userId:f.owner,householdId:f.household,role:'owner'},p,token,
  {factors:async()=>({userId:f.owner,factors:[{id:f.owner,factor_type:'totp',status:'verified'}]})},'registry.read',async()=>{reached=true;},()=>Math.floor(Date.now()/1000)-61)).rejects.toThrow();expect(reached).toBe(false);}finally{await db.disconnect();}
});
it("SSR household chooser refuses enrolled AAL1 without releasing names",async()=>{
 const {createDatabase}=await import('@autobureau/db');const {APP_URL}=await import('@/test/integration/database');const {householdOptions}=await import('./household-options');
 const {createJwtVerifier}=await import('./jwt');const {authConfigFromEnv}=await import('./config');const {createAccountProvider}=await import('./account-provider');
 const db=createDatabase(APP_URL()),c=authConfigFromEnv(),token=(await f.request('/v1/me',{assurance:'aal1'})).headers.get('cookie')!.split('=')[1]!;
 try{await expect(householdOptions(db,await createJwtVerifier(c).verify(token),token,createAccountProvider(c))).rejects.toThrow();}finally{await db.disconnect();}
});
it("data prepared before ownership loss is not released after slow work",async()=>{
 const {createDatabase}=await import('@autobureau/db');const {APP_URL}=await import('@/test/integration/database');const {withHouseholdSession}=await import('./household-session');
 const {createJwtVerifier}=await import('./jwt');const {authConfigFromEnv}=await import('./config');const {createAccountProvider}=await import('./account-provider');
 const db=createDatabase(APP_URL()),c=authConfigFromEnv(),token=(await f.request('/v1/me')).headers.get('cookie')!.split('=')[1]!;
 try{await expect(withHouseholdSession(db,{userId:f.owner,householdId:f.household,role:'owner'},await createJwtVerifier(c).verify(token),token,createAccountProvider(c),'registry.read',async()=>{
  const data=await db.withHousehold(f.household,tx=>tx.household.findFirst());
  await f.admin.householdUser.update({where:{householdId_userId:{householdId:f.household,userId:f.owner}},data:{role:'viewer'}});
  return data;
 })).rejects.toThrow();}finally{await db.disconnect();}
});
it.each(['foreign-user','revoked-factor'])("closed provider projection refuses %s evidence",async mode=>{
 const {createDatabase}=await import('@autobureau/db');const {APP_URL}=await import('@/test/integration/database');const {withHouseholdSession}=await import('./household-session');
 const {createJwtVerifier}=await import('./jwt');const {authConfigFromEnv}=await import('./config');
 const db=createDatabase(APP_URL()),token=(await f.request('/v1/me')).headers.get('cookie')!.split('=')[1]!;
 let reached=false;
 try{await expect(withHouseholdSession(db,{userId:f.owner,householdId:f.household,role:'owner'},await createJwtVerifier(authConfigFromEnv()).verify(token),token,
 {factors:async()=>({userId:mode==='foreign-user'?f.outsider:f.owner,factors:mode==='revoked-factor'?[]:[{id:f.owner,factor_type:'totp',status:'verified'}]})},'registry.read',async()=>{reached=true;})).rejects.toThrow();expect(reached).toBe(false);}finally{await db.disconnect();}
});
