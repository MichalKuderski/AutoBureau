// @vitest-environment node
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "vitest";
import { createGoTrueProvider, ProviderError } from "./provider";
import type { AuthConfig } from "./config";
import { MAX_PROVIDER_RESPONSE_BYTES } from "./provider-body";
const id='11111111-1111-4111-8111-111111111111';
const config:AuthConfig={issuer:'https://auth.example.test',audience:'autobureau',jwks:{uri:'https://auth.example.test/jwks.json'},cookieName:'ab_session',refreshCookieName:'ab_session_refresh',apiUrl:'https://auth.example.test',anonKey:'synthetic-anon-key',allowedOrigins:['https://app.autobureau.test'],algorithms:['RS256']};

async function wire(handler:(res:ServerResponse, later:(fn:()=>void,ms:number)=>void)=>void, check:(apiUrl:string)=>Promise<void>){
  let calls=0;
  const timers:ReturnType<typeof setTimeout>[]=[];
  const server=createServer((req,res)=>{calls++;req.resume();handler(res,(fn,ms)=>{timers.push(setTimeout(fn,ms));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);assert.equal(calls,1);}
  finally{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}

describe('actual loopback HTTP provider responses, not a fetch stub',()=>{
  for(const [name,body] of [['HTML','<html>PRIVATE_CANARY</html>'],['truncated JSON','{"access_token":'],['oversized JSON',JSON.stringify({id,padding:'a'.repeat(MAX_PROVIDER_RESPONSE_BYTES)})]] as const){
    it(`refuses ${name} after real HTTP 200`,async()=>wire(res=>{res.writeHead(200,{'content-type':'application/json'});res.end(body);},async apiUrl=>{
      await assert.rejects(createGoTrueProvider({...config,apiUrl}).signUp('synthetic@example.test','synthetic-pass','Synthetic'),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.reason,'unavailable');assert.equal(error.httpStatus,200);assert.equal(error.diagnostics?.failure,'invalid-response');assert.ok(!String(error).includes('PRIVATE_CANARY'));return true;});
    }));
  }
  it('reports an actual gateway HTTP 504, not a local deadline',async()=>wire(res=>{res.writeHead(504,{'sb-request-id':id});res.end('PRIVATE_CANARY');},async apiUrl=>{
    await assert.rejects(createGoTrueProvider({...config,apiUrl}).refresh('synthetic-token'),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.httpStatus,504);assert.equal(error.diagnostics?.failure,'http');assert.equal(error.diagnostics?.requestId,id);return true;});
  }));
  it('bounds an HTTP body that stalls after sending 200 headers',async()=>wire(res=>{res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();res.write('{');},async apiUrl=>{
    await assert.rejects(createGoTrueProvider({...config,apiUrl},fetch,120).signUp('synthetic@example.test','synthetic-pass','Synthetic'),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.reason,'unavailable');assert.equal(error.diagnostics?.failure,'timeout');return true;});
  }));
  it('uses one deadline for headers AND body, not a fresh timeout per phase',async()=>wire((res,later)=>{later(()=>{res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();later(()=>res.end(JSON.stringify({id})),180);},70);},async apiUrl=>{
    await assert.rejects(createGoTrueProvider({...config,apiUrl},fetch,160).signUp('synthetic@example.test','synthetic-pass','Synthetic'),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.reason,'unavailable');assert.equal(error.diagnostics?.failure,'timeout');return true;});
  }));
  it('accepts a genuine pending-user body over actual HTTP',async()=>wire(res=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id,identities:[]}));},async apiUrl=>{
    assert.deepEqual(await createGoTrueProvider({...config,apiUrl}).signUp('synthetic@example.test','synthetic-pass','Synthetic'),{kind:'confirmation-required'});
  }));
  it('returns only parsed session fields over actual HTTP',async()=>wire(res=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({access_token:'at',refresh_token:'rt',expires_in:3600,extra:'PRIVATE_CANARY'}));},async apiUrl=>{
    assert.deepEqual(await createGoTrueProvider({...config,apiUrl}).signInWithPassword('synthetic@example.test','synthetic-pass'),{accessToken:'at',refreshToken:'rt',expiresIn:3600});
  }));
});
