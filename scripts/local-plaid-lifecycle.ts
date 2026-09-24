import {createHash} from 'node:crypto';
import type {Database} from '../packages/db/src/scoped.js';
import {acceptLocalPlaidWebhook,claimLocalPlaidOperation,commitLocalPlaidSync,releaseLocalPlaidSync,completeLocalPlaidRemoval,completeLocalPlaidReconcile,
 commitLocalPlaidRotation,type LocalPlaidSyncPage,type VerifiedLocalPlaidNotice} from '../packages/db/src/plaid-local-lifecycle.js';
import type {PlaidCredentialEnvelope,LocalPlaidEnvelope} from '../packages/db/src/plaid-local-exchange.js';
import {createLocalPlaidCustody} from '../services/plaid/src/local-custody.js';

/** Local deterministic composition of the isolated financial runtime. Never mounted or
 * imported by the application. Fixture adapters are injected: no SDK, env, credentials
 * or network. Every provider call runs BETWEEN transactions, under a DB-time lease. */
type Keyring=ReturnType<typeof createLocalPlaidCustody>;
/** Closed provider signals. Adapters raise these; nothing else about an error survives. */
export class LocalPlaidProviderSignal extends Error {
 constructor(readonly signal:'login-required'|'revoked'|'mutation-during-pagination'|'item-not-found'|'unavailable'){super('Local financial provider signal');}
}
const signalOf=(e:unknown)=>e instanceof LocalPlaidProviderSignal?e.signal:'unavailable' as const;
function refuse():never{throw new Error('Local financial operation refused');}
/** This composition holds only the local synthetic keyring: a KMS-shaped v2 envelope needs the
 * separately configured KMS custody and is refused here, never guessed at. */
const v1=(e:PlaidCredentialEnvelope):LocalPlaidEnvelope=>e.version===1?e:refuse();

/** Raw bytes + signature header in; only the verified closed notice and its body digest
 * reach the database. Same acknowledgement whether or not the Item is known here. */
export async function runLocalPlaidWebhook(db:Database,verify:(raw:Uint8Array,header:string|null)=>Promise<VerifiedLocalPlaidNotice>,raw:Uint8Array,header:string|null){
 const notice=await verify(raw,header);
 await acceptLocalPlaidWebhook(db,notice,createHash('sha256').update(raw).digest('hex'));
 return{acknowledged:true as const};
}

/** Bounded pagination with Plaid's documented restart-from-original-cursor on mutation.
 * The READ retry budget is separate from (and never applies to) credential operations.
 * Exhaustion or failure leaves cursor and data unchanged. */
export async function runLocalPlaidSync(db:Database,hh:string,itemId:string,keyring:Keyring,
 provider:{sync:(token:string,cursor:string|null)=>Promise<LocalPlaidSyncPage>},budget={pages:8,restarts:3}){
 const claim=await claimLocalPlaidOperation(db,hh,itemId,'sync');if(!claim)return{status:'not-claimable' as const};
 const collected=await keyring.useAsync(claim.binding,v1(claim.envelope),async token=>{
  for(let restart=0;restart<=budget.restarts;restart++){
   const pages:LocalPlaidSyncPage[]=[];let cursor=claim.cursor;
   try{
    for(let n=0;n<budget.pages;n++){const page=await provider.sync(token,cursor);pages.push(page);cursor=page.nextCursor;if(!page.hasMore)return{ok:true as const,pages};}
    return{ok:false as const,outcome:'exhausted' as const};
   }catch(e){const s=signalOf(e);if(s==='mutation-during-pagination')continue;
    return{ok:false as const,outcome:s==='login-required'||s==='revoked'?s:'unavailable' as const};}
  }
  return{ok:false as const,outcome:'exhausted' as const};
 }).catch(()=>({ok:false as const,outcome:'unavailable' as const}));
 if(!collected.ok)return{status:'released' as const,...await releaseLocalPlaidSync(db,claim,collected.outcome)};
 return{status:'committed' as const,...await commitLocalPlaidSync(db,claim,collected.pages)};
}

/** Exactly one provider removal attempt. Unknown outcome is recorded as indeterminate and
 * keeps encrypted custody for reconciliation; it is never retried automatically. */
export async function runLocalPlaidRemoval(db:Database,hh:string,itemId:string,keyring:Keyring,provider:{remove:(token:string)=>Promise<void>}){
 const claim=await claimLocalPlaidOperation(db,hh,itemId,'remove');if(!claim)return{status:'not-claimable' as const};
 const outcome=await keyring.useAsync(claim.binding,v1(claim.envelope),async token=>{
  try{await provider.remove(token);return'provider-acknowledged' as const;}
  catch(e){return signalOf(e)==='item-not-found'?'provider-invalid' as const:'indeterminate' as const;}
 }).catch(()=>'indeterminate' as const);
 return{status:'recorded' as const,...await completeLocalPlaidRemoval(db,claim,outcome)};
}

/** Non-mutating status read after an indeterminate removal. */
export async function runLocalPlaidReconcile(db:Database,hh:string,itemId:string,keyring:Keyring,provider:{status:(token:string)=>Promise<'present'>}){
 const claim=await claimLocalPlaidOperation(db,hh,itemId,'reconcile');if(!claim)return{status:'not-claimable' as const};
 const outcome=await keyring.useAsync(claim.binding,v1(claim.envelope),async token=>{
  try{await provider.status(token);return'present' as const;}catch(e){return signalOf(e)==='item-not-found'?'absent' as const:null;}
 }).catch(()=>null);
 // An unavailable read establishes nothing; the lease simply expires with no change.
 if(outcome===null)return{status:'unresolved' as const};
 return{status:'recorded' as const,...await completeLocalPlaidReconcile(db,claim,outcome)};
}

/** Envelope rotation to the keyring's current wrapping key, compare-and-swap on revision. */
export async function runLocalPlaidRotation(db:Database,hh:string,itemId:string,keyring:Keyring){
 const claim=await claimLocalPlaidOperation(db,hh,itemId,'rotate');if(!claim)return{status:'not-claimable' as const};
 let envelope;try{envelope=keyring.rewrap(claim.binding,v1(claim.envelope),claim.credentialRevision+1);}catch{refuse();}
 return{status:'rotated' as const,...await commitLocalPlaidRotation(db,claim,envelope)};
}
