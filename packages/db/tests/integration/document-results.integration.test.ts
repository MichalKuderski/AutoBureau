import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {Database} from '../../src/scoped.js';
import {runAsUser} from '../../src/audit.js';
import {registerDocumentScan,claimDocumentScan,completeDocumentScan} from '../../src/document-scans.js';
import {registerCleanCustody,markCleanCustodyReady,reserveDocumentProcessing,startDocumentProcessing,readDocumentProcessingUsage,reconcileDocumentProcessing} from '../../src/document-processing.js';
import {publishSyntheticResult,approveSyntheticResult} from '../../src/document-results.js';
import {canonicalDeadlinePdf} from '../../../../services/ai/src/canonical-pdf.js';
import {prepareLocalDocumentResult} from '../../../../scripts/local-document-result.js';
import {ADMIN_URL,APP_URL,bootstrapDatabase,grantAppUserLogin} from './setup.js';
let admin:PrismaClient,worker:PrismaClient,app:PrismaClient,db:Database,appDb:Database;
const households:string[]=[],owners:string[]=[];
beforeAll(async()=>{await bootstrapDatabase();await grantAppUserLogin();admin=new PrismaClient({datasourceUrl:ADMIN_URL});app=new PrismaClient({datasourceUrl:APP_URL});appDb=new Database(app);
 await admin.$executeRawUnsafe("ALTER ROLE app_document_worker LOGIN PASSWORD 'local_results_only'");const u=new URL(ADMIN_URL);u.username='app_document_worker';u.password='local_results_only';worker=new PrismaClient({datasourceUrl:u.toString()});db=new Database(worker);
},120000);
afterAll(async()=>{if(admin){const where={householdId:{in:households}};
 await admin.documentResultReview.deleteMany({where});await admin.documentResult.deleteMany({where});await admin.documentProcessing.deleteMany({where});await admin.documentCustody.deleteMany({where});await admin.documentScanAttempt.deleteMany({where});await admin.documentScan.deleteMany({where});
 await admin.stripeTestState.deleteMany({where});await admin.stripeTestIntent.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});
 await admin.householdDeletion.deleteMany({where});await admin.outboxEvent.deleteMany({where});await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:{in:owners}}});await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});await admin.$executeRawUnsafe('ALTER ROLE app_document_worker NOLOGIN PASSWORD NULL');}
 await Promise.all([admin,app,worker].map(c=>c?.$disconnect()));});
