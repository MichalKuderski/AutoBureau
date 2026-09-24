import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

/* Production-shaped custody seam for ADR-022 (NOT evidence of any KMS). Data keys come
 * from an injected key-management port (for example AWS KMS GenerateDataKey/Decrypt);
 * the complete Item binding is the port's encryption context, so a wrapped key copied to
 * another household/Item/revision cannot be unwrapped by the service. The plaintext data
 * key exists only for one seal/open and is zeroed. The port is the only I/O; it is
 * injected, never constructed from environment, and its errors never escape.
 * Persisting this envelope needs a reviewed schema amendment: the current credential
 * table pins the local 64-character wrapped-key format (see ADR-022 amendment). */
export interface KmsBinding {environment:'local-synthetic-sandbox'|'sandbox';householdId:string;incarnationId:string;itemId:string;providerItemId:string;revision:number}
export interface KmsPort {
 generateDataKey(input:{keyId:string;encryptionContext:Readonly<Record<string,string>>}):Promise<{plaintext:Uint8Array;ciphertext:Uint8Array;keyId:string}>;
 decrypt(input:{keyId:string;ciphertext:Uint8Array;encryptionContext:Readonly<Record<string,string>>}):Promise<{plaintext:Uint8Array;keyId:string}>;
}
export interface KmsEnvelope {version:2;keyId:string;wrappedKey:string;nonce:string;ciphertext:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const keyIdGrammar=/^[A-Za-z0-9:/_.-]{1,256}$/;
function refuse():never{throw new Error('Financial custody refused');}
function context(b:KmsBinding):Readonly<Record<string,string>>{
 const keys=['environment','householdId','incarnationId','itemId','providerItemId','revision'];
 if(!b||typeof b!=='object'||Object.keys(b).sort().join()!==[...keys].sort().join()||!['local-synthetic-sandbox','sandbox'].includes(b.environment)
  ||![b.householdId,b.incarnationId,b.itemId].every(v=>uuid.test(v))||typeof b.providerItemId!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(b.providerItemId)
  ||!Number.isSafeInteger(b.revision)||b.revision<1)refuse();
 return Object.freeze({purpose:'pellum-financial-custody',version:'2',environment:b.environment,household:b.householdId,incarnation:b.incarnationId,item:b.itemId,providerItem:b.providerItemId,revision:String(b.revision)});
}
const aad=(c:Readonly<Record<string,string>>)=>Buffer.from(JSON.stringify(Object.keys(c).sort().map(k=>[k,c[k]])));
const b64=(v:Uint8Array)=>Buffer.from(v).toString('base64url');
function bytes(text:unknown,min:number,max:number){if(typeof text!=='string'||!/^[A-Za-z0-9_-]+$/.test(text))refuse();const b=Buffer.from(text,'base64url');if(b.length<min||b.length>max||b.toString('base64url')!==text)refuse();return b;}
const TOKEN=/^access-(sandbox|development)-[A-Za-z0-9_-]{8,200}$/;

export function createKmsCustody(port:KmsPort,keyId:string,deadlineMs=5000){
 if(!keyIdGrammar.test(keyId)||!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>10_000)refuse();
 // Single attempt, bounded: an ambiguous KMS call is refused, never retried here.
 const bounded=async<T>(p:Promise<T>)=>{let t:NodeJS.Timeout|undefined;try{return await Promise.race([p,new Promise<never>((_,r)=>{t=setTimeout(()=>r(new Error('deadline')),deadlineMs);})]);}catch{refuse();}finally{if(t)clearTimeout(t);}};
 async function seal(binding:KmsBinding,token:string):Promise<Readonly<KmsEnvelope>>{
  const ctx=context(binding);if(typeof token!=='string'||!TOKEN.test(token))refuse();
  const key=await bounded(port.generateDataKey({keyId,encryptionContext:ctx}));
  const dataKey=Buffer.from(key.plaintext),plain=Buffer.from(token);
  try{
   if(dataKey.length!==32||key.keyId!==keyId||key.ciphertext.byteLength<16||key.ciphertext.byteLength>1024)refuse();
   const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',dataKey,nonce);c.setAAD(aad(ctx));
   const sealed=Buffer.concat([c.update(plain),c.final(),c.getAuthTag()]);
   return Object.freeze({version:2 as const,keyId,wrappedKey:b64(key.ciphertext),nonce:b64(nonce),ciphertext:b64(sealed)});
  }finally{dataKey.fill(0);plain.fill(0);if(key.plaintext instanceof Uint8Array)key.plaintext.fill(0);}
 }
 async function open(binding:KmsBinding,e:KmsEnvelope){
  const ctx=context(binding);
  if(!e||e.version!==2||e.keyId!==keyId||Object.keys(e).sort().join()!=='ciphertext,keyId,nonce,version,wrappedKey')refuse();
  const unwrapped=await bounded(port.decrypt({keyId,ciphertext:bytes(e.wrappedKey,16,1024),encryptionContext:ctx}));
  const dataKey=Buffer.from(unwrapped.plaintext);
  try{
   if(dataKey.length!==32||unwrapped.keyId!==keyId)refuse();
   const sealed=bytes(e.ciphertext,17,4096),d=createDecipheriv('aes-256-gcm',dataKey,bytes(e.nonce,12,12));d.setAAD(aad(ctx));d.setAuthTag(sealed.subarray(-16));
   const plain=Buffer.concat([d.update(sealed.subarray(0,-16)),d.final()]);
   if(!TOKEN.test(plain.toString())){plain.fill(0);refuse();}
   return plain;
  }catch{refuse();}finally{dataKey.fill(0);if(unwrapped.plaintext instanceof Uint8Array)unwrapped.plaintext.fill(0);}
 }
 return Object.freeze({seal,
  async useAsync<T>(binding:KmsBinding,e:KmsEnvelope,operation:(token:string)=>Promise<T>):Promise<T>{
   const plain=await open(binding,e),token=plain.toString();
   try{const result=await operation(token);if(JSON.stringify(result??null).includes(token))refuse();return result;}catch{refuse();}finally{plain.fill(0);}
  },
  /** Compare-and-swap rotation target: re-seal under revision+1 (fresh data key). */
  async rewrap(binding:KmsBinding,e:KmsEnvelope,nextRevision:number){
   if(nextRevision!==binding.revision+1)refuse();
   const plain=await open(binding,e);try{return await seal({...binding,revision:nextRevision},plain.toString());}finally{plain.fill(0);}
  },
 });
}
