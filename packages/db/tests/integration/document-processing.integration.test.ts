import { createHash,randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsSystem,runAsUser } from "../../src/audit.js";
import { registerCleanCustody,markCleanCustodyReady,reserveDocumentProcessing,startDocumentProcessing,finishDocumentProcessing,reconcileDocumentProcessing,readDocumentProcessingUsage } from "../../src/document-processing.js";
import { ADMIN_URL,APP_URL,bootstrapDatabase,grantAppUserLogin } from "./setup.js";
let admin:PrismaClient,worker:PrismaClient,app:PrismaClient,db:Database,appDb:Database;
import { mkdtempSync,rmSync } from "node:fs";
import { localCleanCustody } from "../../src/local-clean-custody.js";
import { requestOwnerExport,readOwnerExportSnapshot } from "../../src/privacy-export.js";
const households:string[]=[],owners:string[]=[];
beforeAll(async()=>{await bootstrapDatabase();await grantAppUserLogin();admin=new PrismaClient({datasourceUrl:ADMIN_URL});app=new PrismaClient({datasourceUrl:APP_URL});appDb=new Database(app);
 await admin.$executeRawUnsafe("ALTER ROLE app_document_worker LOGIN PASSWORD 'local_processing_only'");const u=new URL(ADMIN_URL);u.username='app_document_worker';u.password='local_processing_only';worker=new PrismaClient({datasourceUrl:u.toString()});db=new Database(worker);
},120000);
afterAll(async()=>{
 if(admin){const where={householdId:{in:households}};
  await admin.documentProcessing.deleteMany({where});await admin.documentCustody.deleteMany({where});await admin.documentScanAttempt.deleteMany({where});await admin.documentScan.deleteMany({where});
  await admin.stripeTestState.deleteMany({where});await admin.stripeTestIntent.deleteMany({where});await admin.stripeTestRoute.deleteMany({where});await admin.stripeTestCheckout.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});
  await admin.householdDeletion.deleteMany({where});await admin.outboxEvent.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:owners}}});
  await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});await admin.$executeRawUnsafe("ALTER ROLE app_document_worker NOLOGIN PASSWORD NULL");
 }await Promise.all([admin,worker,app].map(c=>c?.$disconnect()));
});
async function household(){const hh=randomUUID(),owner=randomUUID();households.push(hh);owners.push(owner);
 await admin.user.create({data:{id:owner,email:`${owner}@example.test`}});await admin.household.create({data:{id:hh,createdBy:owner,name:"PUBLIC quota fixture"}});
 await admin.householdUser.create({data:{householdId:hh,userId:owner,role:'owner'}});await admin.entitlement.create({data:{householdId:hh,periodStart:new Date()}});return{hh,owner};}
