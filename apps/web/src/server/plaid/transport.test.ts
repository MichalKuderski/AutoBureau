// @vitest-environment node
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PlaidError, type PlaidConfig } from "./errors";
import { createPlaidSandboxTransport, type PlaidSandboxRoute } from "./transport";
import { MAX_PROVIDER_RESPONSE_BYTES } from "../http/provider-body";
const config:PlaidConfig={clientId:'a'.repeat(24),secret:'synthetic_secret_not_real',scope:'stg'};
const routes:PlaidSandboxRoute[]=['/link/token/create','/item/public_token/exchange','/item/remove','/webhook_verification_key/get'];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const canary='PRIVATE_PROVIDER_CANARY';
const quiet=(code:string)=>(error:unknown)=>{assert.ok(error instanceof PlaidError);assert.equal(error.code,code);assert.equal('cause' in error,false);assert.ok(!String(error).includes(canary));assert.ok(!JSON.stringify(error).includes(canary));return true;};
describe('Plaid sandbox transport boundaries',()=>{
  for(const route of routes){
    it(`${route} can reach only the fixed Sandbox host, once`,async()=>{
      let calls=0;
      const fetchImpl:typeof fetch=async(url,init)=>{calls++;assert.equal(url,`https://sandbox.plaid.com${route}`);assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.ok(init?.signal instanceof AbortSignal);assert.equal((init?.headers as Record<string,string>)['PLAID-SECRET'],config.secret);assert.equal((init?.headers as Record<string,string>)['Plaid-Version'],'2020-09-14');return json({ok:true});};
      assert.deepEqual(await createPlaidSandboxTransport(config,fetchImpl)(route,{synthetic:true}),{ok:true});assert.equal(calls,1);
    });
    it(`${route} never repeats a 504 or waits for its error body`,async()=>{
      let calls=0,cancelled=false;
      const fetchImpl:typeof fetch=async()=>{calls++;return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;return new Promise<void>(()=>undefined);}}),{status:504});};
      await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)(route,{}),quiet('unavailable'));assert.equal(calls,1);assert.equal(cancelled,true);
    });
    it(`${route} bounds a stalled success body`,async()=>{
      let calls=0,cancelled=false;
      const fetchImpl:typeof fetch=async()=>{calls++;return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}));};
      await assert.rejects(createPlaidSandboxTransport(config,fetchImpl,20)(route,{}),quiet('unavailable'));assert.equal(calls,1);assert.equal(cancelled,true);
    });
  }
  for(const route of ['/transactions/sync','https://production.plaid.com/item/remove','/item/remove?env=production','/../item/remove','/item/remove#x']){
    it(`rejects non-allow-listed route ${route} before I/O`,async()=>{let calls=0;const fetchImpl:typeof fetch=async()=>{calls++;return json({});};await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)(route as PlaidSandboxRoute,{}),quiet('invalid'));assert.equal(calls,0);});
  }
  for(const invalid of [{...config,scope:'production'},{...config,clientId:'bad'},{...config,secret:''},{...config,secret:'secret with spaces'}]){
    it(`rejects invalid construction ${JSON.stringify({scope:invalid.scope,validId:invalid.clientId.length===24,secretLength:invalid.secret.length})}`,()=>assert.throws(()=>createPlaidSandboxTransport(invalid as PlaidConfig),quiet('unconfigured')));
  }
  it('keeps definite HTTP 429 as rate-limited even for an HTML body',async()=>{let cancelled=false;const fetchImpl:typeof fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:429});await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)('/item/remove',{}),quiet('rate-limited'));assert.equal(cancelled,true);});
  it('preserves the existing reconnect code on an account error',async()=>{const fetchImpl:typeof fetch=async()=>json({error_code:'ITEM_LOGIN_REQUIRED',private:canary},400);await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)('/item/remove',{}),quiet('reconnect'));});
  it('never turns a 5xx into an account reconnect requirement',async()=>{const fetchImpl:typeof fetch=async()=>json({error_code:'ITEM_LOGIN_REQUIRED'},503);await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)('/item/remove',{}),quiet('unavailable'));});
  for(const [name,response] of Object.entries({malformed:()=>new Response(canary),empty:()=>new Response(null,{status:204}),oversized:()=>json({padding:'a'.repeat(MAX_PROVIDER_RESPONSE_BYTES)}),utf8:()=>new Response(Uint8Array.of(34,255,34)),redirect:()=>new Response(null,{status:307}),error:()=>json({error_code:canary},400)})){
    it(`refuses ${name} response without leaking content`,async()=>{let calls=0;const fetchImpl:typeof fetch=async()=>{calls++;return response();};await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)('/item/remove',{}),quiet('unavailable'));assert.equal(calls,1);});
  }
  it('does not retain a transport exception as a cause',async()=>{const fetchImpl:typeof fetch=async()=>{throw new Error(canary);};await assert.rejects(createPlaidSandboxTransport(config,fetchImpl)('/item/remove',{}),quiet('unavailable'));});
  it('holds a snapshot of credentials rather than a mutable caller config',async()=>{const c={...config};const fetchImpl:typeof fetch=async(_url,init)=>{assert.equal((init?.headers as Record<string,string>)['PLAID-SECRET'],config.secret);return json({});};const post=createPlaidSandboxTransport(c,fetchImpl);c.secret='mutated';await post('/item/remove',{});});
});
