import {createHash,createCipheriv,createDecipheriv,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {beforeAll,afterAll,it,expect,describe} from 'vitest';
import {Database} from '../../src/scoped.js';
import {runAsUser} from '../../src/audit.js';
import {requestLocalPlaidExchange} from '../../src/plaid-local-exchange.js';
import {claimLocalPlaidOperation,commitLocalPlaidRotation,commitLocalPlaidSync,localPlaidRouteDigest,readLocalPlaidConnections,requestLocalPlaidReconnect,requestLocalPlaidUnlink,
 type LocalPlaidSyncPage,type LocalPlaidTransaction} from '../../src/plaid-local-lifecycle.js';
import {inventoryLocalDeletionPage,reconcileLocalDeletionInventory,PRIVACY_INVENTORY_SOURCES} from '../../src/privacy-inventory.js';
import {createLocalPlaidCustody} from '../../../../services/plaid/src/local-custody.js';
import {createKmsCustody,type KmsPort} from '../../../../services/plaid/src/kms-custody.js';
import {runLocalPlaidExchange} from '../../../../scripts/local-plaid-exchange.js';
import {LocalPlaidProviderSignal,runLocalPlaidReconcile,runLocalPlaidRemoval,runLocalPlaidRotation,runLocalPlaidSync,runLocalPlaidWebhook} from '../../../../scripts/local-plaid-lifecycle.js';
import {createPlaidWebhookVerifier} from '../../../../apps/web/src/server/plaid/webhook.js';
import {ADMIN_URL,APP_URL,bootstrapDatabase,grantAppUserLogin} from './setup.js';

let admin:PrismaClient,app:PrismaClient,runtime:PrismaClient,db:Database,appDb:Database;
const households:string[]=[],users:string[]=[],keyrings:Array<ReturnType<typeof createLocalPlaidCustody>>=[];
const refused='Local financial operation refused';
beforeAll(async()=>{await bootstrapDatabase();await grantAppUserLogin();admin=new PrismaClient({datasourceUrl:ADMIN_URL});app=new PrismaClient({datasourceUrl:APP_URL});appDb=new Database(app);
 await admin.$executeRawUnsafe("ALTER ROLE app_plaid_sandbox LOGIN PASSWORD 'local_plaid_fixture_only'");const u=new URL(ADMIN_URL);u.username='app_plaid_sandbox';u.password='local_plaid_fixture_only';runtime=new PrismaClient({datasourceUrl:u.toString()});db=new Database(runtime);},120000);
afterAll(async()=>{for(const k of keyrings)k.close();
 if(admin){const where={householdId:{in:households}};
  await admin.plaidLocalWebhook.deleteMany({where});await admin.plaidLocalTransaction.deleteMany({where});await admin.plaidLocalAccount.deleteMany({where});
  await admin.plaidLocalCursor.deleteMany({where});await admin.plaidLocalItemRoute.deleteMany({where});await admin.deletionObservation.deleteMany({where});await admin.deletionAttempt.deleteMany({where});
  await admin.deletionResource.deleteMany({where});await admin.householdDeletion.deleteMany({where});await admin.plaidLocalCredential.deleteMany({where});await admin.plaidLocalItem.deleteMany({where});
  await admin.plaidLocalExchange.deleteMany({where});await admin.plaidLocalSubject.deleteMany({where});await admin.outboxEvent.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});
  await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:users}}});await admin.$executeRawUnsafe('ALTER ROLE app_plaid_sandbox NOLOGIN PASSWORD NULL');}
 await Promise.all([admin,app,runtime].map(c=>c?.$disconnect()));});

const account=()=>'public-fixture-account-'+randomUUID();
const txn=(accountId:string,amountCents:number,description='PUBLIC synthetic purchase',date='2026-09-01'):LocalPlaidTransaction=>({transactionId:'public-fixture-txn-'+randomUUID(),accountId,amountCents,date,description,pending:false});
const page=(p:Partial<LocalPlaidSyncPage>&{nextCursor:string}):LocalPlaidSyncPage=>({accounts:[],added:[],modified:[],removed:[],hasMore:false,...p});
/** An active, owner-bound Item with sealed custody, created through the real exchange path. */
async function connected(){
 const hh=randomUUID(),owner=randomUUID(),operation=randomUUID(),keyring=createLocalPlaidCustody(),token='access-sandbox-PUBLIC_SYNTHETIC_'+randomUUID(),providerItemId='public-fixture-item-'+randomUUID();
 households.push(hh);users.push(owner);keyrings.push(keyring);
 await admin.user.create({data:{id:owner,email:owner+'@example.test'}});await admin.household.create({data:{id:hh,createdBy:owner,name:'PUBLIC financial lifecycle fixture'}});
 await admin.householdUser.create({data:{householdId:hh,userId:owner,role:'owner'}});
 await runAsUser(owner,()=>requestLocalPlaidExchange(appDb,hh,operation,'READ ONLY PUBLIC SYNTHETIC ACCOUNTS'));
 await runLocalPlaidExchange(db,hh,operation,'public-sandbox-PUBLIC_SYNTHETIC_'+randomUUID(),keyring,{exchange:async()=>({itemId:providerItemId,accessToken:token})});
 return{hh,owner,item:operation,keyring,token,providerItemId};
}
/** Scripted synthetic provider: pages keyed by the cursor they answer. Asserts the token. */
function bank(expectedToken:string,pages:Map<string|null,LocalPlaidSyncPage|LocalPlaidProviderSignal>){const seen:Array<string|null>=[];
 return{seen,sync:async(token:string,cursor:string|null)=>{if(token!==expectedToken)throw new Error('wrong token');seen.push(cursor);const p=pages.get(cursor);if(!p)throw new Error('unscripted');if(p instanceof LocalPlaidProviderSignal)throw p;return p;}};}