async function clean(hh:string,state='clean'){
 const doc=randomUUID(),seal=randomUUID(),bytes=Buffer.from(`PUBLIC SYNTHETIC ${doc}`),hash=createHash('sha256').update(bytes).digest();
 await admin.document.create({data:{id:doc,householdId:hh,source:'upload',status:'processing',storagePath:`hh/${hh}/upload/${doc}/sealed/${seal}`,mimeType:'application/pdf',sizeBytes:bytes.length,sha256:hash}});
 const scan=await admin.documentScan.create({data:{householdId:hh,documentId:doc,sealId:seal,sha256:hash,sizeBytes:bytes.length,state}});
 return{doc,scan:scan.id,hash,bytes};
}
async function ready(hh:string){const f=await clean(hh),custody=await registerCleanCustody(db,hh,f.scan),id=await markCleanCustodyReady(db,hh,custody.id);return{...f,custody,id};}
async function reserved(hh:string){const f=await ready(hh),lease=(await reserveDocumentProcessing(db,hh,f.id))!;return{...f,lease};}
async function seededUsage(hh:string,n:number){for(let i=0;i<n;i++){
 const f=await ready(hh);
 await admin.$executeRaw`UPDATE document_processing SET state='completed',attempts=1,period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',period_end=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',tier='premium',catalog_version=1,entitlement_revision=0,limit_snapshot=50,lease_token=${randomUUID()}::uuid,lease_until=clock_timestamp()+interval '90 seconds',result_ref=${randomUUID()}::uuid,charged_at=clock_timestamp() WHERE id=${f.id}::uuid`;
 await admin.documentCustody.update({where:{id:f.custody.id},data:{state:'absent'}});
}}
async function premium(hh:string,owner:string){
 const b=await admin.stripeTestBinding.create({data:{householdId:hh,ownerId:owner,accountId:'acct_Synthetic',customerId:'cus_'+randomUUID().replaceAll('-',''),subscriptionId:'sub_'+randomUUID().replaceAll('-',''),livemode:false}});
 const intent=await admin.stripeTestIntent.create({data:{householdId:hh,bindingId:b.id,accountId:b.accountId,requestKey:randomUUID(),reason:'scheduled-recheck'}});
 await admin.$executeRaw`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_intent_id,source_lease_token,revision,state,plan,paid_through,premium_until)
 VALUES(${hh}::uuid,${b.id}::uuid,${b.accountId},${intent.id}::uuid,${randomUUID()}::uuid,1,'active','monthly',extract(epoch FROM clock_timestamp())::bigint+86400,extract(epoch FROM clock_timestamp())::bigint+86400)`;
 await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
}
it('upload/scan/ready do not charge; duplicate custody is stable and unproven completion refuses',async()=>{
 const {hh}=await household(),f=await ready(hh);expect((await registerCleanCustody(db,hh,f.scan)).id).toBe(f.custody.id);
 expect(await markCleanCustodyReady(db,hh,f.custody.id)).toBe(f.id);expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:0,reserved:0,pending:1});
 const lease=(await reserveDocumentProcessing(db,hh,f.id))!;expect(await reserveDocumentProcessing(db,hh,f.id)).toBeNull();
 expect(await startDocumentProcessing(db,hh,f.id,randomUUID())).toBe(false);expect(await startDocumentProcessing(db,hh,f.id,lease.lease_token)).toBe(true);
 const result=randomUUID();await expect(finishDocumentProcessing(db,hh,f.id,lease.lease_token,result)).rejects.toThrow('Reviewed result authority');
 expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:0,reserved:1,pending:0});
 expect(await db.withHousehold(hh,tx=>tx.outboxEvent.count({where:{eventType:'document.processed'}}))).toBe(0);
});
it.each([10,50])('final %i slot concurrent claims cannot overbook',async cap=>{
 const {hh,owner}=await household();if(cap===50)await premium(hh,owner);
 try{await seededUsage(hh,cap-1);const a=await ready(hh),b=await ready(hh);
  const results=await Promise.allSettled([reserveDocumentProcessing(db,hh,a.id),reserveDocumentProcessing(db,hh,b.id)]);
  expect(results.filter(r=>r.status==='fulfilled'&&r.value)).toHaveLength(1);
  expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:cap-1,reserved:1,pending:1});
  const waiting=await appDb.withHousehold(hh,tx=>tx.documentProcessing.findFirstOrThrow({where:{householdId:hh,state:'waiting'}}));
  await expect(reserveDocumentProcessing(db,hh,waiting.id)).rejects.toThrow('allowance');
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it.each(['queued','rejected','exhausted'])('scanner %s cannot establish custody',async state=>{const{hh}=await household(),f=await clean(hh,state);await expect(registerCleanCustody(db,hh,f.scan)).rejects.toThrow();});
it('FIFO refuses later pending work, including with spare capacity',async()=>{const{hh}=await household(),a=await ready(hh),b=await ready(hh);await expect(reserveDocumentProcessing(db,hh,b.id)).rejects.toThrow('Earlier waiting');expect((await reconcileDocumentProcessing(db,hh)).next).toBe(a.id);});
it('expired unstarted reservation releases, but retry exhaustion cannot create free unlimited work',async()=>{
 const{hh}=await household(),f=await ready(hh);
 for(let i=0;i<3;i++){expect(await reserveDocumentProcessing(db,hh,f.id)).not.toBeNull();await admin.documentProcessing.update({where:{id:f.id},data:{leaseUntil:new Date(0)}});expect((await reconcileDocumentProcessing(db,hh)).released).toBe(1);}
 expect(await reserveDocumentProcessing(db,hh,f.id)).toBeNull();expect((await readDocumentProcessingUsage(appDb,hh)).completed).toBe(0);
 expect(await appDb.withHousehold(hh,tx=>tx.documentProcessing.findUniqueOrThrow({where:{id:f.id}}))).toMatchObject({state:'failed',attempts:3});
 expect((await readDocumentProcessingUsage(appDb,hh)).pending).toBe(0);
});
it('started crash/provider ambiguity retains slot and never automatically retries',async()=>{
 const{hh}=await household(),f=await reserved(hh);await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);await admin.documentProcessing.update({where:{id:f.id},data:{leaseUntil:new Date(0)}});
 expect((await reconcileDocumentProcessing(db,hh)).uncertain).toBe(1);expect(await reserveDocumentProcessing(db,hh,f.id)).toBeNull();expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:0,reserved:1,pending:0});
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_processing SET state='waiting' WHERE id=${f.id}::uuid`)).rejects.toThrow();
});
it('deterministic parse failure is uncharged and terminal',async()=>{const{hh}=await household(),f=await reserved(hh);await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);expect(await finishDocumentProcessing(db,hh,f.id,f.lease.lease_token,null)).toBe('failed');expect(await reserveDocumentProcessing(db,hh,f.id)).toBeNull();expect((await readDocumentProcessingUsage(appDb,hh)).completed).toBe(0);expect(await appDb.withHousehold(hh,tx=>tx.document.findUniqueOrThrow({where:{id:f.doc}}))).toMatchObject({status:'failed'});});
it('cross-period completion is refused instead of charging the wrong month',async()=>{const{hh}=await household(),f=await reserved(hh);await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);await admin.$executeRaw`UPDATE document_processing SET period_start=period_start-interval '1 month',period_end=period_start WHERE id=${f.id}::uuid`;
 await expect(finishDocumentProcessing(db,hh,f.id,f.lease.lease_token,randomUUID())).rejects.toThrow();expect((await readDocumentProcessingUsage(appDb,hh)).completed).toBe(0);
});
it('rollover does not reset old charges; waiting work can reserve in current month',async()=>{const{hh}=await household();await seededUsage(hh,10);const f=await ready(hh);await expect(reserveDocumentProcessing(db,hh,f.id)).rejects.toThrow('allowance');
 await admin.$executeRaw`UPDATE document_processing SET period_start=period_start-interval '1 month',period_end=period_end-interval '1 month' WHERE household_id=${hh}::uuid AND state='completed'`;
 expect(await reserveDocumentProcessing(db,hh,f.id)).not.toBeNull();expect(await db.withHousehold(hh,tx=>tx.documentProcessing.count({where:{state:'completed'}}))).toBe(10);
});
it('upgrade releases waiting work; downgrade/cadence revision refuses stale work without removing data',async()=>{
 const{hh,owner}=await household();await seededUsage(hh,10);const f=await ready(hh);await expect(reserveDocumentProcessing(db,hh,f.id)).rejects.toThrow('allowance');await premium(hh,owner);
 try{const lease=(await reserveDocumentProcessing(db,hh,f.id))!;await admin.stripeTestState.updateMany({where:{householdId:hh},data:{plan:'annual',revision:2}});
 await expect(startDocumentProcessing(db,hh,f.id,lease.lease_token)).rejects.toThrow('authority');await admin.stripeTestState.updateMany({where:{householdId:hh},data:{state:'canceled',premiumUntil:null,revision:3}});
 expect(await db.withHousehold(hh,tx=>tx.documentCustody.count())).toBe(11);expect((await readDocumentProcessingUsage(appDb,hh)).completed).toBe(10);
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it('grace/entitlement expiry before commit refuses reservation',async()=>{const{hh,owner}=await household();await premium(hh,owner);const f=await ready(hh);
 try{await admin.$executeRaw`UPDATE stripe_test_states SET state='grace',premium_until=ceil(extract(epoch FROM clock_timestamp()))::bigint+1 WHERE household_id=${hh}::uuid`;
 await expect(runAsSystem('Expiry race proof',()=>db.withHousehold(hh,async tx=>{await tx.$executeRaw`UPDATE document_processing SET state='reserved',lease_token=${randomUUID()}::uuid WHERE id=${f.id}::uuid`;await tx.$executeRaw`SELECT pg_sleep(2.1)`;}))).rejects.toThrow('commit authority');
 expect((await readDocumentProcessingUsage(appDb,hh)).reserved).toBe(0);
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it('DB clock defeats a skewed host clock',async()=>{const{hh}=await household(),f=await ready(hh);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2040-01-01'));
 try{const r=(await reserveDocumentProcessing(db,hh,f.id))!;expect(r.period_start.getUTCFullYear()).not.toBe(2040);}finally{vi.useRealTimers();}
});
it('retention review holds bytes/work; no automatic deletion or slot release',async()=>{const{hh}=await household(),f=await ready(hh);await admin.documentCustody.update({where:{id:f.custody.id},data:{reviewAt:new Date(0)}});
 expect((await reconcileDocumentProcessing(db,hh)).held).toBe(1);await expect(reserveDocumentProcessing(db,hh,f.id)).rejects.toThrow('Custody unavailable');expect(await db.withHousehold(hh,tx=>tx.documentCustody.count())).toBe(1);
});
it('simultaneous clean admissions obey independent 20-object bound',async()=>{const{hh}=await household();for(let i=0;i<19;i++)await ready(hh);const a=await clean(hh),b=await clean(hh);
 const results=await Promise.allSettled([registerCleanCustody(db,hh,a.scan),registerCleanCustody(db,hh,b.scan)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('tenant isolation and application read-only journal authority apply',async()=>{const{hh}=await household(),other=await household(),f=await ready(hh);
 expect(await db.withHousehold(other.hh,tx=>tx.documentCustody.findUnique({where:{id:f.custody.id}}))).toBeNull();expect(await reserveDocumentProcessing(db,other.hh,f.id)).toBeNull();
 await expect(appDb.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_processing SET state='completed' WHERE id=${f.id}::uuid`)).rejects.toThrow();
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE stripe_test_states SET state='active' WHERE household_id=${hh}::uuid`)).rejects.toThrow();
 await expect(db.withHousehold(hh,tx=>tx.$queryRaw`SELECT ciphertext FROM item_secrets`)).rejects.toThrow();
});
it('fenced household cannot reserve or finish accepted work',async()=>{const{hh,owner}=await household(),f=await reserved(hh);await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);
 await admin.householdDeletion.create({data:{householdId:hh,requestedBy:owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:'fenced',fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});
 await expect(finishDocumentProcessing(db,hh,f.id,f.lease.lease_token,randomUUID())).rejects.toThrow();await expect(reconcileDocumentProcessing(db,hh)).rejects.toThrow();expect((await readDocumentProcessingUsage(appDb,hh)).completed).toBe(0);
});
it('direct SQL cannot complete without a transactional outbox intent or edit charge/period fields',async()=>{const{hh}=await household(),f=await reserved(hh);await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_processing SET state='completed',result_ref=${randomUUID()}::uuid WHERE id=${f.id}::uuid`)).rejects.toThrow('Reviewed result authority');
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_processing SET period_start=clock_timestamp(),charged_at=clock_timestamp() WHERE id=${f.id}::uuid`)).rejects.toThrow();
});

it('local copy response loss reconciles exact bytes before ready; export excludes storage/lease identities',async()=>{
 const{hh,owner}=await household(),f=await clean(hh),c=await registerCleanCustody(db,hh,f.scan);
 const root=mkdtempSync(`${process.platform === 'linux' ? '/tmp' : '/private/tmp'}/pellum-clean-custody-`);
 try{const store=localCleanCustody(root),ref={householdId:hh,objectId:c.objectId,sha256:Buffer.from(c.sha256).toString('hex'),size:c.sizeBytes};
  store.copy(ref,f.bytes);store.copy(ref,f.bytes);expect(store.verify(ref).exactBytes).toBe(true);
  const id=await markCleanCustodyReady(db,hh,c.id),req=randomUUID();await runAsUser(owner,()=>requestOwnerExport(appDb,hh,req));
  const snapshot=await runAsUser(owner,()=>readOwnerExportSnapshot(appDb,hh,req));
  expect(snapshot.documentWork).toEqual({version:1,custody:[{documentId:f.doc,state:'ready',reviewAt:expect.any(String)}],processing:[{documentId:f.doc,state:'waiting',periodStart:null,chargedAt:null}]});
  const exported=JSON.stringify(snapshot.documentWork);expect(exported).not.toContain(c.objectId);expect(exported).not.toContain(id);expect(exported).not.toContain(ref.sha256);
  expect(store.remove(ref).absenceProven).toBe(false);expect(store.observe(ref).state).toBe('absent');
  // Physical absence is not permission to retire the protected journal or a final receipt.
  expect(await db.withHousehold(hh,tx=>tx.documentCustody.count())).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('custody cancellation retains records and blocks new processing',async()=>{const{hh}=await household(),f=await ready(hh);
 await db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_custodies SET state='cancelled' WHERE id=${f.custody.id}::uuid`);
 await expect(reserveDocumentProcessing(db,hh,f.id)).rejects.toThrow('Custody unavailable');expect(await db.withHousehold(hh,tx=>tx.documentCustody.count())).toBe(1);
});
it('one custody cannot acquire a second accounting identity',async()=>{const{hh}=await household(),f=await ready(hh);
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`INSERT INTO document_processing(household_id,custody_id) VALUES(${hh}::uuid,${f.custody.id}::uuid)`)).rejects.toThrow();
 expect(await db.withHousehold(hh,tx=>tx.documentProcessing.count())).toBe(1);
});
it('current journal binding cannot be rewritten to a different document or storage object',async()=>{const{hh}=await household(),f=await ready(hh);
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_custodies SET object_id=${randomUUID()}::uuid WHERE id=${f.custody.id}::uuid`)).rejects.toThrow();
 await expect(db.withHousehold(hh,tx=>tx.$executeRaw`UPDATE document_processing SET custody_id=${randomUUID()}::uuid WHERE id=${f.id}::uuid`)).rejects.toThrow();
});

import { cancelDocumentWork,readDocumentWork,DocumentWorkNotCancellable } from "../../src/document-cancellation.js";
it('owner cancels unstarted work: claims stop, bytes/accounting kept, idempotent',async()=>{
 const{hh,owner}=await household(),f=await ready(hh);
 expect(await runAsUser(owner,()=>readDocumentWork(appDb,hh,f.doc))).toMatchObject({state:'waiting',cancellable:true});
 expect(await runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc))).toMatchObject({state:'stopped',cancellable:false});
 expect(await runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc))).toMatchObject({state:'stopped'});
 expect(await reserveDocumentProcessing(db,hh,f.id).catch(()=>null)).toBeNull();
 const kept=await admin.documentCustody.findUniqueOrThrow({where:{id:f.custody.id}});expect(kept.state).toBe('cancelled');expect(Buffer.from(kept.sha256).equals(f.hash)).toBe(true);
 expect(await admin.document.findUniqueOrThrow({where:{id:f.doc}})).toMatchObject({sizeBytes:BigInt(f.bytes.length)});
 expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:0,reserved:0,pending:0});
 expect(await admin.auditLog.count({where:{householdId:hh,targetType:'document_custodies',targetId:f.custody.id,actorType:'user',actorId:owner}})).toBeGreaterThan(0);
});
it('owner cannot cancel reserved, started or indeterminate work, even by direct SQL',async()=>{
 const{hh,owner}=await household(),f=await reserved(hh);
 await expect(runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc))).rejects.toBeInstanceOf(DocumentWorkNotCancellable);
 for(const sql of [`UPDATE document_processing SET state='cancelled' WHERE id='${f.id}'`,`UPDATE document_custodies SET state='cancelled' WHERE id='${f.custody.id}'`])
  await expect(runAsUser(owner,()=>appDb.withHousehold(hh,tx=>tx.$executeRawUnsafe(sql)))).rejects.toThrow(/cannot be cancelled/);
 await startDocumentProcessing(db,hh,f.id,f.lease.lease_token);
 expect(await runAsUser(owner,()=>readDocumentWork(appDb,hh,f.doc))).toMatchObject({state:'working',cancellable:false});
 await expect(runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc))).rejects.toBeInstanceOf(DocumentWorkNotCancellable);
 expect(await admin.documentProcessing.findUniqueOrThrow({where:{id:f.id}})).toMatchObject({state:'started'});
});
it('runtime role may change only the state column to cancelled, and viewers/strangers cannot cancel',async()=>{
 const{hh,owner}=await household(),f=await ready(hh),viewer=randomUUID();owners.push(viewer);
 await admin.user.create({data:{id:viewer,email:`${viewer}@example.test`}});await admin.householdUser.create({data:{householdId:hh,userId:viewer,role:'viewer'}});
 await expect(runAsUser(viewer,()=>cancelDocumentWork(appDb,hh,f.doc))).rejects.toThrow(/refused/);
 await expect(runAsUser(owner,()=>appDb.withHousehold(hh,tx=>tx.$executeRawUnsafe(`UPDATE document_processing SET attempts=0 WHERE id='${f.id}'`)))).rejects.toThrow(/permission denied/);
 await expect(runAsUser(owner,()=>appDb.withHousehold(hh,tx=>tx.$executeRawUnsafe(`UPDATE document_custodies SET state='ready' WHERE id='${f.custody.id}'`)))).rejects.toThrow(/cannot be cancelled/);
 const other=await household();
 expect(await runAsUser(other.owner,()=>cancelDocumentWork(appDb,other.hh,f.doc))).toBeNull();
 expect(await admin.documentCustody.findUniqueOrThrow({where:{id:f.custody.id}})).toMatchObject({state:'ready'});
});
it('a concurrent reservation and cancellation serialize: exactly one wins',async()=>{
 for(let i=0;i<4;i++){
  const{hh,owner}=await household(),f=await ready(hh);
  const [claim,cancel]=await Promise.allSettled([reserveDocumentProcessing(db,hh,f.id),runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc))]);
  const p=await admin.documentProcessing.findUniqueOrThrow({where:{id:f.id}}),c=await admin.documentCustody.findUniqueOrThrow({where:{id:f.custody.id}});
  if(p.state==='reserved'){expect(c.state).toBe('ready');expect(cancel.status).toBe('rejected');}
  else{expect(p.state).toBe('cancelled');expect(c.state).toBe('cancelled');expect(claim.status==='rejected'||(claim.status==='fulfilled'&&claim.value===null)).toBe(true);}
 }
});
it('a deletion fence refuses owner cancellation',async()=>{
 const{hh,owner}=await household(),f=await ready(hh);
 await admin.householdDeletion.create({data:{householdId:hh,requestedBy:owner,requestedAt:new Date(0),undoUntil:new Date(14*86400000),state:'fenced',fencedAt:new Date(),settleUntil:new Date(Date.now()+900000)}});
 const refused=await runAsUser(owner,()=>cancelDocumentWork(appDb,hh,f.doc)).catch(e=>e);
 expect(refused).toBeInstanceOf(Error);expect(refused).not.toBeInstanceOf(DocumentWorkNotCancellable);
 expect(await admin.documentCustody.findUniqueOrThrow({where:{id:f.custody.id}})).toMatchObject({state:'ready'});
});
