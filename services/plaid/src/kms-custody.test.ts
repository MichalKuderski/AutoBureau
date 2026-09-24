import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {it,expect,describe} from 'vitest';
import {createKmsCustody,type KmsBinding,type KmsPort} from './kms-custody.js';

/* Fake KMS with the real contract that matters: the wrapped key only unwraps under the
 * identical key ID and encryption context. This is a test double, not KMS evidence. */
function fakeKms(){const master=randomBytes(32);let calls=0;
 const ctx=(c:Readonly<Record<string,string>>)=>Buffer.from(JSON.stringify(Object.keys(c).sort().map(k=>[k,c[k]])));
 const port:KmsPort&{calls:()=>number;fail?:boolean}={
  async generateDataKey({keyId,encryptionContext}){calls++;const pt=randomBytes(32),n=randomBytes(12),c=createCipheriv('aes-256-gcm',master,n);c.setAAD(Buffer.concat([Buffer.from(keyId),ctx(encryptionContext)]));
   return{plaintext:Uint8Array.from(pt),ciphertext:Buffer.concat([n,c.update(pt),c.final(),c.getAuthTag()]),keyId};},
  async decrypt({keyId,ciphertext,encryptionContext}){calls++;if(port.fail)throw new Error('AccessDenied: arn:aws:kms:private-detail');const b=Buffer.from(ciphertext),d=createDecipheriv('aes-256-gcm',master,b.subarray(0,12));
   d.setAAD(Buffer.concat([Buffer.from(keyId),ctx(encryptionContext)]));d.setAuthTag(b.subarray(-16));return{plaintext:Uint8Array.from(Buffer.concat([d.update(b.subarray(12,-16)),d.final()])),keyId};},
  calls:()=>calls};
 return port;}
const binding=():KmsBinding=>({environment:'sandbox',householdId:randomUUID(),incarnationId:randomUUID(),itemId:randomUUID(),providerItemId:'item-'+randomUUID().replace(/-/g,''),revision:1});
const token=()=>'access-sandbox-'+randomUUID();
const KEY='alias/pellum-financial-custody-test';

describe('KMS-shaped financial custody seam',()=>{
 it('seals with a fresh KMS data key bound to the full Item context and opens only inside the operation',async()=>{
  const kms=fakeKms(),c=createKmsCustody(kms,KEY),b=binding(),t=token(),e=await c.seal(b,t);
  expect(JSON.stringify(e)).not.toContain(t);expect(e).toMatchObject({version:2,keyId:KEY});
  expect(await c.useAsync(b,e,async v=>{expect(v).toBe(t);return 'ok';})).toBe('ok');
 });
 it.each(['householdId','incarnationId','itemId','providerItemId','revision','environment'] as const)('a wrapped key transplanted across %s cannot be unwrapped',async field=>{
  const kms=fakeKms(),c=createKmsCustody(kms,KEY),b=binding(),e=await c.seal(b,token());
  const moved={...b,[field]:field==='revision'?2:field==='environment'?'local-synthetic-sandbox':field==='providerItemId'?'item-other':randomUUID()};
  let called=false;await expect(c.useAsync(moved as KmsBinding,e,async()=>{called=true;})).rejects.toThrow('Financial custody refused');expect(called).toBe(false);
 });
 it('refuses a different key ID, corrupted envelopes, echoed tokens and non-token plaintext',async()=>{
  const kms=fakeKms(),c=createKmsCustody(kms,KEY),b=binding(),t=token(),e=await c.seal(b,t);
  await expect(createKmsCustody(kms,'alias/other').useAsync(b,e,async()=>1)).rejects.toThrow();
  for(const k of ['wrappedKey','nonce','ciphertext'] as const){const bad={...e,[k]:e[k].slice(0,-2)+(e[k].endsWith('A')?'BA':'AA')};await expect(c.useAsync(b,bad,async()=>1)).rejects.toThrow();}
  await expect(c.useAsync(b,e,async v=>({v}))).rejects.toThrow();
  await expect(c.seal(b,'not-a-token')).rejects.toThrow();
 });
 it('never leaks provider error text and makes exactly one bounded attempt',async()=>{
  const kms=fakeKms(),c=createKmsCustody(kms,KEY),b=binding(),e=await c.seal(b,token());kms.fail=true;const before=kms.calls();
  const failure=await c.useAsync(b,e,async()=>1).catch(x=>x as Error);expect(String(failure)).not.toMatch(/arn|AccessDenied/);expect(kms.calls()-before).toBe(1);
  const slow=createKmsCustody({generateDataKey:()=>new Promise(()=>undefined),decrypt:()=>new Promise(()=>undefined)},KEY,100);
  await expect(slow.seal(b,token())).rejects.toThrow('Financial custody refused');
 });
 it('rotation re-seals to exactly the next revision with a fresh data key',async()=>{
  const kms=fakeKms(),c=createKmsCustody(kms,KEY),b=binding(),t=token(),e=await c.seal(b,t);
  await expect(c.rewrap(b,e,3)).rejects.toThrow();
  const next=await c.rewrap(b,e,2);expect(next.wrappedKey).not.toBe(e.wrappedKey);
  expect(await c.useAsync({...b,revision:2},next,async v=>v===t)).toBe(true);
  await expect(c.useAsync(b,next,async()=>1)).rejects.toThrow();
 });
});
