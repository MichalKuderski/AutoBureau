import { createHash,randomUUID,verify,type KeyObject } from "node:crypto";
import { RestoreAuthorityResponseSchema,RestoreSubjectSchema,type RestoreAuthorityResponse } from "@autobureau/contracts";

export interface RestoreCheckpoint {
 /** MUST be outside the restored DB. Atomically refuse a lower sequence or a
  * different root at the same sequence, or deleted-to-active subject resurrection.
  * Persist accepted tombstones atomically with the checkpoint, across generations.
  * Failure/unavailability must throw/refuse.
  * Hosted custody, authentication and durability are not implemented here. */
 advance(value:Readonly<{authority:string;generation:string;sequence:number;ledgerDigest:string;subjects:ReadonlyArray<Readonly<{scope:"account"|"household";id:string;state:"active"|"deleted"|"unknown"}>>}>,signal:AbortSignal):Promise<boolean>;
}
const deny=()=>{throw new Error("Independent restore authority refused");};
const subjectKey=(s:{scope:string;id:string})=>`${s.scope}:${s.id}`;
export function canonicalRestoreStatement(body:RestoreAuthorityResponse["body"]):Buffer {
 const checked=RestoreAuthorityResponseSchema.shape.body.parse(body);
 return Buffer.from("pellum-restore-authority/v1\n"+JSON.stringify(checked));
}
/** ADR-019 proposed authority seam. Local cryptographic verification only; no
 * network or signing secret, and no code path enables restored data serving.
 * Signature authenticates the authority's statement, not provider/backup expiry. */
export function createRestoreAuthorityVerifier(publicKey:KeyObject,generation:string,checkpoint:RestoreCheckpoint,clock:()=>number=Date.now){
 if(publicKey.type!=="public"||publicKey.asymmetricKeyType!=="ed25519"||!RestoreSubjectSchema.shape.id.safeParse(generation).success)deny();
 const authority=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
 const pending=new Map<string,{issuedAt:number;subjects:string[]}>();
 return Object.freeze({
  authority,
  challenge(input:unknown){
   if(!Array.isArray(input)||input.length<1||input.length>100)return deny();
   const parsed=RestoreSubjectSchema.array().min(1).max(100).safeParse(input);
   if(!parsed.success)return deny();
   const subjects=parsed.data.map(x=>({...x,id:x.id.toLowerCase()})).sort((a,b)=>subjectKey(a).localeCompare(subjectKey(b)));
   if(new Set(subjects.map(subjectKey)).size!==subjects.length)return deny();
   const issuedAt=clock();if(!Number.isSafeInteger(issuedAt)||issuedAt<0)return deny();
   for(const [id,p]of pending)if(p.issuedAt+300_000<=issuedAt)pending.delete(id);
   if(pending.size>=100)return deny();
   const challenge=randomUUID();pending.set(challenge,{issuedAt,subjects:subjects.map(subjectKey)});
   return Object.freeze({challenge,authority,generation,subjects,issuedAt,expiresAt:issuedAt+300_000});
  },
  async reconcile(input:unknown){
   // Zod's array maximum is a validity check, not a work bound: reject the
   // collection length BEFORE schema traversal of each untrusted element.
   if(!input||typeof input!=="object"||!("body" in input)||!input.body||typeof input.body!=="object"||!("subjects" in input.body)
    ||!Array.isArray(input.body.subjects)||input.body.subjects.length<1||input.body.subjects.length>100)return deny();
   const parsed=RestoreAuthorityResponseSchema.safeParse(input);if(!parsed.success)return deny();
   const {body,signature}=parsed.data,p=pending.get(body.challenge),now=clock();
   // Consume before an asynchronous checkpoint operation: concurrent reuse cannot
   // authorize two decisions. On any later failure a fresh challenge is required.
   pending.delete(body.challenge);
   if(!p||body.authority!==authority||body.generation!==generation||!Number.isSafeInteger(now)||now<p.issuedAt
    ||body.issuedAt<p.issuedAt||body.issuedAt>now||body.expiresAt<=now||body.expiresAt>p.issuedAt+300_000
    ||body.expiresAt<=body.issuedAt||body.subjects.some(s=>s.state==="unknown")
    ||JSON.stringify(body.subjects.map(subjectKey))!==JSON.stringify(p.subjects))return deny();
   if(!verify(null,canonicalRestoreStatement(body),publicKey,Buffer.from(signature,"base64url")))return deny();
   let advanced:boolean;
   const controller=new AbortController();
   let timer:ReturnType<typeof setTimeout>|undefined;
   const expired=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error("Checkpoint deadline"));},5_000);timer.unref();
   });
   // A port cannot mutate the verified statement. Abort is advisory; the race also
   // refuses a port that ignores it. A late checkpoint commit is ambiguous and is
   // never automatically retried. Its durable monotonic state must be reconciled.
   const checkpointValue=Object.freeze({authority,generation,sequence:body.sequence,ledgerDigest:body.ledgerDigest,
    subjects:Object.freeze(body.subjects.map(s=>Object.freeze({...s})))});
   try{advanced=await Promise.race([checkpoint.advance(checkpointValue,controller.signal),expired]);}
   catch{return deny();}finally{clearTimeout(timer);}
   const completedAt=clock();
   if(!Number.isSafeInteger(completedAt)||completedAt<now||completedAt>=body.expiresAt)return deny();
   if(advanced!==true)return deny();
   return Object.freeze({reconciliationAuthorized:true,activationAllowed:false,providerAndBackupProof:false,
    mustFence:body.subjects.filter(s=>s.state==="deleted").map(s=>Object.freeze({scope:s.scope,id:s.id})),
    audit:Object.freeze({version:1,sequence:body.sequence,subjectCount:body.subjects.length,deletedCount:body.subjects.filter(s=>s.state==="deleted").length})});
  },
 });
}
