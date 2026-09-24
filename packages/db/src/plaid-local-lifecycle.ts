import {createHash,randomUUID} from 'node:crypto';
import {currentActor,runAsSystem} from './audit.js';
import type {Database,ScopedClient} from './scoped.js';
import {outbox} from './outbox.js';
import type {LocalPlaidEnvelope} from './plaid-local-exchange.js';

/* ADR-022 durable LOCAL synthetic lifecycle. No HTTP route, provider transport or key
 * access lives here: the isolated runtime composes these DB steps around provider I/O
 * that happens strictly BETWEEN transactions. The database triggers are the authority;
 * the TypeScript pre-checks only avoid raising for ordinary not-claimable cases. */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fixtureItem=/^public-fixture-item-[a-f0-9-]{36}$/;
const fixtureAccount=/^public-fixture-account-[a-f0-9-]{36}$/;
const fixtureTxn=/^public-fixture-txn-[a-f0-9-]{36}$/;
const cursorGrammar=/^[A-Za-z0-9+/=_-]{1,256}$/;
const syncable=['active','login-required','revoked'];
function refuse():never{throw new Error('Local financial operation refused');}
/** Runtime-role effects: closed raw insert on exactly the granted outbox columns. */
async function emitRuntime(tx:ScopedClient,type:'plaid.local_sync_committed'|'plaid.local_item_status_changed'|'plaid.local_item_removed',hh:string,item:string,payload:Record<string,number>){
 await tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${hh}::uuid,${type},'plaid-local-item',${item}::uuid,${JSON.stringify(payload)}::jsonb)`;
}
async function lock(tx:ScopedClient,hh:string){const [r]=await tx.$queryRaw<Array<{state:string}>>`SELECT app.plaid_fence_state(${hh}::uuid) AS state`;return r!.state as 'open'|'fenced'|'closed';}

/* Closed webhook vocabulary. Unknown types/codes fail closed; a signal only schedules a
 * fresh provider read and never carries state into the ledger. */
const SIGNALS:Readonly<Record<string,Readonly<Record<string,'transactions'|'item-status'>>>>=Object.freeze({
 TRANSACTIONS:Object.freeze({SYNC_UPDATES_AVAILABLE:'transactions',DEFAULT_UPDATE:'transactions',INITIAL_UPDATE:'transactions',HISTORICAL_UPDATE:'transactions',TRANSACTIONS_REMOVED:'transactions'}),
 ITEM:Object.freeze({ERROR:'item-status',PENDING_EXPIRATION:'item-status',PENDING_DISCONNECT:'item-status',USER_PERMISSION_REVOKED:'item-status',USER_ACCOUNT_REVOKED:'item-status',LOGIN_REPAIRED:'item-status',NEW_ACCOUNTS_AVAILABLE:'item-status'}),
});
export function localPlaidRouteDigest(providerItemId:string){return createHash('sha256').update(`local-synthetic-sandbox:${providerItemId}`).digest('hex');}
export interface VerifiedLocalPlaidNotice {webhook_type:string;webhook_code:string;item_id:string;environment:'sandbox'}

/** Call ONLY with a notice returned by the ES256/raw-body verifier and the SHA-256 of
 * those exact verified bytes. `ignored` and `accepted` are deliberately indistinguishable
 * to the HTTP caller (same acknowledgement), so unknown Items cannot be enumerated. */
export async function acceptLocalPlaidWebhook(db:Database,notice:VerifiedLocalPlaidNotice,bodyDigest:string):Promise<{status:'accepted'|'ignored'}>{
 if(!notice||typeof notice!=='object'||notice.environment!=='sandbox'||typeof notice.item_id!=='string'||!/^[a-f0-9]{64}$/.test(bodyDigest))refuse();
 const signal=Object.hasOwn(SIGNALS,notice.webhook_type)&&Object.hasOwn(SIGNALS[notice.webhook_type]!,notice.webhook_code)?SIGNALS[notice.webhook_type]![notice.webhook_code]!:refuse();
 if(!fixtureItem.test(notice.item_id))return{status:'ignored'};
 const route=await db.resolveFinancialItemRoute(localPlaidRouteDigest(notice.item_id));
 if(!route)return{status:'ignored'};
 return runAsSystem('Record verified financial webhook signal',()=>db.withHousehold(route.householdId,async tx=>{
  const hh=route.householdId;if(await lock(tx,hh)!=='open')return{status:'ignored' as const};
  // Re-check the routed binding inside the household scope before acting on it.
  const [item]=await tx.$queryRaw<Array<{state:string;provider_item_id:string}>>`SELECT state,provider_item_id FROM plaid_local_items WHERE id=${route.itemId}::uuid AND household_id=${hh}::uuid`;
  if(!item||item.provider_item_id!==notice.item_id||!syncable.includes(item.state))return{status:'ignored' as const};
  const [pending]=await tx.$queryRaw<Array<{n:number}>>`SELECT count(*)::int AS n FROM plaid_local_webhooks WHERE item_id=${route.itemId}::uuid AND state='pending'`;
  // Bounded inbox: past 32 pending signals a refresh is already scheduled; coalesce.
  if(pending!.n<32)await tx.$executeRaw`INSERT INTO plaid_local_webhooks(household_id,item_id,signal,body_digest) VALUES(${hh}::uuid,${route.itemId}::uuid,${signal},${bodyDigest})
   ON CONFLICT(item_id,body_digest) WHERE state='pending' DO NOTHING`;
  await tx.$executeRaw`UPDATE plaid_local_cursors SET refresh_requested=true WHERE id=${route.itemId}::uuid AND household_id=${hh}::uuid`;
  return{status:'accepted' as const};
 }));
}

export type LocalPlaidOpKind='sync'|'remove'|'reconcile'|'rotate';
export interface LocalPlaidBinding {environment:'local-synthetic-sandbox';householdId:string;incarnationId:string;itemId:string;providerItemId:string;revision:number}
export interface LocalPlaidOpClaim {kind:LocalPlaidOpKind;householdId:string;itemId:string;token:string;cursor:string|null;cursorRevision:number;credentialRevision:number;binding:LocalPlaidBinding;envelope:LocalPlaidEnvelope}

/** One DB-time 60s lease per Item. Sync/rotation are READS of custody and may be taken
 * over after expiry; removal is single-attempt: an expired removal becomes
 * removal-indeterminate and is never re-attempted automatically. Returns null when
 * the Item is not claimable for this kind. Deletion fence implies removal only. */
export async function claimLocalPlaidOperation(db:Database,hh:string,itemId:string,kind:LocalPlaidOpKind):Promise<LocalPlaidOpClaim|null>{
 if(!uuid.test(hh)||!uuid.test(itemId)||!['sync','remove','reconcile','rotate'].includes(kind))refuse();
 return runAsSystem('Claim one bounded local financial operation',()=>db.withHousehold(hh,async tx=>{
  const fence=await lock(tx,hh);if(fence==='closed')return null;
  const [c]=await tx.$queryRaw<Array<{op:string|null;expired:boolean}>>`SELECT op,op_until<=clock_timestamp() AS expired FROM plaid_local_cursors WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  if(!c)return null;
  if(c.op==='remove'&&c.expired){
   await tx.$executeRaw`UPDATE plaid_local_items SET state='removal-indeterminate' WHERE id=${itemId}::uuid AND household_id=${hh}::uuid AND state='unlinking'`;
   await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='removal-indeterminate' WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
   c.op=null;
  }
  const [item]=await tx.$queryRaw<Array<{state:string}>>`SELECT state FROM plaid_local_items WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  if(!item)return null;
  const free=(...takeover:string[])=>c.op===null||(takeover.includes(c.op)&&c.expired);
  const ok=kind==='sync'?fence==='open'&&syncable.includes(item.state)&&free('sync')
   :kind==='rotate'?fence==='open'&&syncable.includes(item.state)&&free('sync','rotate')
   :kind==='remove'?(item.state==='unlinking'||(fence==='fenced'&&syncable.includes(item.state)))&&c.op!=='remove'&&c.op!=='reconcile'
   :item.state==='removal-indeterminate'&&free('reconcile');
  if(!ok)return null;
  const token=randomUUID();
  await tx.$executeRaw`UPDATE plaid_local_cursors SET op=${kind},op_token=${token}::uuid WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  await tx.$executeRaw`SELECT set_config('request.plaid_op',${token},true)`;
  if(kind==='remove'&&item.state!=='unlinking')await tx.$executeRaw`UPDATE plaid_local_items SET state='unlinking' WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  const [r]=await tx.$queryRaw<Array<{provider_item_id:string;incarnation_id:string;credential_revision:number;cursor:string|null;revision:bigint;key_version:number;nonce:string;wrap_nonce:string;wrapped_key:string;ciphertext:string;k_revision:number}>>`
   SELECT i.provider_item_id,i.incarnation_id::text,i.credential_revision,c.cursor,c.revision,k.key_version,k.nonce,k.wrap_nonce,k.wrapped_key,k.ciphertext,k.revision AS k_revision
   FROM plaid_local_items i JOIN plaid_local_cursors c ON c.id=i.id AND c.household_id=i.household_id JOIN plaid_local_credentials k ON k.id=i.id AND k.household_id=i.household_id
   WHERE i.id=${itemId}::uuid AND i.household_id=${hh}::uuid`;
  if(!r||r.k_revision!==r.credential_revision)refuse();
  return{kind,householdId:hh,itemId,token,cursor:r.cursor,cursorRevision:Number(r.revision),credentialRevision:r.credential_revision,
   binding:{environment:'local-synthetic-sandbox',householdId:hh,incarnationId:r.incarnation_id,itemId,providerItemId:r.provider_item_id,revision:r.credential_revision},
   envelope:{version:1,keyVersion:r.key_version,nonce:r.nonce,wrapNonce:r.wrap_nonce,wrappedKey:r.wrapped_key,ciphertext:r.ciphertext}};
 }));
}

/** Re-establish the held lease inside a later transaction; stale/replaced tokens refuse. */
async function held(tx:ScopedClient,claim:LocalPlaidOpClaim){
 await tx.$executeRaw`SELECT set_config('request.plaid_op',${claim.token},true)`;
 const [c]=await tx.$queryRaw<Array<{ok:boolean}>>`SELECT app.plaid_op_held(${claim.householdId}::uuid,${claim.itemId}::uuid,${claim.kind}) AS ok`;
 if(!c?.ok)refuse();
 const [i]=await tx.$queryRaw<Array<{state:string;credential_revision:number;provider_item_id:string;incarnation_id:string}>>`SELECT state,credential_revision,provider_item_id,incarnation_id::text FROM plaid_local_items WHERE id=${claim.itemId}::uuid AND household_id=${claim.householdId}::uuid`;
 if(!i||i.provider_item_id!==claim.binding.providerItemId||i.incarnation_id!==claim.binding.incarnationId)refuse();
 return i;
}

export interface LocalPlaidAccount {accountId:string;name:string;kind:'depository'|'credit'|'loan'|'investment'|'other';currentCents:number|null;availableCents:number|null}
export interface LocalPlaidTransaction {transactionId:string;accountId:string;amountCents:number;date:string;description:string;pending:boolean}
export interface LocalPlaidSyncPage {accounts:LocalPlaidAccount[];added:LocalPlaidTransaction[];modified:LocalPlaidTransaction[];removed:string[];nextCursor:string;hasMore:boolean}
export const LOCAL_PLAID_SYNC_BOUNDS=Object.freeze({pages:8,changesPerPage:500,accounts:50});
const exact=(v:unknown,keys:readonly string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const cents=(v:unknown)=>Number.isSafeInteger(v)&&Math.abs(v as number)<=1e14;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>=1&&v.length<=max&&!/\p{Cc}/u.test(v);
function validAccount(a:unknown):a is LocalPlaidAccount{
 return exact(a,['accountId','name','kind','currentCents','availableCents'])&&fixtureAccount.test((a as LocalPlaidAccount).accountId)&&text((a as LocalPlaidAccount).name,80)
  &&['depository','credit','loan','investment','other'].includes((a as LocalPlaidAccount).kind)&&[(a as LocalPlaidAccount).currentCents,(a as LocalPlaidAccount).availableCents].every(x=>x===null||cents(x));
}
function validTxn(t:unknown):t is LocalPlaidTransaction{
 const x=t as LocalPlaidTransaction;
 return exact(t,['transactionId','accountId','amountCents','date','description','pending'])&&fixtureTxn.test(x.transactionId)&&fixtureAccount.test(x.accountId)&&cents(x.amountCents)
  &&typeof x.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&!Number.isNaN(Date.parse(`${x.date}T00:00:00Z`))&&new Date(`${x.date}T00:00:00Z`).toISOString().startsWith(x.date)
  &&x.date>='2000-01-01'&&x.date<='2100-01-01'&&text(x.description,120)&&typeof x.pending==='boolean';
}
/** Pages are sequential deltas; the collected batch is DATA, never authority. */
export function collapseLocalPlaidPages(pages:unknown):{accounts:LocalPlaidAccount[];upserts:LocalPlaidTransaction[];removed:string[];nextCursor:string}{
 if(!Array.isArray(pages)||pages.length<1||pages.length>LOCAL_PLAID_SYNC_BOUNDS.pages)refuse();
 const accounts=new Map<string,LocalPlaidAccount>(),txns=new Map<string,LocalPlaidTransaction|null>();
 pages.forEach((p,index)=>{
  if(!exact(p,['accounts','added','modified','removed','nextCursor','hasMore']))refuse();
  const page=p as LocalPlaidSyncPage;
  if(!Array.isArray(page.accounts)||!Array.isArray(page.added)||!Array.isArray(page.modified)||!Array.isArray(page.removed)
   ||page.accounts.length>LOCAL_PLAID_SYNC_BOUNDS.accounts||page.added.length+page.modified.length+page.removed.length>LOCAL_PLAID_SYNC_BOUNDS.changesPerPage
   ||typeof page.nextCursor!=='string'||!cursorGrammar.test(page.nextCursor)||page.hasMore!==(index<pages.length-1))refuse();
  for(const a of page.accounts){if(!validAccount(a))refuse();accounts.set(a.accountId,a);}
  for(const t of [...page.added,...page.modified]){if(!validTxn(t))refuse();txns.set(t.transactionId,t);}
  for(const id of page.removed){if(typeof id!=='string'||!fixtureTxn.test(id))refuse();txns.set(id,null);}
 });
 if(accounts.size>LOCAL_PLAID_SYNC_BOUNDS.accounts)refuse();
 const upserts=[...txns.values()].filter((t):t is LocalPlaidTransaction=>t!==null),removed=[...txns].filter(([,t])=>t===null).map(([id])=>id);
 return{accounts:[...accounts.values()],upserts,removed,nextCursor:(pages[pages.length-1] as LocalPlaidSyncPage).nextCursor};
}

/** Atomic cursor + data publication for a complete, bounded pagination loop collected
 * OUTSIDE any transaction. Rechecks household fence, bound owner/incarnation, Item
 * state, credential revision, lease, exact claimed cursor and revision (DB triggers
 * repeat every check). A reorder/stale runner loses; no partial page is published. */
export async function commitLocalPlaidSync(db:Database,claim:LocalPlaidOpClaim,pages:unknown){
 if(claim.kind!=='sync')refuse();
 const batch=collapseLocalPlaidPages(pages);
 try{return await runAsSystem('Publish one complete local financial sync',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId,item=claim.itemId;
  if(await lock(tx,hh)!=='open')refuse();
  const i=await held(tx,claim);
  const [c]=await tx.$queryRaw<Array<{cursor:string|null;revision:bigint}>>`SELECT cursor,revision FROM plaid_local_cursors WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  if(!c||c.cursor!==claim.cursor||Number(c.revision)!==claim.cursorRevision||i.credential_revision!==claim.credentialRevision||!syncable.includes(i.state))refuse();
  if(batch.accounts.length)await tx.$executeRaw`INSERT INTO plaid_local_accounts(household_id,item_id,provider_account_id,name,kind,current_cents,available_cents)
   SELECT ${hh}::uuid,${item}::uuid,a."accountId",a.name,a.kind,a."currentCents",a."availableCents" FROM jsonb_to_recordset(${JSON.stringify(batch.accounts)}::jsonb)
    AS a("accountId" text,name text,kind text,"currentCents" bigint,"availableCents" bigint)
   ON CONFLICT(item_id,provider_account_id) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,current_cents=EXCLUDED.current_cents,available_cents=EXCLUDED.available_cents`;
  if(batch.upserts.length){
   const n=await tx.$executeRaw`INSERT INTO plaid_local_transactions(household_id,item_id,account_id,provider_transaction_id,amount_cents,posted_on,description,pending)
    SELECT ${hh}::uuid,${item}::uuid,a.id,t."transactionId",t."amountCents",t.date::date,t.description,t.pending
    FROM jsonb_to_recordset(${JSON.stringify(batch.upserts)}::jsonb) AS t("transactionId" text,"accountId" text,"amountCents" bigint,date text,description text,pending boolean)
    JOIN plaid_local_accounts a ON a.item_id=${item}::uuid AND a.household_id=${hh}::uuid AND a.provider_account_id=t."accountId"
    ON CONFLICT(item_id,provider_transaction_id) DO UPDATE SET account_id=EXCLUDED.account_id,amount_cents=EXCLUDED.amount_cents,posted_on=EXCLUDED.posted_on,description=EXCLUDED.description,pending=EXCLUDED.pending`;
   // A transaction naming an account this Item never reported fails the whole batch.
   if(n!==batch.upserts.length)refuse();
  }
  if(batch.removed.length)await tx.$executeRaw`DELETE FROM plaid_local_transactions WHERE item_id=${item}::uuid AND household_id=${hh}::uuid AND provider_transaction_id=ANY(${batch.removed}::text[])`;
  if(i.state!=='active'){
   await tx.$executeRaw`UPDATE plaid_local_items SET state='active' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
   await emitRuntime(tx,'plaid.local_item_status_changed',hh,item,{version:1});
  }
  await tx.$executeRaw`UPDATE plaid_local_webhooks w SET state='applied' FROM plaid_local_cursors c WHERE c.id=w.item_id AND c.household_id=w.household_id
   AND w.item_id=${item}::uuid AND w.household_id=${hh}::uuid AND w.state='pending' AND w.received_at<=c.op_watermark`;
  const revision=claim.cursorRevision+1;
  await emitRuntime(tx,'plaid.local_sync_committed',hh,item,{version:1,revision});
  await tx.$executeRaw`UPDATE plaid_local_cursors SET cursor=${batch.nextCursor},revision=${revision},op=NULL,op_token=NULL,last_outcome='synced' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  return{revision,accounts:batch.accounts.length,upserts:batch.upserts.length,removed:batch.removed.length};
 },{timeoutMs:10_000}));}catch{refuse();}
}

