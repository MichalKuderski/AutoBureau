import { generateKeyPairSync,randomUUID,sign } from "node:crypto";
import { expect,it,vi } from "vitest";
import { createRestoreAuthorityVerifier,canonicalRestoreStatement,type RestoreCheckpoint } from "../../src/restore-authority.js";
import type { RestoreAuthorityResponse } from "@autobureau/contracts";
const pair=generateKeyPairSync("ed25519"),other=generateKeyPairSync("ed25519");
function setup(){
 let now=1_790_000_000_000,stored:{sequence:number;ledgerDigest:string}|undefined;
 const generation=randomUUID(),deleted=new Set<string>();
 const advance=vi.fn<RestoreCheckpoint["advance"]>(async value=>{
  if(stored&&(value.sequence<stored.sequence||(value.sequence===stored.sequence&&value.ledgerDigest!==stored.ledgerDigest)))return false;
  if(value.subjects.some(s=>s.state!=="deleted"&&deleted.has(`${s.scope}:${s.id}`)))return false;
  for(const s of value.subjects)if(s.state==="deleted")deleted.add(`${s.scope}:${s.id}`);
  stored={sequence:value.sequence,ledgerDigest:value.ledgerDigest};return true;
 });
 const verifier=createRestoreAuthorityVerifier(pair.publicKey,generation,{advance},()=>now);
 const subjects=[{scope:"household" as const,id:randomUUID()},{scope:"account" as const,id:randomUUID()}];
 function response(change:Partial<RestoreAuthorityResponse["body"]>={},key=pair.privateKey){
  const c=verifier.challenge(subjects);
  const body={version:1 as const,...c,sequence:2,ledgerDigest:"a".repeat(64),subjects:c.subjects.map(s=>({...s,state:"deleted" as const})),...change};
  return {body,signature:sign(null,canonicalRestoreStatement(body),key).toString("base64url")};
 }
 return {verifier,subjects,response,advance,time:(n:number)=>{now+=n;}};
}
it("authenticates exact account/household tombstones but never enables restored serving",async()=>{
 const s=setup(),r=await s.verifier.reconcile(s.response());expect(r.mustFence).toHaveLength(2);expect(r).toMatchObject({reconciliationAuthorized:true,activationAllowed:false,providerAndBackupProof:false});
 expect(Object.keys(r.audit).sort()).toEqual(["deletedCount","sequence","subjectCount","version"]);
});
it("refuses a different signer's otherwise valid statement",async()=>{
 const s=setup();await expect(s.verifier.reconcile(s.response({},other.privateKey))).rejects.toThrow("refused");expect(s.advance).not.toHaveBeenCalled();
});
it("refuses altered signed states",async()=>{const s=setup(),v=s.response();v.body.subjects[0]!.state="active" as never;await expect(s.verifier.reconcile(v)).rejects.toThrow();});
it("consumes a challenge once, including concurrent replay",async()=>{
 const s=setup(),v=s.response(),r=await Promise.allSettled([s.verifier.reconcile(v),s.verifier.reconcile(v)]);expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(s.advance).toHaveBeenCalledTimes(1);
});
it.each(["generation","authority","challenge","unknown","missing","extra","order"])("refuses %s scope/version drift before checkpointing",async mode=>{
 const s=setup(),v=s.response();
 if(mode==="generation")v.body.generation=randomUUID();if(mode==="authority")v.body.authority="b".repeat(64);if(mode==="challenge")v.body.challenge=randomUUID();
 if(mode==="unknown")v.body.subjects[0]!.state="unknown" as never;if(mode==="missing")v.body.subjects.pop();
 if(mode==="extra")v.body.subjects.push({...v.body.subjects[0]!,id:randomUUID()});if(mode==="order")v.body.subjects.reverse();
 v.signature=sign(null,canonicalRestoreStatement(v.body),pair.privateKey).toString("base64url");
 await expect(s.verifier.reconcile(v)).rejects.toThrow();expect(s.advance).not.toHaveBeenCalled();
});
it("refuses expired or future-dated attestations",async()=>{
 const s=setup(),v=s.response();s.time(300_001);await expect(s.verifier.reconcile(v)).rejects.toThrow();
 const w=s.response();w.body.issuedAt+=100;w.signature=sign(null,canonicalRestoreStatement(w.body),pair.privateKey).toString("base64url");await expect(s.verifier.reconcile(w)).rejects.toThrow();
});
it("refuses clock rollback instead of reviving a challenge",async()=>{const s=setup(),v=s.response();s.time(-1);await expect(s.verifier.reconcile(v)).rejects.toThrow();});
it("requires the independent checkpoint and rejects older versions/equivocation",async()=>{
 const s=setup();await s.verifier.reconcile(s.response());
 await expect(s.verifier.reconcile(s.response({sequence:1}))).rejects.toThrow();
 await expect(s.verifier.reconcile(s.response({ledgerDigest:"c".repeat(64)}))).rejects.toThrow();
 await expect(s.verifier.reconcile(s.response({sequence:3,ledgerDigest:"c".repeat(64)}))).resolves.toMatchObject({activationAllowed:false});
});
it("fails closed if the checkpoint service is unavailable and does not retry",async()=>{
 const s=setup();s.advance.mockRejectedValueOnce(new Error("private provider detail"));const v=s.response();await expect(s.verifier.reconcile(v)).rejects.toThrow("Independent restore authority refused");
 await expect(s.verifier.reconcile(v)).rejects.toThrow();expect(s.advance).toHaveBeenCalledTimes(1);
});
it("refuses unknown payload fields, duplicate subjects and excessive challenge state",async()=>{
 const s=setup(),v=s.response();await expect(s.verifier.reconcile({...v,metadata:"PRIVATE"})).rejects.toThrow();
 expect(()=>s.verifier.challenge([s.subjects[0],s.subjects[0]])).toThrow();
 for(let n=1;n<100;n++)s.verifier.challenge(s.subjects);
 expect(()=>s.verifier.challenge(s.subjects)).toThrow();s.time(300_001);expect(()=>s.verifier.challenge(s.subjects)).not.toThrow();
});
it("refuses private and foreign-algorithm trust keys",()=>{
 expect(()=>createRestoreAuthorityVerifier(pair.privateKey,randomUUID(),{advance:async()=>true})).toThrow();
 const rsa=generateKeyPairSync("rsa",{modulusLength:2048});expect(()=>createRestoreAuthorityVerifier(rsa.publicKey,randomUUID(),{advance:async()=>true})).toThrow();
});