const state=async(item:string)=>(await admin.plaidLocalItem.findUniqueOrThrow({where:{id:item}})).state;
const cursorOf=async(item:string)=>admin.plaidLocalCursor.findUniqueOrThrow({where:{id:item}});
const fence=(hh:string,owner:string,s:'fenced'|'completed')=>admin.householdDeletion.create({data:{householdId:hh,requestedBy:owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:s,fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});

/* Real ES256 JWT over the exact body, signed with a throwaway P-256 key (no provider). */
function signer(){const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'}),kid=randomUUID(),jwk=publicKey.export({format:'jwk'});
 const key={alg:'ES256',kty:'EC',crv:'P-256',use:'sig',kid,x:jwk.x,y:jwk.y,created_at:Math.floor(Date.now()/1000)-60,expired_at:null};
 const b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 return{verify:createPlaidWebhookVerifier({getVerificationKey:async()=>key}),
  header(raw:Buffer,iat=Math.floor(Date.now()/1000)){const h=b64({alg:'ES256',typ:'JWT',kid}),p=b64({iat,request_body_sha256:createHash('sha256').update(raw).digest('hex')});
   return`${h}.${p}.${sign('sha256',Buffer.from(`${h}.${p}`),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;}};}
const body=(item:string,code='SYNC_UPDATES_AVAILABLE',type='TRANSACTIONS')=>Buffer.from(JSON.stringify({webhook_type:type,webhook_code:code,item_id:item,environment:'sandbox',initial_update_complete:true}));

describe('verified ingress and non-enumerating routing',()=>{
 it('stores only a digest and closed signal for a verified known Item and coalesces exact duplicates',async()=>{const f=await connected(),s=signer(),raw=body(f.providerItemId);
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{refreshRequested:false}});
  for(let n=0;n<3;n++)expect(await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw))).toEqual({acknowledged:true});
  const rows=await admin.plaidLocalWebhook.findMany({where:{itemId:f.item}});expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({signal:'transactions',state:'pending',bodyDigest:createHash('sha256').update(raw).digest('hex')});
  expect(JSON.stringify(rows)).not.toContain('initial_update_complete');expect((await cursorOf(f.item)).refreshRequested).toBe(true);
 });
 it('unknown, foreign-environment, removed and fenced Items get the same acknowledgement and store nothing',async()=>{const f=await connected(),s=signer();
  const before=await admin.plaidLocalWebhook.count();
  for(const raw of [body('public-fixture-item-'+randomUUID()),body('item-real-shaped-'+randomUUID())])expect(await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw))).toEqual({acknowledged:true});
  await fence(f.hh,f.owner,'fenced');const raw=body(f.providerItemId);expect(await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw))).toEqual({acknowledged:true});
  expect(await admin.plaidLocalWebhook.count()).toBe(before);
 });
 it('forged, tampered, stale and unknown-code webhooks are refused before any database write',async()=>{const f=await connected(),s=signer(),other=signer(),raw=body(f.providerItemId),before=await admin.plaidLocalWebhook.count();
  const tampered=Buffer.from(raw.toString().replace('SYNC_UPDATES_AVAILABLE','DEFAULT_UPDATE'));
  for(const [bytes,header] of [[raw,other.header(raw)],[tampered,s.header(raw)],[raw,s.header(raw,Math.floor(Date.now()/1000)-301)],[raw,null]] as const)
   await expect(runLocalPlaidWebhook(db,s.verify,bytes,header)).rejects.toThrow('could not be verified');
  const odd=body(f.providerItemId,'WEBHOOK_UPDATE_ACKNOWLEDGED','ITEM');await expect(runLocalPlaidWebhook(db,s.verify,odd,s.header(odd))).rejects.toThrow(refused);
  expect(await admin.plaidLocalWebhook.count()).toBe(before);
 });
 it('routing reveals only the digest the caller holds; app and other roles cannot use it',async()=>{const f=await connected();
  expect(await db.resolveFinancialItemRoute(localPlaidRouteDigest(f.providerItemId))).toEqual({itemId:f.item,householdId:f.hh});
  expect(await db.resolveFinancialItemRoute(localPlaidRouteDigest('public-fixture-item-'+randomUUID()))).toBeNull();
  expect(await runtime.$queryRaw`SELECT id FROM plaid_local_item_routes`).toEqual([]);
  await expect(appDb.resolveFinancialItemRoute(localPlaidRouteDigest(f.providerItemId))).rejects.toThrow('permission denied');
  await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO plaid_local_item_routes(id,household_id,route_digest) VALUES(${f.item}::uuid,${f.hh}::uuid,${'0'.repeat(64)})`)).rejects.toThrow();
 });
 it('household scope cannot widen financial route lookup without the exact digest', async () => {
  // connected() publishes each route through the restricted runtime's real Item
  // indexing trigger. SELECT isolation must preserve that guarded INSERT path.
  const f = await connected(), g = await connected();
  const digest = localPlaidRouteDigest(g.providerItemId);
  const [role] = await runtime.$queryRaw<Array<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>>`
    SELECT current_user::text AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  expect(role).toEqual({ name: 'app_plaid_sandbox', rolsuper: false, rolbypassrls: false });
  for (const item of [f, g]) {
   expect(await admin.plaidLocalItemRoute.findUnique({ where: { id: item.item },
    select: { id: true, householdId: true, routeDigest: true } })).toEqual({
     id: item.item, householdId: item.hh, routeDigest: localPlaidRouteDigest(item.providerItemId),
    });
   expect(await cursorOf(item.item)).toMatchObject({ id: item.item, householdId: item.hh, revision: 0n });
   expect(await admin.auditLog.count({ where: { householdId: item.hh, targetType: 'plaid_local_item_routes',
    targetId: item.item, action: 'plaid_local_item_routes.insert' } })).toBe(1);
  }
  // A caller chooses this GUC itself; it is not a substitute for the routing key.
  expect.soft(await db.withHousehold(f.hh, tx => tx.$queryRaw`
   SELECT id,household_id FROM plaid_local_item_routes`)).toEqual([]);
  expect.soft(await db.withHousehold(f.hh, async tx => {
   await tx.$executeRaw`SELECT set_config('request.plaid_route',${'0'.repeat(64)},true)`;
   return tx.$queryRaw`SELECT id,household_id FROM plaid_local_item_routes`;
  })).toEqual([]);
  // Routing intentionally discovers the household from the known digest. Even
  // with f's household GUC set, g's exact key may expose g alone and never f.
  expect.soft(await db.withHousehold(f.hh, async tx => {
   await tx.$executeRaw`SELECT set_config('request.plaid_route',${digest},true)`;
   return tx.$queryRaw`SELECT id,household_id FROM plaid_local_item_routes`;
  })).toEqual([{ id: g.item, household_id: g.hh }]);
  expect(await db.resolveFinancialItemRoute(digest)).toEqual({ itemId: g.item, householdId: g.hh });
  expect(await runtime.$queryRaw`SELECT id,household_id FROM plaid_local_item_routes`).toEqual([]);
 });
});

describe('atomic bounded sync',()=>{
 it('publishes accounts, transactions, cursor, applied signals and one closed event in a single commit',async()=>{const f=await connected(),a=account(),t1=txn(a,-1250),t2=txn(a,4200),s=signer(),raw=body(f.providerItemId);
  await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw));
  const p=bank(f.token,new Map([[null,page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:100000,availableCents:95000}],added:[t1],nextCursor:'c1',hasMore:true})],['c1',page({added:[t2],nextCursor:'c2'})]]));
  expect(await runLocalPlaidSync(db,f.hh,f.item,f.keyring,p)).toEqual({status:'committed',revision:1,accounts:1,upserts:2,removed:0});expect(p.seen).toEqual([null,'c1']);
  expect(await cursorOf(f.item)).toMatchObject({cursor:'c2',revision:1n,op:null,opToken:null,lastOutcome:'synced',refreshRequested:false});
  expect(await admin.plaidLocalWebhook.findMany({where:{itemId:f.item},select:{state:true}})).toEqual([{state:'applied'}]);
  expect(await admin.outboxEvent.findMany({where:{aggregateId:f.item,eventType:'plaid.local_sync_committed'},select:{payload:true}})).toEqual([{payload:{version:1,revision:1}}]);
  const view=await runAsUser(f.owner,()=>readLocalPlaidConnections(appDb,f.hh));
  expect(view).toMatchObject([{id:f.item,state:'active',lastOutcome:'synced',accounts:[{name:'PUBLIC Checking',kind:'depository',currentCents:100000,availableCents:95000}]}]);
  expect(JSON.stringify(view)).not.toContain(a);
  expect(await appDb.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT amount_cents FROM plaid_local_transactions ORDER BY amount_cents`)).toEqual([{amount_cents:-1250n},{amount_cents:4200n}]);
  for(const q of [()=>appDb.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT provider_transaction_id FROM plaid_local_transactions`),()=>appDb.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT provider_account_id FROM plaid_local_accounts`),()=>appDb.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT cursor FROM plaid_local_cursors`)])
   await expect(q()).rejects.toThrow('permission denied');
 });
 it('applies added/modified/removed deltas in order and is idempotent across a replayed cursor window',async()=>{const f=await connected(),a=account(),t1=txn(a,-100),t2=txn(a,-200),t3=txn(a,-300);
  const acct={accountId:a,name:'PUBLIC Card',kind:'credit' as const,currentCents:-600,availableCents:null};
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({accounts:[acct],added:[t1,t2,t3],nextCursor:'k1'})]])));
  const edited={...t1,amountCents:-150,description:'PUBLIC corrected purchase'};
  // Across pages: t2 modified then removed; t3 removed then re-added (last event wins).
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([['k1',page({accounts:[acct],modified:[edited,{...t2,amountCents:-1}],removed:[t3.transactionId],nextCursor:'k2',hasMore:true})],['k2',page({added:[t3],removed:[t2.transactionId],nextCursor:'k3'})]])));
  const rows=await admin.plaidLocalTransaction.findMany({where:{itemId:f.item},orderBy:{amountCents:'asc'},select:{providerTransactionId:true,amountCents:true,description:true}});
  expect(rows).toEqual([{providerTransactionId:t3.transactionId,amountCents:-300n,description:t3.description},{providerTransactionId:t1.transactionId,amountCents:-150n,description:'PUBLIC corrected purchase'}]);
  expect((await cursorOf(f.item)).revision).toBe(2n);
 });
 it('restarts from the ORIGINAL cursor on mutation during pagination and exhausts its bounded read budget without writing',async()=>{const f=await connected(),a=account();
  let calls=0;const flaky={sync:async(token:string,cursor:string|null)=>{calls++;if(token!==f.token)throw new Error('wrong');if(cursor===null)return page({accounts:[{accountId:a,name:'PUBLIC Savings',kind:'depository',currentCents:5,availableCents:5}],added:[txn(a,-1)],nextCursor:'m1',hasMore:true});if(calls<4)throw new LocalPlaidProviderSignal('mutation-during-pagination');return page({nextCursor:'m2'});}};
  expect(await runLocalPlaidSync(db,f.hh,f.item,f.keyring,flaky)).toMatchObject({status:'committed',revision:1,upserts:1});expect(calls).toBe(4);
  const g=await connected(),always={sync:async(_t:string,cursor:string|null)=>{if(cursor===null)return page({nextCursor:'x1',hasMore:true});throw new LocalPlaidProviderSignal('mutation-during-pagination');}};
  expect(await runLocalPlaidSync(db,g.hh,g.item,g.keyring,always,{pages:8,restarts:2})).toEqual({status:'released',outcome:'exhausted'});
  const endless={sync:async(_t:string,cursor:string|null)=>page({nextCursor:(cursor??'p')+'x',hasMore:true})};
  expect(await runLocalPlaidSync(db,g.hh,g.item,g.keyring,endless,{pages:3,restarts:0})).toEqual({status:'released',outcome:'exhausted'});
  expect(await cursorOf(g.item)).toMatchObject({cursor:null,revision:0n,op:null,lastOutcome:'exhausted',refreshRequested:true});
  expect(await admin.plaidLocalTransaction.count({where:{itemId:g.item}})).toBe(0);
 });
 it('a batch naming an unreported account, an oversize page or malformed data publishes nothing',async()=>{const f=await connected(),a=account();
  const bad=[page({added:[txn(account(),-1)],nextCursor:'b1'}),page({accounts:[{accountId:a,name:'x',kind:'depository',currentCents:1.5 as number,availableCents:null}],nextCursor:'b1'}),
   page({added:Array.from({length:501},()=>txn(a,-1)),nextCursor:'b1'}),page({added:[txn(a,-1,'bad\u0007control')],nextCursor:'b1'}),page({added:[txn(a,-1,'x','2026-02-30')],nextCursor:'b1'}),
   {...page({nextCursor:'b1'}),raw:'extra'} as LocalPlaidSyncPage,page({nextCursor:'b1',hasMore:true})];
  for(const p of bad){const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;await expect(commitLocalPlaidSync(db,claim,[p])).rejects.toThrow(refused);
   await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});}
  expect(await admin.plaidLocalAccount.count({where:{itemId:f.item}})).toBe(0);expect((await cursorOf(f.item)).revision).toBe(0n);
 });
 it('concurrent claims admit one runner; a crashed runner is replaced and its stale token can never commit',async()=>{const f=await connected();
  const claims=await Promise.all([1,2,3].map(()=>claimLocalPlaidOperation(db,f.hh,f.item,'sync')));expect(claims.filter(Boolean)).toHaveLength(1);
  const stale=claims.find(Boolean)!;expect(await claimLocalPlaidOperation(db,f.hh,f.item,'sync')).toBeNull();
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  const fresh=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;expect(fresh.token).not.toBe(stale.token);
  await expect(commitLocalPlaidSync(db,stale,[page({nextCursor:'stale'})])).rejects.toThrow(refused);
  expect(await commitLocalPlaidSync(db,fresh,[page({nextCursor:'fresh'})])).toMatchObject({revision:1});
  await expect(commitLocalPlaidSync(db,fresh,[page({nextCursor:'again'})])).rejects.toThrow(refused);
  expect(await cursorOf(f.item)).toMatchObject({cursor:'fresh',revision:1n});
 });
 it('direct runtime SQL cannot write derived data, advance a cursor or forge events without the held lease',async()=>{const f=await connected(),a=account();
  for(const q of [
   tx=>tx.$executeRaw`INSERT INTO plaid_local_accounts(household_id,item_id,provider_account_id,name,kind) VALUES(${f.hh}::uuid,${f.item}::uuid,${a},'PUBLIC x','depository')`,
   tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET cursor='forged',revision=1 WHERE id=${f.item}::uuid`,
   tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='login-required' WHERE id=${f.item}::uuid`,
   tx=>tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${f.item}::uuid`,
   tx=>tx.$executeRaw`DELETE FROM plaid_local_items WHERE id=${f.item}::uuid`,
   tx=>tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${f.hh}::uuid,'plaid.local_sync_committed','plaid-local-item',${f.item}::uuid,'{"version":1,"revision":1}'::jsonb)`,
   tx=>tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${f.hh}::uuid,'plaid.local_item_removed','plaid-local-item',${f.item}::uuid,'{"version":1}'::jsonb)`,
  ] as Array<(tx:Parameters<Parameters<Database['withHousehold']>[1]>[0])=>Promise<unknown>>)await expect(db.withHousehold(f.hh,q)).rejects.toThrow();
  const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  // Holding a lease on Item A never authorizes writes against Item B.
  const g=await connected();await expect(db.withHousehold(g.hh,async tx=>{await tx.$executeRaw`SELECT set_config('request.plaid_op',${claim.token},true)`;
   await tx.$executeRaw`INSERT INTO plaid_local_accounts(household_id,item_id,provider_account_id,name,kind) VALUES(${g.hh}::uuid,${g.item}::uuid,${a},'PUBLIC x','depository')`;})).rejects.toThrow(refused);
  // A temporary relation cannot impersonate the lease table inside the trusted guard.
  await expect(db.withHousehold(f.hh,async tx=>{await tx.$executeRaw`CREATE TEMP TABLE plaid_local_cursors(id uuid,household_id uuid,op text,op_until timestamptz,op_token uuid) ON COMMIT DROP`;
   await tx.$executeRaw`INSERT INTO pg_temp.plaid_local_cursors VALUES(${g.item}::uuid,${g.hh}::uuid,'sync',now()+interval '1 hour',${claim.token}::uuid)`;await tx.$executeRaw`SELECT set_config('request.plaid_op',${claim.token},true)`;
   await tx.$executeRaw`INSERT INTO public.plaid_local_accounts(household_id,item_id,provider_account_id,name,kind) VALUES(${f.hh}::uuid,${g.item}::uuid,${a},'PUBLIC x','depository')`;})).rejects.toThrow();
  expect(await admin.plaidLocalAccount.count({where:{itemId:{in:[f.item,g.item]}}})).toBe(0);
 });
});