async function fixture(){const hh=randomUUID(),owner=randomUUID(),doc=randomUUID(),seal=randomUUID();households.push(hh);owners.push(owner);
 await admin.user.create({data:{id:owner,email:`${owner}@example.test`}});await admin.household.create({data:{id:hh,createdBy:owner,name:'PUBLIC result fixture'}});await admin.householdUser.create({data:{householdId:hh,userId:owner,role:'owner'}});await admin.entitlement.create({data:{householdId:hh,periodStart:new Date()}});
 const bytes=Buffer.from(canonicalDeadlinePdf('2026-10-01')),sha=createHash('sha256').update(bytes).digest('hex');
 await admin.document.create({data:{id:doc,householdId:hh,source:'upload',status:'scanning',storagePath:`hh/${hh}/upload/${doc}/sealed/${seal}`,mimeType:'application/pdf',sizeBytes:bytes.length}});
 const scan=await registerDocumentScan(db,hh,{documentId:doc,sealId:seal,sha256:sha,size:bytes.length});
 // Deterministic protocol fixture. Actual isolated ClamAV is a separate local proof.
 const claim=(await claimDocumentScan(db,hh,scan,{engine:'1'.repeat(64),signatures:'2'.repeat(64),sandbox:'3'.repeat(64)}))!;
 await completeDocumentScan(db,hh,scan,{nonce:claim.nonce,sha256:sha,verdict:'clean',failure:'none'});
 const custody=await registerCleanCustody(db,hh,scan),processing=await markCleanCustodyReady(db,hh,custody.id),lease=(await reserveDocumentProcessing(db,hh,processing))!;
 await startDocumentProcessing(db,hh,processing,lease.lease_token);
 const result=prepareLocalDocumentResult(bytes,{id:randomUUID(),processingId:processing,leaseToken:lease.lease_token});
 return {hh,owner,doc,bytes,custody,processing,lease,result};
}
const approve=(f:Awaited<ReturnType<typeof fixture>>)=>runAsUser(f.owner,()=>approveSyntheticResult(appDb,f.hh,f.result.id,'APPROVE PUBLIC SYNTHETIC DATE'));
it('requires immutable parser/scan provenance and explicit owner review before atomic domain/usage publication',async()=>{const f=await fixture();
 await publishSyntheticResult(db,f.hh,f.result);expect(await readDocumentProcessingUsage(appDb,f.hh)).toEqual({completed:0,reserved:1,pending:0});
 expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(0);
 const result=await approve(f);expect(result.replayed).toBe(false);
 expect(await readDocumentProcessingUsage(appDb,f.hh)).toEqual({completed:1,reserved:0,pending:0});
 const saved=await appDb.withHousehold(f.hh,tx=>tx.documentResult.findFirstOrThrow());expect(saved).toMatchObject({documentId:f.doc,scanAttemptId:expect.any(String),schemaVersion:1,parserVersion:'canonical-public-deadline-pdf-v1',redactorVersion:'closed-enums-v1',originalRevision:0});
 const o=await appDb.withHousehold(f.hh,tx=>tx.obligation.findUniqueOrThrow({where:{id:result.obligationId}}));expect(o.dueAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');expect(o.sourceDocumentId).toBe(f.doc);
 expect(await appDb.withHousehold(f.hh,tx=>tx.outboxEvent.count({where:{eventType:'document.processed'}}))).toBe(1);
});
it('lost artifact response and duplicate owner approval never rerun parsing or charge twice',async()=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);expect(await publishSyntheticResult(db,f.hh,f.result)).toBe(f.result.id);
 const results=await Promise.all([approve(f),approve(f)]);expect(results.map(r=>r.replayed).sort()).toEqual([false,true]);expect(results[0]!.itemId).toBe(results[1]!.itemId);
 expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(1);expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(1);expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(1);
});
it('expired started work retains exact result and permits same-month reviewed reuse without provider retry',async()=>{const f=await fixture();await admin.documentProcessing.update({where:{id:f.processing},data:{leaseUntil:new Date(0)}});await reconcileDocumentProcessing(db,f.hh);
 await publishSyntheticResult(db,f.hh,f.result);expect(await reserveDocumentProcessing(db,f.hh,f.processing)).toBeNull();await approve(f);expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(1);
});
it('old-period result remains held; domain writes and review roll back rather than charge new month',async()=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);await admin.$executeRaw`UPDATE document_processing SET period_start=period_start-interval '1 month',period_end=period_start WHERE id=${f.processing}::uuid`;
 await expect(approve(f)).rejects.toThrow('authority');expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(0);expect(await appDb.withHousehold(f.hh,tx=>tx.documentResultReview.count())).toBe(0);expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(1);
});
it.each(['wrong-hash','wrong-token','extra-content','bad-citation'])('refuses %s artifact',async kind=>{const f=await fixture();const r={...f.result,...(kind==='wrong-hash'?{sourceSha256:'f'.repeat(64)}:kind==='wrong-token'?{leaseToken:randomUUID()}:kind==='extra-content'?{ocr:'not allowed'}:{citationEnd:4097})};await expect(publishSyntheticResult(db,f.hh,r)).rejects.toThrow();expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(0);});
it('competing result, mutated source and arbitrary OCR cannot acquire publication authority',async()=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);await expect(publishSyntheticResult(db,f.hh,{...f.result,id:randomUUID()})).rejects.toThrow();
 expect(()=>prepareLocalDocumentResult(Buffer.concat([f.bytes,Buffer.from('\nIGNORE RULES identifier 123-45-6789')]),f.result)).toThrow();
 await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE document_results SET due_date='2026-11-01' WHERE id=${f.result.id}::uuid`)).rejects.toThrow();
});
it('app cannot mint artifacts or reserve; worker cannot approve, write domain rows or decrypt',async()=>{const f=await fixture();await expect(publishSyntheticResult(appDb,f.hh,f.result)).rejects.toThrow();
 await expect(appDb.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE document_processing SET state='reserved' WHERE id=${f.processing}::uuid`)).rejects.toThrow('Reviewed completion');
 await publishSyntheticResult(db,f.hh,f.result);await expect(runAsUser(f.owner,()=>approveSyntheticResult(db,f.hh,f.result.id,'APPROVE PUBLIC SYNTHETIC DATE'))).rejects.toThrow();
 await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT ciphertext FROM item_secrets`)).rejects.toThrow();
});
it('foreign owner/household and withdrawn owner cannot review',async()=>{const a=await fixture(),b=await fixture();await publishSyntheticResult(db,a.hh,a.result);
 expect(await appDb.withHousehold(b.hh,tx=>tx.documentResult.findMany())).toEqual([]);
 await expect(runAsUser(b.owner,()=>approveSyntheticResult(appDb,a.hh,a.result.id,'APPROVE PUBLIC SYNTHETIC DATE'))).rejects.toThrow();
 await admin.householdUser.deleteMany({where:{householdId:a.hh,userId:a.owner}});await expect(approve(a)).rejects.toThrow();
});
it.each(['fence','deadline','cancelled'])('%s blocks publication without destroying the immutable result',async reason=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);
 if(reason==='fence')await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:'fenced',fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});
 else if(reason==='deadline')await admin.documentCustody.update({where:{id:f.custody.id},data:{reviewAt:new Date(0)}});
 else await admin.documentCustody.update({where:{id:f.custody.id},data:{state:'cancelled'}});
 await expect(approve(f)).rejects.toThrow();expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(1);expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(0);
});
async function billing(f:Awaited<ReturnType<typeof fixture>>){
 const b=await admin.stripeTestBinding.create({data:{householdId:f.hh,ownerId:f.owner,accountId:'acct_Synthetic',customerId:'cus_'+randomUUID().replaceAll('-',''),subscriptionId:'sub_'+randomUUID().replaceAll('-',''),livemode:false}});
 const intent=await admin.stripeTestIntent.create({data:{householdId:f.hh,bindingId:b.id,accountId:b.accountId,requestKey:randomUUID(),reason:'scheduled-recheck'}});
 await admin.$executeRaw`INSERT INTO stripe_test_states(household_id,binding_id,account_id,source_intent_id,source_lease_token,revision,state,plan,paid_through,premium_until)
 VALUES(${f.hh}::uuid,${b.id}::uuid,${b.accountId},${intent.id}::uuid,${randomUUID()}::uuid,1,'active','monthly',extract(epoch FROM clock_timestamp())::bigint+86400,extract(epoch FROM clock_timestamp())::bigint+86400)`;
 await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:true}});
}
it.each(['upgrade','annual','downgrade','grace','expired-grace'])('reuses the same artifact across %s with new revision, original evidence and no reset',async change=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);await billing(f);
 try{if(change==='annual')await admin.stripeTestState.updateMany({where:{householdId:f.hh},data:{plan:'annual',revision:2}});
 if(change==='downgrade')await admin.stripeTestState.updateMany({where:{householdId:f.hh},data:{state:'canceled',premiumUntil:null,revision:2}});
 if(change==='grace'||change==='expired-grace')await admin.$executeRaw`UPDATE stripe_test_states SET state='grace',revision=2,premium_until=extract(epoch FROM clock_timestamp())::bigint+${change==='grace'?86400:-1} WHERE household_id=${f.hh}::uuid`;
 await approve(f);expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(1);
 const row=await appDb.withHousehold(f.hh,tx=>tx.documentProcessing.findUniqueOrThrow({where:{id:f.processing}}));expect(row.entitlementRevision).toBe(change==='upgrade'?1:2);expect(row.tier).toBe(['downgrade','expired-grace'].includes(change)?'free':'premium');
 expect((await appDb.withHousehold(f.hh,tx=>tx.documentResult.findUniqueOrThrow({where:{id:f.result.id}}))).originalRevision).toBe(0);
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
async function historicalCharges(hh:string,n:number){for(let i=0;i<n;i++){
 const doc=randomUUID(),scan=randomUUID(),custody=randomUUID(),hash=createHash('sha256').update(doc).digest();
 await admin.document.create({data:{id:doc,householdId:hh,source:'upload',status:'processed',storagePath:'public-synthetic-absent',mimeType:'application/pdf',sizeBytes:100}});
 await admin.documentScan.create({data:{id:scan,householdId:hh,documentId:doc,sealId:randomUUID(),sha256:hash,sizeBytes:100,state:'clean'}});
 await admin.documentCustody.create({data:{id:custody,householdId:hh,documentId:doc,scanId:scan,objectId:randomUUID(),sha256:hash,sizeBytes:100,state:'absent',reviewAt:new Date()}});
 await admin.$executeRaw`INSERT INTO document_processing(household_id,custody_id,state,attempts,period_start,period_end,tier,catalog_version,entitlement_revision,limit_snapshot,lease_token,lease_until,result_ref,charged_at)
 VALUES(${hh}::uuid,${custody}::uuid,'completed',1,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC','premium',1,0,50,${randomUUID()}::uuid,clock_timestamp(),${randomUUID()}::uuid,clock_timestamp())`;
}}
it('over-cap downgrade refuses reuse without destroying result or historic usage',async()=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);await historicalCharges(f.hh,10);await expect(approve(f)).rejects.toThrow('authority');expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(10);expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(1);expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(0);});
it.each([['free',8,10],['premium',40,50]] as const)('database quota view warns at %s threshold without counting uploads or queued work',async(plan,used,cap)=>{const f=await fixture();if(plan==='premium')await billing(f);
 try{await historicalCharges(f.hh,used);const {readDocumentQuota}=await import('../../src/document-quota.js');let q=await readDocumentQuota(appDb,f.hh);
 expect(q).toMatchObject({plan,processed:used,allowance:cap,warning:true,warningThreshold:used,reservedSlots:1,processing:1,needsReview:0});
 await publishSyntheticResult(db,f.hh,f.result);q=await readDocumentQuota(appDb,f.hh);expect(q).toMatchObject({processed:used,processing:0,needsReview:1});
 }finally{await admin.localPlanActivation.update({where:{singleton:true},data:{testEnabled:false}});}
});
it('raw owner SQL cannot commit an uncited review or a charge without the exact outbox',async()=>{const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);
 await expect(runAsUser(f.owner,()=>appDb.withHousehold(f.hh,async tx=>{
  const item=await tx.item.create({data:{householdId:f.hh,kind:'other',name:'PUBLIC',sourceDocumentId:f.doc,attrs:{provenance:{resultId:f.result.id,source:'synthetic-reviewed',page:1,start:f.result.citationStart,end:f.result.citationEnd}}}});
  const obligation=await tx.obligation.create({data:{householdId:f.hh,itemId:item.id,title:'PUBLIC',kind:'custom',source:'user',sourceDocumentId:f.doc,dueAt:new Date('2026-10-01T00:00:00Z'),verifiedAt:new Date()}});
  await tx.$executeRaw`INSERT INTO document_result_reviews(household_id,result_id,owner_id,item_id,obligation_id) VALUES(${f.hh}::uuid,${f.result.id}::uuid,${f.owner}::uuid,${item.id}::uuid,${obligation.id}::uuid)`;
  await tx.$executeRaw`UPDATE document_processing SET state='completed',result_ref=${f.result.id}::uuid WHERE id=${f.processing}::uuid`;
 }))).rejects.toThrow('intent missing');expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(0);expect(await appDb.withHousehold(f.hh,tx=>tx.item.count())).toBe(0);
});
it('restricted privacy inventory covers populated result/review journals without content access or retirement authority',async()=>{const f=await fixture(),foreign=await fixture();await publishSyntheticResult(db,f.hh,f.result);await approve(f);
 const deletion=await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:'fenced',fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});
 const roles=['app_retention_worker','app_deletion_verifier'],clients:PrismaClient[]=[];
 try{for(const role of roles){await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'local_results_privacy_only'`);const u=new URL(ADMIN_URL);u.username=role;u.password='local_results_privacy_only';clients.push(new PrismaClient({datasourceUrl:u.toString()}));}
 const retention=new Database(clients[0]!),verifier=new Database(clients[1]!);const {inventoryLocalDeletionPage,reconcileLocalDeletionInventory}=await import('../../src/privacy-inventory.js');
 for(const source of ['results','result-reviews'] as const){expect(await inventoryLocalDeletionPage(retention,f.hh,deletion.id,source)).toMatchObject({recorded:1,more:false});expect(await reconcileLocalDeletionInventory(verifier,f.hh,deletion.id,source)).toMatchObject({sourceCount:1,manifested:1,localSourceMatches:true,finalReceiptIssuable:false});}
 expect(await verifier.withHousehold(foreign.hh,tx=>tx.$queryRaw`SELECT id FROM document_results`)).toEqual([]);
 await expect(verifier.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT source_sha256 FROM document_results`)).rejects.toThrow();
 await expect(retention.withHousehold(f.hh,tx=>tx.$executeRaw`DELETE FROM document_results WHERE id=${f.result.id}::uuid`)).rejects.toThrow();
 }finally{await admin.deletionResource.deleteMany({where:{deletionId:deletion.id}});for(const role of roles)await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);await Promise.all(clients.map(c=>c.$disconnect()));}
});
it.each(['hash','path','size','type'])('ordinary application cannot substitute the %s of an already custodied source',async field=>{const f=await fixture();
 await expect(runAsUser(f.owner,()=>appDb.withHousehold(f.hh,tx=>field==='hash'?tx.$executeRaw`UPDATE documents SET sha256=${Buffer.alloc(32)} WHERE id=${f.doc}::uuid`:field==='path'?tx.$executeRaw`UPDATE documents SET storage_path='changed' WHERE id=${f.doc}::uuid`:field==='size'?tx.$executeRaw`UPDATE documents SET size_bytes=size_bytes+1 WHERE id=${f.doc}::uuid`:tx.$executeRaw`UPDATE documents SET mime_type='text/plain' WHERE id=${f.doc}::uuid`))).rejects.toThrow('Custodied source is immutable');
 await publishSyntheticResult(db,f.hh,f.result);await approve(f);
});
it('raw broker cannot publish a result without its transactional review intent',async()=>{const f=await fixture(),r=f.result;
 await expect(db.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO document_results(id,household_id,processing_id,lease_token,source_sha256,citation_start,citation_end,due_date)
 VALUES(${r.id}::uuid,${f.hh}::uuid,${r.processingId}::uuid,${r.leaseToken}::uuid,${Buffer.from(r.sourceSha256,'hex')},${r.citationStart},${r.citationEnd},${r.dueDate}::date)`)).rejects.toThrow('review intent missing');
 expect(await appDb.withHousehold(f.hh,tx=>tx.documentResult.count())).toBe(0);
});

it('independent absence observation includes unpublished result and retained processing/custody evidence',async()=>{
 const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);
 const deletion=await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:'fenced',fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});
 const role='app_deletion_verifier';let client:PrismaClient|undefined;
 try{await admin.$executeRawUnsafe("ALTER ROLE app_deletion_verifier LOGIN PASSWORD 'local_results_privacy_only'");const u=new URL(ADMIN_URL);u.username=role;u.password='local_results_privacy_only';client=new PrismaClient({datasourceUrl:u.toString()});const verifier=new Database(client);
 const {observeLocalDeletionResource}=await import('../../src/deletion-journal.js');
 const resources=[];for(const [component,count] of [['derived-records',1],['job-artifacts',3],['documents',2]] as const){
  const resource=await admin.deletionResource.create({data:{householdId:f.hh,deletionId:deletion.id,component,resourceRef:randomUUID(),inventoryCount:count}});
  resources.push({id:resource.id,count});
 }
 await admin.householdDeletion.update({where:{id:deletion.id},data:{state:'verifying'}});
 for(const resource of resources)expect(await observeLocalDeletionResource(verifier,f.hh,resource.id)).toMatchObject({state:'remaining',remaining:resource.count});
 }finally{await admin.deletionObservation.deleteMany({where:{householdId:f.hh}});await admin.deletionResource.deleteMany({where:{deletionId:deletion.id}});await admin.$executeRawUnsafe('ALTER ROLE app_deletion_verifier NOLOGIN PASSWORD NULL');await client?.$disconnect();}
});

it.each(['ready','approved','old-period','capacity','held','canceled','fence','incompatible'] as const)('owner resolution reports %s without provider work or accounting mutation',async mode=>{
 const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);
 const expected={ready:'reusable-original-period',approved:'approved-result-reuse','old-period':'customer-action-required',capacity:'current-period-capacity-unavailable',held:'operator-review-required',canceled:'canceled',fence:'deletion-fenced',incompatible:'incompatible-result'};
 let published:Awaited<ReturnType<typeof approve>>|undefined;
 if(mode==='approved')published=await approve(f);
 if(mode==='old-period'){
  await admin.$executeRaw`UPDATE document_processing SET period_start=period_start-interval '1 month',period_end=period_end-interval '1 month' WHERE id=${f.processing}::uuid`;
  await admin.$executeRaw`UPDATE document_results SET period_start=period_start-interval '1 month',period_end=period_end-interval '1 month' WHERE id=${f.result.id}::uuid`;
 }
 if(mode==='capacity')await historicalCharges(f.hh,10);
 if(mode==='held')await admin.documentCustody.update({where:{id:f.custody.id},data:{state:'held'}});
 if(mode==='canceled')await admin.documentCustody.update({where:{id:f.custody.id},data:{state:'cancelled'}});
 if(mode==='fence')await admin.householdDeletion.create({data:{householdId:f.hh,requestedBy:f.owner,requestedAt:new Date(Date.now()-20*86400000),undoUntil:new Date(Date.now()-6*86400000),state:'fenced',fencedAt:new Date(Date.now()-3600000),settleUntil:new Date(Date.now()-2700000)}});
 if(mode==='incompatible')await admin.documentResult.update({where:{id:f.result.id},data:{sourceSha256:Buffer.alloc(32)}});
 const before=await readDocumentProcessingUsage(appDb,f.hh),{readLocalResultResolution}=await import('../../src/document-resolution.js');
 const value=await runAsUser(f.owner,()=>readLocalResultResolution(appDb,f.hh,f.result.id));
 expect(value).toMatchObject({state:expected[mode],providerRetryAllowed:false,chargeAuthorized:false,localOnly:true,crossPeriodReusePolicyRequired:mode==='old-period'});
 if(published)expect(value.published).toEqual({itemId:published.itemId,obligationId:published.obligationId});else expect(value.published).toBeNull();
 expect(await readDocumentProcessingUsage(appDb,f.hh)).toEqual(before);
});
it('resolution refuses foreign household, former owner and suspended account',async()=>{
 const f=await fixture(),other=await fixture();await publishSyntheticResult(db,f.hh,f.result);const {readLocalResultResolution}=await import('../../src/document-resolution.js');
 await expect(runAsUser(other.owner,()=>readLocalResultResolution(appDb,f.hh,f.result.id))).rejects.toThrow('unavailable');
 await expect(runAsUser(other.owner,()=>readLocalResultResolution(appDb,other.hh,f.result.id))).rejects.toThrow('unavailable');
 await admin.user.update({where:{id:f.owner},data:{status:'suspended'}});await expect(runAsUser(f.owner,()=>readLocalResultResolution(appDb,f.hh,f.result.id))).rejects.toThrow('unavailable');
});
it('temporary plan shadow cannot restore exhausted processing allowance',async()=>{
 const f=await fixture();await publishSyntheticResult(db,f.hh,f.result);await historicalCharges(f.hh,10);
 await expect(runAsUser(f.owner,()=>appDb.withHousehold(f.hh,async tx=>{
  await tx.$executeRaw`CREATE TEMP TABLE effective_plan ON COMMIT DROP AS SELECT * FROM public.effective_plan WHERE household_id=${f.hh}::uuid`;
  await tx.$executeRaw`UPDATE pg_temp.effective_plan SET documents_per_month=1000`;
  const item=await tx.item.create({data:{householdId:f.hh,kind:'other',name:'PUBLIC',sourceDocumentId:f.doc,attrs:{provenance:{resultId:f.result.id,source:'synthetic-reviewed',page:1,start:f.result.citationStart,end:f.result.citationEnd}}}});
  const obligation=await tx.obligation.create({data:{householdId:f.hh,itemId:item.id,title:'PUBLIC',kind:'custom',source:'user',sourceDocumentId:f.doc,dueAt:new Date('2026-10-01T00:00:00Z'),verifiedAt:new Date()}});
  await tx.$executeRaw`INSERT INTO document_result_reviews(household_id,result_id,owner_id,item_id,obligation_id) VALUES(${f.hh}::uuid,${f.result.id}::uuid,${f.owner}::uuid,${item.id}::uuid,${obligation.id}::uuid)`;
  await tx.$executeRaw`UPDATE public.document_processing SET state='completed',result_ref=${f.result.id}::uuid WHERE id=${f.processing}::uuid`;
  const {outbox}=await import('../../src/outbox.js');await outbox(tx).emit({event_type:'document.processed',aggregate_type:'document',aggregate_id:f.doc,household_id:f.hh,payload:{processing_id:f.processing}});
 }))).rejects.toThrow('authority');
 expect((await readDocumentProcessingUsage(appDb,f.hh)).completed).toBe(10);
});
