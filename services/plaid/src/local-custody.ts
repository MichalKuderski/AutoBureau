import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export interface Binding {environment:'local-synthetic-sandbox';householdId:string;incarnationId:string;itemId:string;providerItemId:string;revision:number}
export interface Envelope {version:1;keyVersion:number;nonce:string;wrappedKey:string;wrapNonce:string;ciphertext:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function refuse():never {throw new Error('Local financial custody refused');}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)&&!Object.getOwnPropertyDescriptor(value,k)?.get);
}
function aad(binding:Binding):Buffer{
 if(!exact(binding,['environment','householdId','incarnationId','itemId','providerItemId','revision'])||binding.environment!=='local-synthetic-sandbox'
  ||!uuid.test(binding.householdId)||!uuid.test(binding.incarnationId)||!uuid.test(binding.itemId)||!/^public-fixture-item-[a-f0-9-]{36}$/.test(binding.providerItemId)
  ||!Number.isSafeInteger(binding.revision)||binding.revision<1)refuse();
 // Fixed-position JSON array is unambiguous; no arbitrary metadata/order dependence.
 return Buffer.from(JSON.stringify(['pellum-plaid-custody',1,binding.environment,binding.householdId,binding.incarnationId,binding.itemId,binding.providerItemId,binding.revision]));
}
function encrypt(key:Buffer,plain:Buffer,associated:Buffer){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(associated);const bytes=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);return{nonce:nonce.toString('base64url'),bytes:bytes.toString('base64url')};}
function bytes(text:unknown,min:number,max:number):Buffer{
 if(typeof text!=='string'||text.length>max*2||!/^[A-Za-z0-9_-]+$/.test(text))refuse();const b=Buffer.from(text,'base64url');if(b.length<min||b.length>max||b.toString('base64url')!==text)refuse();return b;
}
function decrypt(key:Buffer,value:string,nonce:string,associated:Buffer){const iv=bytes(nonce,12,12),sealed=bytes(value,17,4096),cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(associated);cipher.setAuthTag(sealed.subarray(-16));return Buffer.concat([cipher.update(sealed.subarray(0,-16)),cipher.final()]);}
/** Ephemeral LOCAL test seam only. No env, network, DB, logging or key persistence.
 * Real key custody/runtime grants require ADR-022 operational implementation.
 * Plaintext is available ONLY in the dedicated local callback, never returned by
 * open/reveal/export. JS cannot promise complete memory zeroization; disclose that. */
export function createLocalPlaidCustody(){
 const keys=new Map<number,Buffer>();let current=0,closed=false;
 function key(version:number){if(closed)refuse();const k=keys.get(version);if(!k)refuse();return k;}
 function rotateKey(){if(closed||keys.size>=4)refuse();keys.set(++current,randomBytes(32));return current;}
 rotateKey();
 function seal(binding:Binding,token:string):Readonly<Envelope>{
  if(typeof token!=='string'||!/^access-sandbox-PUBLIC_SYNTHETIC_[a-f0-9-]{36}$/.test(token))refuse();
  const context=aad(binding),dataKey=randomBytes(32),plain=Buffer.from(token);
  try{const body=encrypt(dataKey,plain,context),wrapped=encrypt(key(current),dataKey,Buffer.concat([context,Buffer.from(`:key:${current}`)]));return Object.freeze({version:1,keyVersion:current,nonce:body.nonce,wrappedKey:wrapped.bytes,wrapNonce:wrapped.nonce,ciphertext:body.bytes});}
  finally{dataKey.fill(0);plain.fill(0);}
 }
 function read(binding:Binding,envelope:Envelope){
  if(!exact(envelope,['version','keyVersion','nonce','wrappedKey','wrapNonce','ciphertext'])||envelope.version!==1||!Number.isSafeInteger(envelope.keyVersion))refuse();
  const context=aad(binding);let dataKey:Buffer|undefined;
  try{dataKey=decrypt(key(envelope.keyVersion),envelope.wrappedKey,envelope.wrapNonce,Buffer.concat([context,Buffer.from(`:key:${envelope.keyVersion}`)]));if(dataKey.length!==32)refuse();const plain=decrypt(dataKey,envelope.ciphertext,envelope.nonce,context);if(!/^access-sandbox-PUBLIC_SYNTHETIC_[a-f0-9-]{36}$/.test(plain.toString())){plain.fill(0);refuse();}return plain;}
  catch{refuse();}finally{dataKey?.fill(0);}
 }
 return Object.freeze({seal,rotateKey,
  // Void callback does not constitute a process sandbox: this runtime is trusted.
  use(binding:Binding,envelope:Envelope,operation:(token:string)=>void){const plain=read(binding,envelope);try{operation(plain.toString());}catch{refuse();}finally{plain.fill(0);}},
  rewrap(binding:Binding,envelope:Envelope){const plain=read(binding,envelope);try{return seal(binding,plain.toString());}finally{plain.fill(0);}},
  retire(version:number){if(version===current||!keys.has(version))refuse();keys.get(version)!.fill(0);keys.delete(version);},
  close(){for(const k of keys.values())k.fill(0);keys.clear();closed=true;},
 });
}