describe('database guards hold without the TypeScript pre-checks',()=>{
 type Tx=Parameters<Parameters<Database['withHousehold']>[1]>[0];
 const as=(f:{hh:string},token:string|null,q:(tx:Tx)=>Promise<unknown>)=>db.withHousehold(f.hh,async tx=>{if(token)await tx.$executeRaw`SELECT set_config('request.plaid_op',${token},true)`;return q(tx);});
 it('a real lease is still required, bounded in time, exact in revision and paired with its closed event',async()=>{const f=await connected(),a=account();
  const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  const insert=(tx:Tx)=>tx.$executeRaw`INSERT INTO plaid_local_accounts(household_id,item_id,provider_account_id,name,kind) VALUES(${f.hh}::uuid,${f.item}::uuid,${a},'PUBLIC x','depository')`;
  await expect(as(f,null,insert)).rejects.toThrow(refused);
  await expect(as(f,randomUUID(),insert)).rejects.toThrow(refused);
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET cursor='skip',revision=2,op=NULL,op_token=NULL,last_outcome='synced' WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET cursor='quiet',revision=1,op=NULL,op_token=NULL,last_outcome='synced' WHERE id=${f.item}::uuid`)).rejects.toThrow('commit incomplete');
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence='provider-acknowledged' WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET op='remove',op_token=${randomUUID()}::uuid WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  // A non-holder cannot publish even with a well-formed closed event for the next revision.
  const steal=(tx:Tx)=>tx.$executeRaw`UPDATE plaid_local_cursors SET cursor='stolen',revision=1,op=NULL,op_token=NULL,last_outcome='synced' WHERE id=${f.item}::uuid`;
  const event=(tx:Tx)=>tx.$executeRaw`INSERT INTO outbox_events(household_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${f.hh}::uuid,'plaid.local_sync_committed','plaid-local-item',${f.item}::uuid,'{"version":1,"revision":1}'::jsonb)`;
  await expect(as(f,randomUUID(),async tx=>{await event(tx);await steal(tx);})).rejects.toThrow();
  await expect(as(f,null,steal)).rejects.toThrow(refused);
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  await expect(as(f,c.token,insert)).rejects.toThrow(refused);
  await expect(as(f,c.token,async tx=>{await event(tx);await steal(tx);})).rejects.toThrow();
  expect(await admin.plaidLocalAccount.count({where:{itemId:f.item}})).toBe(0);expect(await cursorOf(f.item)).toMatchObject({cursor:null,revision:0n});
 });
 it('an unexpired lease cannot be taken over, and a fence landing mid-lease stops derived writes',async()=>{const f=await connected(),a=account();
  const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  for(const kind of ['sync','rotate','reconcile'])await expect(as(f,null,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET op=${kind},op_token=${randomUUID()}::uuid WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  expect((await cursorOf(f.item)).opToken).toBe(c.token);
  await fence(f.hh,f.owner,'fenced');
  await expect(as(f,c.token,tx=>tx.$executeRaw`INSERT INTO plaid_local_accounts(household_id,item_id,provider_account_id,name,kind) VALUES(${f.hh}::uuid,${f.item}::uuid,${a},'PUBLIC x','depository')`)).rejects.toThrow('fenced');
  expect(await admin.plaidLocalAccount.count({where:{itemId:f.item}})).toBe(0);
 });
 it('signals newer than the claim cannot be marked applied by that claim',async()=>{const f=await connected(),s=signer();
  const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;const raw=body(f.providerItemId);await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw));
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_webhooks SET state='applied' WHERE item_id=${f.item}::uuid`)).rejects.toThrow(refused);
 });
 it('removal custody rules: no destruction before evidence, no evidence without destruction, no acknowledgement from reconciliation',async()=>{const f=await connected();
  await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item));const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'remove'))!;
  await expect(as(f,c.token,tx=>tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence='provider-acknowledged' WHERE id=${f.item}::uuid`)).rejects.toThrow('commit incomplete');
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='removed' WHERE id=${f.item}::uuid`)).rejects.toThrow();
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='active' WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  const g=await connected();await runAsUser(g.owner,()=>requestLocalPlaidUnlink(appDb,g.hh,g.item));await runLocalPlaidRemoval(db,g.hh,g.item,g.keyring,{remove:async()=>{throw new Error('?');}});
  const r=(await claimLocalPlaidOperation(db,g.hh,g.item,'reconcile'))!;
  await expect(as(g,r.token,async tx=>{await tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence='provider-acknowledged' WHERE id=${g.item}::uuid`;await tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${g.item}::uuid`;})).rejects.toThrow(refused);
  expect(await state(f.item)).toBe('unlinking');expect(await state(g.item)).toBe('removal-indeterminate');
 });
 it('a removal that the owner asked to delete history for cannot commit with history left behind',async()=>{const f=await connected(),a=account();
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:1,availableCents:1}],added:[txn(a,-5)],nextCursor:'d1'})]])));
  await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item));const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'remove'))!;
  await expect(as(f,c.token,async tx=>{await tx.$executeRaw`UPDATE plaid_local_items SET state='removed',removal_evidence='provider-acknowledged' WHERE id=${f.item}::uuid`;
   await tx.$executeRaw`DELETE FROM plaid_local_credentials WHERE id=${f.item}::uuid`;})).rejects.toThrow('commit incomplete');
  expect(await state(f.item)).toBe('unlinking');expect(await admin.plaidLocalTransaction.count({where:{itemId:f.item}})).toBe(1);
 });
 it('rotation must move custody and Item revision together by exactly one',async()=>{const f=await connected();const c=(await claimLocalPlaidOperation(db,f.hh,f.item,'rotate'))!;
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET credential_revision=3 WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_items SET credential_revision=2 WHERE id=${f.item}::uuid`)).rejects.toThrow('commit incomplete');
  await expect(as(f,c.token,tx=>tx.$executeRaw`UPDATE plaid_local_credentials SET revision=2 WHERE id=${f.item}::uuid`)).rejects.toThrow(refused);
  expect(await admin.plaidLocalItem.findUniqueOrThrow({where:{id:f.item},select:{credentialRevision:true}})).toEqual({credentialRevision:1});
 });
});

describe('status, reconnect and rotation',()=>{
 it('login-required and revoked are projected from a current read; owner reconnect schedules a read that restores active',async()=>{const f=await connected();
  expect(await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,new LocalPlaidProviderSignal('login-required')]])))).toEqual({status:'released',outcome:'login-required'});
  expect(await state(f.item)).toBe('login-required');expect((await cursorOf(f.item)).refreshRequested).toBe(false);
  expect(await admin.outboxEvent.count({where:{aggregateId:f.item,eventType:'plaid.local_item_status_changed'}})).toBe(1);
  await expect(requestLocalPlaidReconnect(appDb,f.hh,f.item)).rejects.toThrow(refused);
  expect(await runAsUser(f.owner,()=>requestLocalPlaidReconnect(appDb,f.hh,f.item))).toEqual({state:'login-required',refreshRequested:true});
  await expect(appDb.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET refresh_requested=true WHERE id=${f.item}::uuid`)).rejects.toThrow();
  expect(await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({nextCursor:'r1'})]])))).toMatchObject({status:'committed'});
  expect(await state(f.item)).toBe('active');
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([['r1',new LocalPlaidProviderSignal('revoked')]])));expect(await state(f.item)).toBe('revoked');
  expect(await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([['r1',new LocalPlaidProviderSignal('unavailable')]])))).toEqual({status:'released',outcome:'unavailable'});
  expect(await state(f.item)).toBe('revoked');expect((await cursorOf(f.item)).cursor).toBe('r1');
 });
 it('a refresh requested during an in-flight read survives that read',async()=>{const f=await connected(),s=signer();
  const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;const raw=body(f.providerItemId,'DEFAULT_UPDATE');await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw));
  await commitLocalPlaidSync(db,claim,[page({nextCursor:'w1'})]);
  expect((await cursorOf(f.item)).refreshRequested).toBe(true);expect(await admin.plaidLocalWebhook.findMany({where:{itemId:f.item},select:{state:true}})).toEqual([{state:'pending'}]);
 });
 it('rotation is compare-and-swap to the next revision; stale readers and old envelopes lose',async()=>{const f=await connected();
  const reader=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  const oldEnvelope=reader.envelope;f.keyring.rotateKey();
  expect(await runLocalPlaidRotation(db,f.hh,f.item,f.keyring)).toEqual({status:'rotated',credentialRevision:2});
  await expect(commitLocalPlaidSync(db,reader,[page({nextCursor:'z'})])).rejects.toThrow(refused);
  const next=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;expect(next.credentialRevision).toBe(2);expect(next.envelope.keyVersion).toBe(2);
  let seen='';f.keyring.use(next.binding,next.envelope,t=>{seen=t;});expect(seen).toBe(f.token);
  expect(()=>f.keyring.use({...next.binding,revision:1},next.envelope,()=>undefined)).toThrow();expect(()=>f.keyring.use(next.binding,oldEnvelope,()=>undefined)).toThrow();
  f.keyring.retire(1);expect(()=>f.keyring.use(reader.binding,oldEnvelope,()=>undefined)).toThrow();
  expect(await admin.plaidLocalCredential.findUniqueOrThrow({where:{id:f.item},select:{revision:true,keyVersion:true}})).toEqual({revision:2,keyVersion:2});
 });
});