/** Close a held sync without data. Login-required/revoked project Item status from this
 * current read; unavailable/exhausted leave cursor, data and status untouched. */
export async function releaseLocalPlaidSync(db:Database,claim:LocalPlaidOpClaim,outcome:'login-required'|'revoked'|'unavailable'|'exhausted'){
 if(claim.kind!=='sync'||!['login-required','revoked','unavailable','exhausted'].includes(outcome))refuse();
 try{return await runAsSystem('Close one local financial read',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId,item=claim.itemId;
  if(await lock(tx,hh)!=='open')refuse();
  const i=await held(tx,claim);
  if(i.credential_revision!==claim.credentialRevision)refuse();
  if((outcome==='login-required'||outcome==='revoked')&&i.state!==outcome){
   await tx.$executeRaw`UPDATE plaid_local_items SET state=${outcome} WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
   await emitRuntime(tx,'plaid.local_item_status_changed',hh,item,{version:1});
  }
  await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome=${outcome} WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  return{outcome};
 }));}catch{refuse();}
}

/** Owner-chosen history deletion, in the transaction that records established removal. */
async function eraseHistoryIfChosen(tx:ScopedClient,hh:string,item:string){
 const [i]=await tx.$queryRaw<Array<{history_after_removal:string}>>`SELECT history_after_removal FROM plaid_local_items WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
 if(i?.history_after_removal!=='delete')return{transactions:0,accounts:0};
 const transactions=await tx.$executeRaw`DELETE FROM plaid_local_transactions WHERE item_id=${item}::uuid AND household_id=${hh}::uuid`;
 const accounts=await tx.$executeRaw`DELETE FROM plaid_local_accounts WHERE item_id=${item}::uuid AND household_id=${hh}::uuid`;
 return{transactions,accounts};
}
/** Single-attempt removal outcome. Acknowledgement and established provider-invalid
 * state remain distinct; an unknown outcome keeps custody so it can be reconciled.
 * Local custody destruction is NEVER presented as provider deletion evidence. */
export async function completeLocalPlaidRemoval(db:Database,claim:LocalPlaidOpClaim,outcome:'provider-acknowledged'|'provider-invalid'|'indeterminate'){
 if(claim.kind!=='remove'||!['provider-acknowledged','provider-invalid','indeterminate'].includes(outcome))refuse();
 try{return await runAsSystem('Record one local financial removal outcome',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId,item=claim.itemId,fence=await lock(tx,hh);
  if(fence==='closed')refuse();
  const i=await held(tx,claim);if(i.state!=='unlinking')refuse();
  if(outcome==='indeterminate'){
   await tx.$executeRaw`UPDATE plaid_local_items SET state='removal-indeterminate' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
   await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='removal-indeterminate' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
   return{state:'removal-indeterminate' as const};
  }
  await tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence=${outcome} WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  await eraseHistoryIfChosen(tx,hh,item);
  await tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  if(fence==='open')await emitRuntime(tx,'plaid.local_item_removed',hh,item,{version:1});
  await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='removed' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  return{state:'removed' as const,evidence:outcome};
 }));}catch{refuse();}
}

/** Non-mutating provider read for an indeterminate removal. Only established absence
 * removes custody; `present` keeps it, and any new removal needs an explicit request. */
export async function completeLocalPlaidReconcile(db:Database,claim:LocalPlaidOpClaim,outcome:'absent'|'present'){
 if(claim.kind!=='reconcile'||!['absent','present'].includes(outcome))refuse();
 try{return await runAsSystem('Record one local financial removal reconciliation',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId,item=claim.itemId,fence=await lock(tx,hh);
  if(fence==='closed')refuse();
  const i=await held(tx,claim);if(i.state!=='removal-indeterminate')refuse();
  if(outcome==='present'){
   await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='still-present' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
   return{state:'removal-indeterminate' as const};
  }
  await tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence='provider-invalid' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  await eraseHistoryIfChosen(tx,hh,item);
  await tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  if(fence==='open')await emitRuntime(tx,'plaid.local_item_removed',hh,item,{version:1});
  await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='removed' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  return{state:'removed' as const,evidence:'provider-invalid' as const};
 }));}catch{refuse();}
}

/** Compare-and-swap envelope rotation: revision N -> N+1 with the new envelope sealed
 * outside the transaction under the N+1 binding. Losing any race changes nothing. */
export async function commitLocalPlaidRotation(db:Database,claim:LocalPlaidOpClaim,envelope:LocalPlaidEnvelope){
 if(claim.kind!=='rotate'||envelope?.version!==1)refuse();
 try{return await runAsSystem('Rotate one local financial custody envelope',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId,item=claim.itemId;
  if(await lock(tx,hh)!=='open')refuse();
  const i=await held(tx,claim);if(i.credential_revision!==claim.credentialRevision)refuse();
  const next=claim.credentialRevision+1;
  await tx.$executeRaw`UPDATE plaid_local_items SET credential_revision=${next} WHERE id=${item}::uuid AND household_id=${hh}::uuid AND credential_revision=${claim.credentialRevision}`;
  await tx.$executeRaw`UPDATE plaid_local_credentials SET key_version=${envelope.keyVersion},nonce=${envelope.nonce},wrap_nonce=${envelope.wrapNonce},wrapped_key=${envelope.wrappedKey},ciphertext=${envelope.ciphertext},revision=${next}
   WHERE id=${item}::uuid AND household_id=${hh}::uuid AND revision=${claim.credentialRevision}`;
  await tx.$executeRaw`UPDATE plaid_local_cursors SET op=NULL,op_token=NULL,last_outcome='rotated' WHERE id=${item}::uuid AND household_id=${hh}::uuid`;
  return{credentialRevision:next};
 }));}catch{refuse();}
}

async function currentOwner(tx:ScopedClient,hh:string){
 const actor=currentActor();if(actor?.type!=='user')refuse();
 if(await lock(tx,hh)!=='open')refuse();
 const [o]=await tx.$queryRaw<Array<{ok:boolean}>>`SELECT EXISTS(SELECT 1 FROM household_users h JOIN users u ON u.id=h.user_id WHERE h.household_id=${hh}::uuid AND h.user_id=${actor.userId}::uuid AND h.role='owner' AND u.status='active') AS ok`;
 if(!o?.ok)refuse();
}
/** Owner unlink request. Fences reads immediately (an in-flight sync can no longer commit);
 * provider removal happens later in the isolated runtime. The eventual HTTP route must
 * enter the sensitive-session scope (recent auth/MFA) before calling this. */
export async function requestLocalPlaidUnlink(db:Database,hh:string,itemId:string,history:'delete'|'retain'='delete'){
 if(!uuid.test(hh)||!uuid.test(itemId)||!['delete','retain'].includes(history))refuse();
 return db.withHousehold(hh,async tx=>{
  await currentOwner(tx,hh);
  const [i]=await tx.$queryRaw<Array<{state:string}>>`SELECT state FROM plaid_local_items WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  if(!i)refuse();
  if(i.state==='unlinking'||i.state==='removed')return{state:i.state};
  await outbox(tx).emit({event_type:'plaid.local_unlink_requested',aggregate_type:'plaid-local-item',aggregate_id:itemId,household_id:hh,payload:{version:1}});
  await tx.$executeRaw`UPDATE plaid_local_items SET state='unlinking',history_after_removal=${history} WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  return{state:'unlinking',history};
 });
}
/** Owner reconnect (update-mode) request: schedules a fresh provider read. It cannot
 * change the Item identity or credential; the next successful read restores `active`. */
export async function requestLocalPlaidReconnect(db:Database,hh:string,itemId:string){
 if(!uuid.test(hh)||!uuid.test(itemId))refuse();
 return db.withHousehold(hh,async tx=>{
  await currentOwner(tx,hh);
  const [i]=await tx.$queryRaw<Array<{state:string}>>`SELECT state FROM plaid_local_items WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  if(!i||!syncable.includes(i.state))refuse();
  await outbox(tx).emit({event_type:'plaid.local_reconnect_requested',aggregate_type:'plaid-local-item',aggregate_id:itemId,household_id:hh,payload:{version:1}});
  await tx.$executeRaw`UPDATE plaid_local_cursors SET refresh_requested=true WHERE id=${itemId}::uuid AND household_id=${hh}::uuid`;
  return{state:i.state,refreshRequested:true};
 });
}
/** Owner-only safe projection: no provider IDs, cursor, lease, custody or error text. */
export async function readLocalPlaidConnections(db:Database,hh:string){
 if(!uuid.test(hh))refuse();
 return db.withHousehold(hh,async tx=>{
  const actor=currentActor();if(actor?.type!=='user')refuse();
  const [o]=await tx.$queryRaw<Array<{ok:boolean}>>`SELECT EXISTS(SELECT 1 FROM household_users h JOIN users u ON u.id=h.user_id WHERE h.household_id=${hh}::uuid AND h.user_id=${actor.userId}::uuid AND h.role='owner' AND u.status='active') AS ok`;
  if(!o?.ok)refuse();
  const items=await tx.$queryRaw<Array<{id:string;state:string;status_changed_at:Date;last_outcome:string;refresh_requested:boolean;history_after_removal:string}>>`
   SELECT i.id::text,i.state,i.status_changed_at,c.last_outcome,c.refresh_requested,i.history_after_removal FROM plaid_local_items i JOIN plaid_local_cursors c ON c.id=i.id AND c.household_id=i.household_id
   WHERE i.household_id=${hh}::uuid ORDER BY i.created_at,i.id LIMIT 20`;
  const accounts=await tx.$queryRaw<Array<{id:string;item_id:string;name:string;kind:string;current_cents:bigint|null;available_cents:bigint|null}>>`
   SELECT id::text,item_id::text,name,kind,current_cents,available_cents FROM plaid_local_accounts WHERE household_id=${hh}::uuid ORDER BY item_id,name,id LIMIT 200`;
  return items.map(i=>({id:i.id,state:i.state,statusChangedAt:i.status_changed_at,lastOutcome:i.last_outcome,refreshRequested:i.refresh_requested,historyAfterRemoval:i.history_after_removal as 'delete'|'retain',
   accounts:accounts.filter(a=>a.item_id===i.id).map(a=>({id:a.id,name:a.name,kind:a.kind,currentCents:a.current_cents===null?null:Number(a.current_cents),availableCents:a.available_cents===null?null:Number(a.available_cents)}))}));
 });
}
