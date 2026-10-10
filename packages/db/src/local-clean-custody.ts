import { inspectCanonicalPdf } from "@autobureau/contracts";
import { constants,openSync,closeSync,fstatSync,fsyncSync,writeFileSync,readSync,lstatSync,realpathSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
interface Reference { householdId:string;objectId:string;sha256:string;size:number }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const refuse=():never=>{throw new Error("Local clean custody refused");};
/** Private LOCAL synthetic adapter. The filesystem broker is trusted and owns no
 * model transport. This is not cloud durability or an independent restore authority.
 * No filename, URI or arbitrary metadata is accepted. */
export function localCleanCustody(root:string){
 const validRoot=()=>{const s=lstatSync(root);if(!(root.startsWith('/private/tmp/pellum-clean-custody-')||root.startsWith('/tmp/pellum-clean-custody-'))||!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||realpathSync(root)!==root)refuse();};
 validRoot();
 const file=(r:Reference)=>{validRoot();if(!uuid.test(r.householdId)||!uuid.test(r.objectId)||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isInteger(r.size)||r.size<1||r.size>25*1024*1024)refuse();return join(root,`${r.householdId}.${r.objectId}`);};
 const verify=(r:Reference,b:Uint8Array)=>{if(b.byteLength!==r.size||createHash('sha256').update(b).digest('hex')!==r.sha256)refuse();};
 const sync=()=>{const fd=openSync(root,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
 const read=(r:Reference)=>{const fd=openSync(file(r),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size!==r.size||(s.mode&0o077))refuse();const b=Buffer.alloc(r.size+1),n=readSync(fd,b,0,b.length,0);if(n!==r.size)refuse();verify(r,b.subarray(0,n));return b.subarray(0,n);}finally{closeSync(fd);}};
 return Object.freeze({
  copy(r:Reference,bytes:Uint8Array){
   if(!(bytes instanceof Uint8Array)||bytes.byteLength>25*1024*1024||bytes.byteLength!==r.size)refuse();
   // This adapter deliberately accepts only public synthetic text or the exact canonical public PDF, never arbitrary files.
   if(!Buffer.from(bytes).toString('utf8').match(/^PUBLIC SYNTHETIC [a-f0-9-]{36}$/) && !inspectCanonicalPdf(bytes))refuse();verify(r,bytes);
   let fd:number;try{fd=openSync(file(r),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST'){read(r);return;}throw e;}
   try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}sync();read(r);
  },
  verify(r:Reference){read(r);return {scope:'local-synthetic' as const,exactBytes:true as const};},
  // Owner export only: bytes are returned after size/hash verification against the custody binding.
  readVerified(r:Reference){return Buffer.from(read(r));},
  remove(r:Reference){read(r);unlinkSync(file(r));sync();return {acknowledged:true as const,absenceProven:false as const};},
  observe(r:Reference){let path:string;try{path=file(r);}catch{return {state:'unknown' as const,finalReceiptIssuable:false as const};}
   try{const s=lstatSync(path);return {state:s.isFile()&&!s.isSymbolicLink()&&s.nlink===1?'remaining' as const:'unknown' as const,finalReceiptIssuable:false as const};}catch(e){return {state:(e as NodeJS.ErrnoException).code==='ENOENT'?'absent' as const:'unknown' as const,finalReceiptIssuable:false as const};}},
 });
}