describe('unlink, removal and reconciliation',()=>{
 it('owner unlink fences an in-flight sync; removal preempts it and destroys custody only on established evidence',async()=>{const f=await connected(),a=account();
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:1,availableCents:1}],added:[txn(a,-5)],nextCursor:'u1'})]])));
  const inflight=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  await expect(requestLocalPlaidUnlink(appDb,f.hh,f.item)).rejects.toThrow(refused);
  expect(await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item))).toEqual({state:'unlinking',history:'delete'});
  await expect(commitLocalPlaidSync(db,inflight,[page({nextCursor:'u2'})])).rejects.toThrow(refused);
  expect(await claimLocalPlaidOperation(db,f.hh,f.item,'sync')).toBeNull();
  let removals=0;expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async t=>{removals++;expect(t).toBe(f.token);}})).toEqual({status:'recorded',state:'removed',evidence:'provider-acknowledged'});
  expect(removals).toBe(1);expect(await admin.plaidLocalItem.findUniqueOrThrow({where:{id:f.item},select:{state:true,removalEvidence:true}})).toEqual({state:'removed',removalEvidence:'provider-acknowledged'});
  expect(await admin.plaidLocalCredential.count({where:{id:f.item}})).toBe(0);
  expect(await admin.auditLog.count({where:{householdId:f.hh,action:'plaid_local_credentials.delete'}})).toBe(1);
  expect(await admin.outboxEvent.count({where:{aggregateId:f.item,eventType:{in:['plaid.local_unlink_requested','plaid.local_item_removed']}}})).toBe(2);
  // Default owner choice at unlink is to delete imported history once removal is established.
  expect(await admin.plaidLocalTransaction.count({where:{itemId:f.item}})).toBe(0);
  expect(await admin.plaidLocalAccount.count({where:{itemId:f.item}})).toBe(0);
  expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async()=>{removals++;}})).toEqual({status:'not-claimable'});expect(removals).toBe(1);
 });
 it('the owner chooses whether imported history survives disconnect; an unknown outcome keeps it until reconciled',async()=>{
  const seed=async(f:Awaited<ReturnType<typeof connected>>)=>{const a=account();await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:1,availableCents:1}],added:[txn(a,-5),txn(a,-6)],nextCursor:'h1'})]])));};
  const kept=await connected();await seed(kept);
  expect(await runAsUser(kept.owner,()=>requestLocalPlaidUnlink(appDb,kept.hh,kept.item,'retain'))).toEqual({state:'unlinking',history:'retain'});
  await runLocalPlaidRemoval(db,kept.hh,kept.item,kept.keyring,{remove:async()=>undefined});
  expect(await admin.plaidLocalTransaction.count({where:{itemId:kept.item}})).toBe(2);
  expect(await admin.plaidLocalCredential.count({where:{id:kept.item}})).toBe(0);
  const unknown=await connected();await seed(unknown);
  await runAsUser(unknown.owner,()=>requestLocalPlaidUnlink(appDb,unknown.hh,unknown.item));
  await runLocalPlaidRemoval(db,unknown.hh,unknown.item,unknown.keyring,{remove:async()=>{throw new Error('timeout');}});
  expect(await admin.plaidLocalTransaction.count({where:{itemId:unknown.item}})).toBe(2);
  await runLocalPlaidReconcile(db,unknown.hh,unknown.item,unknown.keyring,{status:async()=>{throw new LocalPlaidProviderSignal('item-not-found');}});
  expect(await admin.plaidLocalTransaction.count({where:{itemId:unknown.item}})).toBe(0);
  expect(await admin.plaidLocalAccount.count({where:{itemId:unknown.item}})).toBe(0);
  // Only the owner's unlink request sets the choice; the runtime cannot flip it and cannot
  // delete history without an established removal under its lease.
  const g=await connected();await seed(g);
  await expect(runAsUser(g.owner,()=>appDb.withHousehold(g.hh,tx=>tx.$executeRaw`UPDATE plaid_local_items SET history_after_removal='retain' WHERE id=${g.item}::uuid`))).rejects.toThrow();
  await expect(db.withHousehold(g.hh,tx=>tx.$executeRaw`DELETE FROM plaid_local_accounts WHERE item_id=${g.item}::uuid`)).rejects.toThrow();
  await runAsUser(g.owner,()=>requestLocalPlaidUnlink(appDb,g.hh,g.item,'retain'));
  const c=(await claimLocalPlaidOperation(db,g.hh,g.item,'remove'))!;
  await expect(db.withHousehold(g.hh,async tx=>{await tx.$executeRaw`SELECT set_config('request.plaid_op',${c.token},true)`;await tx.$executeRaw`UPDATE plaid_local_items SET history_after_removal='delete' WHERE id=${g.item}::uuid`;})).rejects.toThrow('permission denied'); // no column grant at all
  await expect(db.withHousehold(g.hh,async tx=>{await tx.$executeRaw`SELECT set_config('request.plaid_op',${c.token},true)`;await tx.$executeRaw`DELETE FROM plaid_local_transactions WHERE item_id=${g.item}::uuid`;})).rejects.toThrow(refused);
  await expect(runAsUser(g.owner,()=>requestLocalPlaidUnlink(appDb,g.hh,g.item,'maybe' as 'delete'))).rejects.toThrow(refused);
 });
 it('an unknown removal outcome keeps custody, is never retried automatically, and reconciles only on established absence',async()=>{const f=await connected();
  await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item));let removals=0;
  expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async()=>{removals++;throw new Error('socket timeout: private diagnostic');}})).toEqual({status:'recorded',state:'removal-indeterminate'});
  expect(await admin.plaidLocalCredential.count({where:{id:f.item}})).toBe(1);
  expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async()=>{removals++;}})).toEqual({status:'not-claimable'});expect(removals).toBe(1);
  expect(await runLocalPlaidReconcile(db,f.hh,f.item,f.keyring,{status:async()=>'present'})).toEqual({status:'recorded',state:'removal-indeterminate'});
  expect((await cursorOf(f.item)).lastOutcome).toBe('still-present');
  expect(await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item))).toEqual({state:'unlinking',history:'delete'});
  expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async()=>{removals++;throw new LocalPlaidProviderSignal('item-not-found');}})).toEqual({status:'recorded',state:'removed',evidence:'provider-invalid'});
  expect(removals).toBe(2);expect(await admin.plaidLocalCredential.count({where:{id:f.item}})).toBe(0);
  const g=await connected();await runAsUser(g.owner,()=>requestLocalPlaidUnlink(appDb,g.hh,g.item));await runLocalPlaidRemoval(db,g.hh,g.item,g.keyring,{remove:async()=>{throw new Error('?');}});
  expect(await runLocalPlaidReconcile(db,g.hh,g.item,g.keyring,{status:async()=>{throw new Error('provider down');}})).toEqual({status:'unresolved'});
  await admin.plaidLocalCursor.update({where:{id:g.item},data:{opUntil:new Date(0)}});
  expect(await runLocalPlaidReconcile(db,g.hh,g.item,g.keyring,{status:async()=>{throw new LocalPlaidProviderSignal('item-not-found');}})).toEqual({status:'recorded',state:'removed',evidence:'provider-invalid'});
 });
 it('a runner that crashes mid-removal leaves an indeterminate Item, never a second attempt',async()=>{const f=await connected();
  await runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item));const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'remove'))!;expect(claim).not.toBeNull();
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  expect(await claimLocalPlaidOperation(db,f.hh,f.item,'remove')).toBeNull();
  expect(await state(f.item)).toBe('removal-indeterminate');expect(await admin.plaidLocalCredential.count({where:{id:f.item}})).toBe(1);
  expect((await cursorOf(f.item)).lastOutcome).toBe('removal-indeterminate');
 });
 it('app_user may only request unlink with its intent; it cannot remove, reactivate or skip the intent',async()=>{const f=await connected();
  for(const q of [tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='removed' WHERE id=${f.item}::uuid`,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='unlinking' WHERE id=${f.item}::uuid`,
   tx=>tx.$executeRaw`UPDATE plaid_local_items SET credential_revision=2 WHERE id=${f.item}::uuid`,tx=>tx.$executeRaw`DELETE FROM plaid_local_items WHERE id=${f.item}::uuid`,
   tx=>tx.$queryRaw`SELECT ciphertext FROM plaid_local_credentials`,tx=>tx.$executeRaw`INSERT INTO plaid_local_webhooks(household_id,item_id,signal,body_digest) VALUES(${f.hh}::uuid,${f.item}::uuid,'transactions',${'a'.repeat(64)})`,
  ] as Array<(tx:Parameters<Parameters<Database['withHousehold']>[1]>[0])=>Promise<unknown>>)await expect(runAsUser(f.owner,()=>appDb.withHousehold(f.hh,q))).rejects.toThrow();
  expect(await state(f.item)).toBe('active');
 });
});

