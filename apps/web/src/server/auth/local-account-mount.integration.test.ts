import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll,afterEach,beforeAll,beforeEach,it,expect,vi } from "vitest";
import { Database } from "@autobureau/db";
import { setLogSink, resetLogSink, type LogRecord } from "../observability";
import { domainHarness } from "@/test/integration/domain-harness";
import { POST as security } from "@/app/v1/account/security/route";
import { POST as recovery } from "@/app/v1/auth/recovery/route";
import { POST as complete } from "@/app/v1/auth/recovery/complete/route";
import { bucketOf,type PolicyName } from "../http/rate-limit";
let f:Awaited<ReturnType<typeof domainHarness>>,server:ReturnType<typeof createServer>,origin:string;
let factorStatus:"unverified"|"verified"|undefined,redeemed=false;
const factor=randomUUID(),challenge=randomUUID(),calls:string[]=[],ip="203.0.113.238";
let access:string,elevated:string;
let issueRecovery: () => Promise<string>;
let failRevocation = false;
const records: LogRecord[] = [];
beforeEach(() => { records.length = 0; setLogSink(record => records.push(record)); });
afterEach(() => { resetLogSink(); vi.restoreAllMocks(); });
const saved={...process.env};
beforeAll(async()=>{
 f=await domainHarness();
 const token=async(assurance:"aal1"|"aal2",authMethod?:string)=>(await f.request('/v1/me',{assurance,...(authMethod?{authMethod}:{})})).headers.get("cookie")!.split('=')[1]!;
 access=await token("aal1");elevated=await token("aal2");
 // Redeem a freshly issued recovery grant, as the real provider does.
 issueRecovery=()=>token("aal1","recovery");
 server=createServer(async(req,res)=>{
  calls.push(`${req.method} ${req.url?.split('?')[0]}`);
  const reply=(v:unknown,status=200)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(v));};
  if(req.url==="/user"&&req.method==="GET")return reply({id:f.owner,factors:factorStatus?[{id:factor,factor_type:"totp",status:factorStatus}]:[]});
  if(req.url==="/factors"&&req.method==="POST"){factorStatus="unverified";return reply({id:factor,type:"totp",totp:{secret:"ABCDEFGHIJKLMNOP"}});}
  if(req.url===`/factors/${factor}/challenge`)return reply({id:challenge,type:"totp",expires_at:Math.floor(Date.now()/1000)+240});
  if(req.url===`/factors/${factor}/verify`){factorStatus="verified";return reply({access_token:elevated,refresh_token:"synthetic.rotated",expires_in:3600});}
  if(req.url===`/factors/${factor}`&&req.method==="DELETE"){factorStatus=undefined;return reply({id:factor});}
  if(req.url?.startsWith('/recover?'))return reply({});
  if(req.url?.startsWith('/range/')){res.writeHead(200,{"content-type":"text/plain"});res.end('0'.repeat(35)+':0\r\n');return;}
  if(req.url==="/verify"){if(redeemed)return reply({},400);redeemed=true;return reply({access_token:await issueRecovery(),refresh_token:"synthetic.recovery",expires_in:3600});}
  if(req.url==="/user"&&req.method==="PUT")return reply({id:f.owner});
  if(req.url?.startsWith('/logout?'))return reply({},failRevocation?503:200);
  reply({},404);
 });
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 Object.assign(process.env,{AUTH_API_URL:origin,APP_ORIGIN:origin,LOCAL_ACCOUNT_ROUTES:"synthetic-only"});
},120000);
afterAll(async()=>{
 await f.admin.accountSecurityChallenge.deleteMany({where:{householdId:f.household}});
 const buckets: string[]=[];
 for(const p of ["mfa.identifier","mfa.verify_identifier","recovery.user"] as PolicyName[])buckets.push(bucketOf(p,f.owner));
 for(const p of ["mfa.ip","recovery.ip","recovery.complete_ip"] as PolicyName[])buckets.push(bucketOf(p,ip));
 buckets.push(bucketOf("recovery.identifier",`${f.owner}@example.test`));
 await f.admin.authRateLimit.deleteMany({where:{bucket:{in:buckets}}});
 await new Promise<void>(r=>server.close(()=>r()));await f.close();
 for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
});
const req=(path:string,body:unknown,token?:string)=>new Request(origin+path,{method:"POST",headers:{origin,"x-autobureau-request":"1","content-type":"application/json","x-forwarded-for":ip,...(token?{cookie:`ab_session=${token}`}:{})},body:JSON.stringify(body)});
it("mounted local MFA enroll/challenge/verify rotates same-session cookies; replay and required-factor removal refuse",async()=>{
 const path='/v1/account/security';
 expect((await security(req(path,{action:"enroll"},access))).status).toBe(200);
 expect((await security(req(path,{action:"challenge",factorId:factor},access))).status).toBe(200);
 const body={action:"verify",factorId:factor,challengeId:challenge,code:"123456"};
 const verified=await security(req(path,body,access));expect(verified.status).toBe(200);expect(verified.headers.getSetCookie()).toHaveLength(2);
 expect((await security(req(path,body,access))).status).toBe(403);
 expect(calls.filter(v=>v===`POST /factors/${factor}/verify`)).toHaveLength(1);
 expect((await security(req(path,{action:"remove",factorId:factor},elevated))).status).toBe(403);
 expect(calls.some(v=>v.startsWith('DELETE'))).toBe(false);
 await f.admin.householdUser.delete({where:{householdId_userId:{householdId:f.household,userId:f.viewer}}});
 const removed=await security(req(path,{action:"remove",factorId:factor},elevated));expect(removed.status).toBe(200);expect(removed.headers.getSetCookie()).toHaveLength(2);
 expect(await removed.json()).toMatchObject({signInRequired:true,accessTokensMayRemainValidUntilExpiry:true});
});
it("mounted recovery is account independent; strong password range check, one redemption, update and revocation force sign-in",async()=>{
 expect((await recovery(req('/v1/auth/recovery',{email:`${f.owner}@example.test`}))).status).toBe(202);
 const path='/v1/auth/recovery/complete',body={tokenHash:"public_synthetic_recovery",password:"Violet-archipelago-72!Meteor"};
 expect((await complete(req(path,{...body,password:"password"}))).status).toBe(403);expect(redeemed).toBe(false);
 const changed=await complete(req(path,body));expect(changed.status).toBe(200);expect(changed.headers.getSetCookie()).toHaveLength(2);
 expect(await changed.json()).toMatchObject({passwordChanged:true,signInRequired:true});
 expect(calls.filter(v=>v==='PUT /user')).toHaveLength(1);
 expect((await complete(req(path,body))).status).toBe(403);expect(calls.filter(v=>v==='PUT /user')).toHaveLength(1);
});
it("mount refuses CSRF, and a mixed hosted/local configuration, before provider effects",async()=>{
 const before=calls.length,r=req('/v1/account/security',{action:"list"},elevated);r.headers.delete('x-autobureau-request');
 expect((await security(r)).status).toBe(403);expect(calls).toHaveLength(before);
 // VERCEL=1 with the local synthetic switch still set is neither mount: account-mount.ts
 // classifies it "unavailable" (404), exactly like the kill switch, before any provider call.
 process.env.VERCEL="1";
 try{expect((await recovery(req('/v1/auth/recovery',{email:`${f.owner}@example.test`}))).status).toBe(404);expect(calls).toHaveLength(before);}finally{delete process.env.VERCEL;}
 process.env.ACCOUNT_SECURITY_DISABLED="1";
 try{expect((await recovery(req('/v1/auth/recovery',{email:`${f.owner}@example.test`}))).status).toBe(404);expect(calls).toHaveLength(before);}finally{delete process.env.ACCOUNT_SECURITY_DISABLED;}
});