it("requires an exact boolean checkpoint acknowledgement",async()=>{
 const s=setup();s.advance.mockResolvedValueOnce("yes" as never);await expect(s.verifier.reconcile(s.response())).rejects.toThrow("refused");
});

it("refuses resurrection even in a freshly signed higher-sequence statement",async()=>{
 const s=setup();await s.verifier.reconcile(s.response());
 const v=s.response({sequence:3,ledgerDigest:"b".repeat(64)});v.body.subjects[0]!.state="active" as never;
 v.signature=sign(null,canonicalRestoreStatement(v.body),pair.privateKey).toString("base64url");
 await expect(s.verifier.reconcile(v)).rejects.toThrow("refused");
});

it("bounds an unresponsive checkpoint without retrying an ambiguous advance",async()=>{
 vi.useFakeTimers();
 try{
  const s=setup();let finish:(value:boolean)=>void=()=>{};
  s.advance.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const value=s.response(),pending=s.verifier.reconcile(value);
  const assertion=expect(pending).rejects.toThrow("Independent restore authority refused");
  await vi.advanceTimersByTimeAsync(5_000);await assertion;
  expect(s.advance).toHaveBeenCalledTimes(1);expect(s.advance.mock.calls[0]![1].aborted).toBe(true);
  finish(true);await expect(s.verifier.reconcile(value)).rejects.toThrow();
  expect(s.advance).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it("refuses a statement that expires during checkpoint commit",async()=>{
 const s=setup();s.advance.mockImplementationOnce(async()=>{s.time(300_000);return true;});
 await expect(s.verifier.reconcile(s.response())).rejects.toThrow();
});
it("does not allow a checkpoint port to mutate the signed subject decisions",async()=>{
 const s=setup();s.advance.mockImplementationOnce(async v=>{(v.subjects[0] as {state:string}).state="active";return true;});
 await expect(s.verifier.reconcile(s.response())).rejects.toThrow();
});

it("does not echo malformed subject content in challenge errors",()=>{
 const s=setup();expect(()=>s.verifier.challenge([{scope:"PRIVATE_INVALID_SUBJECT",id:randomUUID()}])).toThrowError(/^Independent restore authority refused$/);
});

it("refuses oversized subject collections before traversing their elements",async()=>{
 const s=setup(),subjects=new Array(101);
 Object.defineProperty(subjects,0,{get(){throw new Error("Element must not be read");}});
 expect(()=>s.verifier.challenge(subjects)).toThrowError(/^Independent restore authority refused$/);
 const v=s.response();v.body.subjects=subjects;
 await expect(s.verifier.reconcile(v)).rejects.toThrowError(/^Independent restore authority refused$/);
});