describe('deletion fence, owner continuity and roles',()=>{
 it('a fenced household admits only erasure-direction removal, without owner or outbox; completion closes everything',async()=>{const f=await connected();
  await fence(f.hh,f.owner,'fenced');
  expect(await claimLocalPlaidOperation(db,f.hh,f.item,'sync')).toBeNull();expect(await claimLocalPlaidOperation(db,f.hh,f.item,'rotate')).toBeNull();
  await expect(runAsUser(f.owner,()=>requestLocalPlaidUnlink(appDb,f.hh,f.item))).rejects.toThrow();
  await admin.householdUser.deleteMany({where:{householdId:f.hh,userId:f.owner}});
  expect(await runLocalPlaidRemoval(db,f.hh,f.item,f.keyring,{remove:async()=>undefined})).toEqual({status:'recorded',state:'removed',evidence:'provider-acknowledged'});
  expect(await admin.plaidLocalCredential.count({where:{id:f.item}})).toBe(0);expect(await admin.outboxEvent.count({where:{aggregateId:f.item,eventType:'plaid.local_item_removed'}})).toBe(0);
  const g=await connected();await fence(g.hh,g.owner,'completed');
  for(const kind of ['sync','remove','reconcile','rotate'] as const)expect(await claimLocalPlaidOperation(db,g.hh,g.item,kind)).toBeNull();
  await expect(db.withHousehold(g.hh,tx=>tx.$executeRaw`UPDATE plaid_local_cursors SET refresh_requested=true WHERE id=${g.item}::uuid`)).rejects.toThrow();
 });
 it('losing the bound owner refuses ordinary financial reads and writes',async()=>{const f=await connected();
  await admin.householdUser.deleteMany({where:{householdId:f.hh,userId:f.owner}});
  await expect(claimLocalPlaidOperation(db,f.hh,f.item,'sync')).rejects.toThrow();
  const g=await connected(),claim=(await claimLocalPlaidOperation(db,g.hh,g.item,'sync'))!;await admin.user.update({where:{id:g.owner},data:{status:'suspended'}});
  await expect(commitLocalPlaidSync(db,claim,[page({nextCursor:'o1'})])).rejects.toThrow(refused);expect((await cursorOf(g.item)).revision).toBe(0n);
 });
 it('an administrative suspension committing during a sync makes the financial commit wait and then refuse',async()=>{const f=await connected(),a=account();
  const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  // Uncommitted suspension holds the exclusive account-status fence.
  const suspension=admin.$transaction(async tx=>{await tx.$executeRaw`UPDATE users SET status='suspended' WHERE id=${f.owner}::uuid`;await gate;},{timeout:20000});
  await new Promise(r=>setTimeout(r,200));
  const commit=commitLocalPlaidSync(db,claim,[page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:1,availableCents:1}],nextCursor:'s1'})]);
  const outcome=commit.then(()=>'committed',()=>'refused');
  // The suspension transaction is ALWAYS released, so a broken fence fails this assertion
  // cleanly instead of leaving a lock that times out the suite's cleanup hooks.
  let freed=false;const free=()=>{if(!freed){freed=true;release();}};
  try{
   // The commit must be blocked on the fence, not racing past a stale 'active' read.
   let waiting=0;for(let n=0;n<50&&!waiting;n++){await new Promise(r=>setTimeout(r,100));
    const [w]=await admin.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM pg_stat_activity WHERE usename='app_plaid_sandbox' AND wait_event_type='Lock' AND wait_event='advisory'`;waiting=Number(w!.n);}
   expect(waiting).toBe(1);
   free();await suspension;
   expect(await outcome).toBe('refused');
  }finally{free();await suspension.catch(()=>undefined);await outcome;}
  expect(await cursorOf(f.item)).toMatchObject({revision:0n,cursor:null});expect(await admin.plaidLocalAccount.count({where:{itemId:f.item}})).toBe(0);
 });
 it('a financial commit holding the fence finishes before a later suspension applies',async()=>{const f=await connected();
  const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  expect(await commitLocalPlaidSync(db,claim,[page({nextCursor:'t1'})])).toMatchObject({revision:1});
  await admin.user.update({where:{id:f.owner},data:{status:'suspended'}});
  await expect(claimLocalPlaidOperation(db,f.hh,f.item,'sync')).rejects.toThrow();
 });
 it.each(['app_document_worker','app_job_worker','app_billing_test','app_retention_worker','app_deletion_verifier'])('%s has no financial data, cursor or inbox authority',async role=>{const f=await connected();let c:PrismaClient|undefined;
  try{await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'plaid_denial_local_only'`);const u=new URL(ADMIN_URL);u.username=role;u.password='plaid_denial_local_only';c=new PrismaClient({datasourceUrl:u.toString()});const other=new Database(c);
   for(const q of [tx=>tx.$queryRaw`SELECT description FROM plaid_local_transactions`,tx=>tx.$queryRaw`SELECT name FROM plaid_local_accounts`,tx=>tx.$queryRaw`SELECT cursor FROM plaid_local_cursors`,
    tx=>tx.$queryRaw`SELECT body_digest FROM plaid_local_webhooks`,tx=>tx.$queryRaw`SELECT route_digest FROM plaid_local_item_routes`,tx=>tx.$executeRaw`UPDATE plaid_local_items SET state='removed'`] as Array<(tx:Parameters<Parameters<Database['withHousehold']>[1]>[0])=>Promise<unknown>>)
    await expect(other.withHousehold(f.hh,q)).rejects.toThrow('permission denied');
  }finally{await c?.$disconnect();await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);}});
 it('every new journal is inventoried and reconciled by restricted privacy roles, which cannot read or retire it',async()=>{const f=await connected(),a=account(),s=signer(),raw=body(f.providerItemId);const clients:PrismaClient[]=[];
  await runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map([[null,page({accounts:[{accountId:a,name:'PUBLIC Checking',kind:'depository',currentCents:1,availableCents:1}],added:[txn(a,-5)],nextCursor:'i1'})]])));
  await runLocalPlaidWebhook(db,s.verify,raw,s.header(raw));
  const other=await connected();expect(await db.withHousehold(other.hh,tx=>tx.$queryRaw`SELECT id FROM plaid_local_transactions UNION ALL SELECT id FROM plaid_local_accounts UNION ALL SELECT id FROM plaid_local_webhooks`)).toEqual([]);
  expect(await runtime.$queryRaw`SELECT id FROM plaid_local_cursors UNION ALL SELECT id FROM plaid_local_transactions`).toEqual([]);
  const deletion=await fence(f.hh,f.owner,'fenced');
  try{for(const role of ['app_retention_worker','app_deletion_verifier']){await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'local_plaid_privacy_only'`);const u=new URL(ADMIN_URL);u.username=role;u.password='local_plaid_privacy_only';clients.push(new PrismaClient({datasourceUrl:u.toString()}));}
   const retention=new Database(clients[0]!),verifier=new Database(clients[1]!);
   for(const source of ['plaid-routes','plaid-cursors','plaid-webhooks','plaid-accounts','plaid-transactions'] as const){expect(PRIVACY_INVENTORY_SOURCES).toContain(source);
    expect(await inventoryLocalDeletionPage(retention,f.hh,deletion.id,source)).toMatchObject({recorded:1,more:false});
    expect(await reconcileLocalDeletionInventory(verifier,f.hh,deletion.id,source)).toMatchObject({sourceCount:1,localSourceMatches:true,finalReceiptIssuable:false});}
   await expect(verifier.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT description FROM plaid_local_transactions`)).rejects.toThrow('permission denied');
   await expect(retention.withHousehold(f.hh,tx=>tx.$executeRaw`DELETE FROM plaid_local_transactions`)).rejects.toThrow('permission denied');
  }finally{await Promise.all(clients.map(c=>c.$disconnect()));for(const role of ['app_retention_worker','app_deletion_verifier'])await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);}
 });
 it('all trusted guards (new ones included) pin temporary objects last and none is SECURITY DEFINER',async()=>{
  const fns=await admin.$queryRaw<Array<{fn:string;proconfig:string[]|null;prosecdef:boolean}>>`SELECT p.oid::regprocedure::text AS fn,proconfig,prosecdef FROM pg_proc p WHERE pronamespace='app'::regnamespace ORDER BY 1`;
  expect(fns.filter(f=>f.prosecdef)).toEqual([]);
  // Only the two context readers (no table lookups) are exempt; every other function is pinned.
  expect(fns.filter(f=>!f.proconfig).map(f=>f.fn)).toEqual(['app.current_household()','app.current_user_id()']);
  for(const f of fns.filter(x=>x.proconfig))expect(f.proconfig).toEqual(['search_path=pg_catalog, public, app, pg_temp']);
 });
});