function recoveryRecord(response: Response) {
  const reference = response.headers.get("x-request-id");
  expect(reference).toMatch(/^[0-9a-f-]{36}$/);
  const failures = records.filter(r => r.event === "auth.recovery_failed");
  expect(failures).toHaveLength(1);
  expect(failures[0]?.trace_id).toBe(reference);
  const safe = JSON.stringify(failures);
  for (const forbidden of ["public_synthetic_recovery", "Violet-archipelago-72!Meteor", f.owner, f.household, origin]) expect(safe).not.toContain(forbidden);
  return failures[0]!;
}
const recoveryBody = () => ({tokenHash:"public_synthetic_recovery",password:"Violet-archipelago-72!Meteor"});

it("ambiguous live memberships refuse after redemption, before factor or password calls, with an owner-selection reference", async () => {
  redeemed=false; const before=calls.length;
  await f.admin.householdUser.create({data:{householdId:f.foreignHousehold,userId:f.owner,role:"owner"}});
  try {
    const response=await complete(req('/v1/auth/recovery/complete',recoveryBody()));
    expect(response.status).toBe(403);
    expect(recoveryRecord(response).meta).toMatchObject({phase:"owner_selection",mutation_outcome:"not_attempted"});
    expect(calls.slice(before)).toContain('POST /verify');
    expect(calls.slice(before)).not.toContain('GET /user'); expect(calls.slice(before)).not.toContain('PUT /user');
    records.length=0;
    const replay=await complete(req('/v1/auth/recovery/complete',recoveryBody()));
    expect(replay.status).toBe(403); expect(recoveryRecord(replay).meta?.phase).toBe("redemption");
  } finally {await f.admin.householdUser.delete({where:{householdId_userId:{householdId:f.foreignHousehold,userId:f.owner}}});}
});
it("live non-owner membership still refuses before factors or update",async()=>{
  redeemed=false;const before=calls.length;
  await f.admin.householdUser.update({where:{householdId_userId:{householdId:f.household,userId:f.owner}},data:{role:"viewer"}});
  try{
    const response=await complete(req('/v1/auth/recovery/complete',recoveryBody()));expect(response.status).toBe(403);
    expect(recoveryRecord(response).meta?.phase).toBe("owner_selection");
    expect(calls.slice(before)).not.toContain('GET /user');expect(calls.slice(before)).not.toContain('PUT /user');
  }finally{await f.admin.householdUser.update({where:{householdId_userId:{householdId:f.household,userId:f.owner}},data:{role:"owner"}});}
});
it("membership acquisition failure retains P2028 without leaking its raw message",async()=>{
  redeemed=false;const before=calls.length;
  vi.spyOn(Database.prototype,"withPrincipal").mockRejectedValueOnce(Object.assign(new Error("private-database-diagnostic"),{code:"P2028"}));
  const response=await complete(req('/v1/auth/recovery/complete',recoveryBody()));expect(response.status).toBe(403);
  expect(recoveryRecord(response).meta).toMatchObject({phase:"membership_read",category:"database",code:"P2028"});
  expect(JSON.stringify(records)).not.toContain("private-database-diagnostic");expect(calls.slice(before)).not.toContain('PUT /user');
});
it("post-update revocation outage is acknowledged internally, coarse publicly and never retries the update",async()=>{
  redeemed=false;failRevocation=true;const before=calls.length;
  try{
    const response=await complete(req('/v1/auth/recovery/complete',recoveryBody()));expect(response.status).toBe(503);
    expect(recoveryRecord(response).meta).toMatchObject({phase:"revocation",mutation_outcome:"acknowledged",category:"provider",upstream_status:503});
    expect(calls.slice(before).filter(c=>c==='PUT /user')).toHaveLength(1);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(await response.text()).not.toMatch(/wasn't changed|not changed/i);
  }finally{failRevocation=false;}
});
it("mount-level CSRF refusal has one reference without consuming the provider grant",async()=>{
  const before=calls.length;const request=req('/v1/auth/recovery/complete',recoveryBody());request.headers.delete('x-autobureau-request');
  const response=await complete(request);expect(response.status).toBe(403);
  expect(recoveryRecord(response).meta?.phase).toBe("request_validation");expect(calls).toHaveLength(before);
});
