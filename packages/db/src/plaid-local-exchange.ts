import {randomUUID} from 'node:crypto';
import {currentActor,runAsSystem} from './audit.js';
import type {Database} from './scoped.js';
import {outbox} from './outbox.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function refuse():never{throw new Error('Local financial operation refused');}
export interface LocalPlaidClaim {id:string;householdId:string;incarnationId:string;leaseToken:string}
export interface LocalPlaidEnvelope {version:1;keyVersion:number;nonce:string;wrapNonce:string;wrappedKey:string;ciphertext:string}
/** No HTTP route. The eventual route must enter the existing sensitive-session scope.
 * Neither public token nor provider credential is ever persisted in operation intent. */
export async function requestLocalPlaidExchange(db:Database,hh:string,id:string,consent:'READ ONLY PUBLIC SYNTHETIC ACCOUNTS'){
 const actor=currentActor();if(actor?.type!=='user'||!uuid.test(id)||consent!=='READ ONLY PUBLIC SYNTHETIC ACCOUNTS')refuse();
 return db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plaid-local:${hh}`},0))`;
  if(!await tx.householdUser.findFirst({where:{householdId:hh,userId:actor.userId,role:'owner'}}))refuse();
  await tx.$executeRaw`INSERT INTO plaid_local_subjects(household_id) VALUES(${hh}::uuid) ON CONFLICT(household_id) DO NOTHING`;
  const [s]=await tx.$queryRaw<Array<{id:string;owner_id:string}>>`SELECT id,owner_id FROM plaid_local_subjects WHERE household_id=${hh}::uuid`;
  if(!s||s.owner_id!==actor.userId)refuse();
  const prior=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM plaid_local_exchanges WHERE id=${id}::uuid AND household_id=${hh}::uuid AND owner_id=${actor.userId}::uuid`;
  if(prior.length)return id;
  await tx.$executeRaw`INSERT INTO plaid_local_exchanges(id,household_id,subject_id,consent_version) VALUES(${id}::uuid,${hh}::uuid,${s.id}::uuid,1)`;
  await outbox(tx).emit({event_type:'plaid.local_exchange_requested',aggregate_type:'plaid-local-exchange',aggregate_id:id,household_id:hh,payload:{version:1}});return id;
 });
}
/** Once started, expiry is indeterminate. It never becomes claimable again. */
export async function claimLocalPlaidExchange(db:Database,hh:string,id:string):Promise<LocalPlaidClaim|null>{
 return runAsSystem('Claim one local synthetic exchange',()=>db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plaid-local:${hh}`},0))`;
  await tx.$executeRaw`UPDATE plaid_local_exchanges SET state='indeterminate' WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='started' AND lease_until<=clock_timestamp()`;
  const [r]=await tx.$queryRaw<Array<{id:string;lease_token:string;subject_id:string}>>`UPDATE plaid_local_exchanges SET state='started',lease_token=${randomUUID()}::uuid WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='pending' RETURNING id,lease_token,subject_id`;
  if(!r)return null;
  const [s]=await tx.$queryRaw<Array<{incarnation_id:string}>>`SELECT incarnation_id FROM plaid_local_subjects WHERE id=${r.subject_id}::uuid AND household_id=${hh}::uuid`;
  if(!s)refuse();return{id:r.id,householdId:hh,incarnationId:s.incarnation_id,leaseToken:r.lease_token};
 }));
}
/** Called only by the isolated synthetic runtime after sealing outside the DB TX.
 * Idempotent completion cannot repeat exchange or change the immutable binding. */
export async function completeLocalPlaidExchange(db:Database,claim:LocalPlaidClaim,providerItemId:string,envelope:LocalPlaidEnvelope){
 if(!/^public-fixture-item-[a-f0-9-]{36}$/.test(providerItemId)||envelope.version!==1)refuse();
 try{return await runAsSystem('Publish bound local financial custody',()=>db.withHousehold(claim.householdId,async tx=>{
  const hh=claim.householdId;await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plaid-local:${hh}`},0))`;
  const [e]=await tx.$queryRaw<Array<{state:string;lease_token:string;incarnation_id:string;owner_id:string}>>`SELECT e.state,e.lease_token,s.incarnation_id,s.owner_id FROM plaid_local_exchanges e JOIN plaid_local_subjects s ON s.id=e.subject_id AND s.household_id=e.household_id WHERE e.id=${claim.id}::uuid AND e.household_id=${hh}::uuid`;
  if(!e||e.lease_token!==claim.leaseToken||e.incarnation_id!==claim.incarnationId)refuse();
  const [owner]=await tx.$queryRaw<Array<{user_id:string}>>`SELECT h.user_id FROM household_users h JOIN users u ON u.id=h.user_id WHERE h.household_id=${hh}::uuid AND h.user_id=${e.owner_id}::uuid AND h.role='owner' AND u.status='active'`;
  if(!owner)refuse();
  const [old]=await tx.$queryRaw<Array<{id:string;provider_item_id:string}>>`SELECT id,provider_item_id FROM plaid_local_items WHERE exchange_id=${claim.id}::uuid AND household_id=${hh}::uuid`;
  if(e.state==='completed'&&old?.provider_item_id===providerItemId)return{id:old.id,replayed:true};
  if(e.state!=='started'||old)refuse();
  await tx.$executeRaw`SELECT set_config('request.plaid_lease',${claim.leaseToken},true)`;
  await tx.$executeRaw`INSERT INTO plaid_local_items(id,household_id,exchange_id,provider_item_id) VALUES(${claim.id}::uuid,${hh}::uuid,${claim.id}::uuid,${providerItemId})`;
  await tx.$executeRaw`INSERT INTO plaid_local_credentials(id,household_id,version,key_version,nonce,wrap_nonce,wrapped_key,ciphertext) VALUES(${claim.id}::uuid,${hh}::uuid,1,${envelope.keyVersion},${envelope.nonce},${envelope.wrapNonce},${envelope.wrappedKey},${envelope.ciphertext})`;
  await tx.$executeRaw`UPDATE plaid_local_exchanges SET state='completed' WHERE id=${claim.id}::uuid AND household_id=${hh}::uuid`;
  await tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${hh}::uuid,'plaid.local_item_activated','plaid-local-item',${claim.id}::uuid,jsonb_build_object('version',1,'operation_id',${claim.id}::text))`;
  return{id:claim.id,replayed:false};
 }));}catch{refuse();}
}