/* Fake key service with the one property that matters: a wrapped key unwraps only under the
 * identical key ID and encryption context. A test double — NOT evidence of any real KMS. */
function fakeKms():KmsPort{const master=randomBytes(32);
 const aad=(keyId:string,c:Readonly<Record<string,string>>)=>Buffer.concat([Buffer.from(keyId),Buffer.from(JSON.stringify(Object.keys(c).sort().map(k=>[k,c[k]])))]);
 return{async generateDataKey({keyId,encryptionContext}){const pt=randomBytes(32),n=randomBytes(12),c=createCipheriv('aes-256-gcm',master,n);c.setAAD(aad(keyId,encryptionContext));
   return{plaintext:Uint8Array.from(pt),ciphertext:Buffer.concat([n,c.update(pt),c.final(),c.getAuthTag()]),keyId};},
  async decrypt({keyId,ciphertext,encryptionContext}){const b=Buffer.from(ciphertext),d=createDecipheriv('aes-256-gcm',master,b.subarray(0,12));d.setAAD(aad(keyId,encryptionContext));d.setAuthTag(b.subarray(-16));
   return{plaintext:Uint8Array.from(Buffer.concat([d.update(b.subarray(12,-16)),d.final()])),keyId};}};}
describe('reviewed credential envelope v2 (KMS-shaped; fake key service, not KMS evidence)',()=>{
 it('rotation moves custody from the local envelope to v2 by compare-and-swap, and never back',async()=>{const f=await connected();
  const keyId='alias/pellum-test-financial',kms=createKmsCustody(fakeKms(),keyId);
  const claim=(await claimLocalPlaidOperation(db,f.hh,f.item,'rotate'))!;
  let token='';f.keyring.use(claim.binding,claim.envelope as never,t=>{token=t;});
  const v2=await kms.seal({...claim.binding,revision:claim.credentialRevision+1},token);
  expect(await commitLocalPlaidRotation(db,claim,v2)).toEqual({credentialRevision:2});
  expect(await admin.plaidLocalCredential.findUniqueOrThrow({where:{id:f.item}})).toMatchObject({version:2,keyId,wrapNonce:null,keyVersion:1,revision:2});
  const next=(await claimLocalPlaidOperation(db,f.hh,f.item,'sync'))!;
  expect(next.envelope).toMatchObject({version:2,keyId});
  expect(await kms.useAsync(next.binding,next.envelope as never,async t=>t===f.token)).toBe(true);
  // The previous-revision binding cannot open the new envelope.
  await expect(kms.useAsync({...next.binding,revision:1},next.envelope as never,async()=>true)).rejects.toThrow();
  // The local synthetic runtime refuses a v2 envelope rather than guessing at it.
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  await expect(runLocalPlaidSync(db,f.hh,f.item,f.keyring,bank(f.token,new Map()))).rejects.toThrow();
  // Custody never weakens: a rotation back to a local v1 envelope is refused by the database.
  await admin.plaidLocalCursor.update({where:{id:f.item},data:{opUntil:new Date(0)}});
  const back=(await claimLocalPlaidOperation(db,f.hh,f.item,'rotate'))!;
  const v1=f.keyring.seal({...back.binding,revision:back.credentialRevision+1} as never,f.token);
  await expect(commitLocalPlaidRotation(db,back,v1)).rejects.toThrow(refused);
  expect(await admin.plaidLocalCredential.findUniqueOrThrow({where:{id:f.item},select:{version:true,revision:true}})).toEqual({version:2,revision:2});
 });
 it('the database refuses mixed or malformed envelopes whatever the writer',async()=>{const f=await connected();
  for(const data of [{version:2},{keyId:'alias/x'},{version:2,keyId:'alias/x'},{version:2,keyId:'alias/x',wrapNonce:null,keyVersion:1,wrappedKey:'short'},{version:3}])
   await expect(admin.plaidLocalCredential.update({where:{id:f.item},data})).rejects.toThrow(/plaid_credential_envelope|check constraint/);
  expect(await admin.plaidLocalCredential.findUniqueOrThrow({where:{id:f.item},select:{version:true,keyId:true}})).toEqual({version:1,keyId:null});
 });
});
