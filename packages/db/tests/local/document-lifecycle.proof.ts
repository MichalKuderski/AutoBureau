/** Explicit LOCAL proof command only; never silently executed against hosted DBs. */
import { createHash, randomUUID } from "node:crypto";
import { rmSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { it, expect,vi } from "vitest";
import { DELETION_COMPONENTS } from "@autobureau/contracts";
import { Database } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import {localCleanCustody} from "../../src/local-clean-custody.js";
import {registerCleanCustody,markCleanCustodyReady,reserveDocumentProcessing,startDocumentProcessing,readDocumentProcessingUsage} from "../../src/document-processing.js";
import {publishSyntheticResult,approveSyntheticResult} from "../../src/document-results.js";
import {prepareLocalDocumentResult} from "../../../../scripts/local-document-result.js";
import { registerDocumentScan } from "../../src/document-scans.js";
import { requestHouseholdDeletion, fenceHouseholdDeletion, appendDeletionManifest, sealDeletionManifest,
  claimDeletionAttempt, recordDeletionAttempt, recordSyntheticDeletionObservation, observeLocalDeletionResource, readDeletionProgress } from "../../src/deletion-journal.js";
import { eraseLocalDocumentBatch, type LocalErasureClaims } from "../../src/local-erasure.js";
import { runHouseholdDispatchOnce } from "../../src/jobs.js";
import { runDocumentScanOnce } from "../../../../apps/web/src/server/documents/scan-invocation.js";
import { canonicalDeadlinePdf } from "../../../../services/ai/src/canonical-pdf.js";
import { parseCanonicalPublicPdf, redactParsedDocument } from "../../../../services/ai/src/redaction.js";
import { classifyWithLocalStub } from "../../../../services/ai/src/gateway.js";
import { clamavScannerPort } from "../../../../scripts/scanner-clamav.mjs";
import { syntheticObjectStore } from "../../../../scripts/synthetic-object-store.mjs";
import * as storageModule from "../../../../apps/web/src/server/storage/quarantine.js";
import {createDocumentUpload,completeDocumentUpload} from "../../../../apps/web/src/server/domain/document-upload.js";
import { ADMIN_URL, APP_URL, bootstrapDatabase, grantAppUserLogin } from "../integration/setup.js";
import { createDocumentProofRoots } from "./document-proof-roots.js";
it("joins real local immutable storage, ClamAV, restricted journals, cited review, outbox and truthful erasure progress", async()=>{
  const url=new URL(ADMIN_URL);
  if(url.hostname!=="127.0.0.1"||![["55540","/pellum_adr018_final"],["55541","/pellum_billing_20260921"],["55544","/pellum_custody_final_20260921"],["55545","/pellum_results_20260921"],["55546","/pellum_results_final_20260921"],["55548","/pellum_retirement_final_20260921"]].some(([port,path])=>url.port===port&&url.pathname===path))throw new Error("Disposable local proof endpoint required");
  const release=JSON.parse(readFileSync(new URL("../../../../scripts/scanner/local-release.json",import.meta.url),"utf8"));
  const journalRelease={engine:release.engine.slice(7),signatures:release.signatures.slice(7),sandbox:release.image.slice(7)};
  await bootstrapDatabase();await grantAppUserLogin();
  const admin=new PrismaClient({datasourceUrl:ADMIN_URL}),app=new PrismaClient({datasourceUrl:APP_URL});
  const roles=["app_document_worker","app_retention_worker","app_deletion_verifier","app_dispatcher"];
  const clients:PrismaClient[]=[];const hh=randomUUID(),owner=randomUUID();let doc=randomUUID(),seal=randomUUID();
  const { root, custodyRoot } = createDocumentProofRoots();
  const previous={issuer:process.env.AUTH_ISSUER,scope:process.env.VERCEL_ENV,intake:process.env.DOCUMENT_INTAKE_ENABLED};
  try {
    for(const role of roles){await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'local_proof_only'`);const u=new URL(ADMIN_URL);u.username=role;u.password="local_proof_only";clients.push(new PrismaClient({datasourceUrl:u.toString()}));}
    const [scanDb,eraseDb,verifyDb,dispatchDb]=clients.map(c=>new Database(c));const appDb=new Database(app);
    await admin.user.create({data:{id:owner,email:`${owner}@example.test`}});
    await admin.household.create({data:{id:hh,name:"PUBLIC SYNTHETIC",createdBy:owner}});
    await admin.householdUser.create({data:{householdId:hh,userId:owner,role:"owner"}});
    await admin.entitlement.create({data:{householdId:hh,periodStart:new Date()}});
    const bytes=Buffer.from(canonicalDeadlinePdf("2026-10-01")),sha256=createHash("sha256").update(bytes).digest("hex"),store=syntheticObjectStore(root);
    // Real admission/completion gateways, synthetic local storage port. No hosted
    // capability or network call; the exact accepted bytes still undergo ClamAV.
    process.env.AUTH_ISSUER="https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1";process.env.VERCEL_ENV="production";
    process.env.DOCUMENT_INTAKE_ENABLED='true';
    vi.spyOn(storageModule,'storageConfigFromEnv').mockReturnValue({endpoint:'https://storage.example.test',region:'us-east-2',bucket:'local-quarantine',accessKeyId:'local-synthetic',secretAccessKey:'local-synthetic-only'});
    vi.spyOn(storageModule.QuarantineStorage.prototype,'issue').mockResolvedValue({url:'https://storage.example.test/public-fixture',expiresAt:new Date(Date.now()+600000)});
    vi.spyOn(storageModule.QuarantineStorage.prototype,'seal').mockImplementation(async(_ref,destination)=>{seal=destination.split('/').at(-1)!;store.seal(hh,doc,seal);});
    const ctx={householdId:hh,userId:owner,role:'owner' as const};
    const admission=await runAsUser(owner,()=>createDocumentUpload({db:appDb,ctx,request:new Request('http://127.0.0.1/v1/documents/uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'PUBLIC.pdf',mime:'application/pdf',size:bytes.length})})}));
    doc=(admission.body as {document_id:string}).document_id;store.put('quarantine',hh,doc,bytes);
    expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:0,reserved:0,pending:0});
    await runAsUser(owner,()=>completeDocumentUpload({db:appDb,ctx,request:new Request(`http://127.0.0.1/v1/documents/${doc}/complete`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})}));
    expect(await appDb.withHousehold(hh,tx=>tx.outboxEvent.count({where:{eventType:'document.uploaded',transportScope:'stg'}}))).toBe(1);
    const scanId=await registerDocumentScan(scanDb!,hh,{documentId:doc,sealId:seal,sha256,size:bytes.length});
    const result=await runDocumentScanOnce(scanDb!,hh,scanId,journalRelease,store.snapshots(hh),clamavScannerPort(process.env.PELLUM_LOCAL_DOCKER_SOCKET ?? "unix:///var/run/docker.sock",release),"application/pdf");
    expect(result).toBe("clean");
    expect(await appDb.withHousehold(hh,tx=>tx.outboxEvent.count({where:{eventType:"document.scanned"}}))).toBe(1);
    expect(await runDocumentScanOnce(scanDb!,hh,scanId,journalRelease,store.snapshots(hh),{scan:async()=>{throw new Error("must not rescan");}},"application/pdf")).toBe("not-claimed");
    const safe=redactParsedDocument(parseCanonicalPublicPdf({bytes,format:"application/pdf"}));
    expect(classifyWithLocalStub(safe.capability)).toMatchObject({providerCalled:false,status:"requires-human-review"});
    const date=bytes.subarray(safe.provenance.citation.start,safe.provenance.citation.end).toString();
    expect(date).toBe("2026-10-01");expect(safe.provenance.sourceSha256).toBe(sha256);
    // The same real scanned immutable bytes now pass separate clean custody,
    // parser/redactor/stub, durable provenance and explicit local owner approval.
    const custody=await registerCleanCustody(scanDb!,hh,scanId);
    const cleanStore=localCleanCustody(custodyRoot),ref={householdId:hh,objectId:custody.objectId,sha256,size:bytes.length};
    cleanStore.copy(ref,bytes);cleanStore.copy(ref,bytes);expect(cleanStore.verify(ref).exactBytes).toBe(true);
    const processing=await markCleanCustodyReady(scanDb!,hh,custody.id),lease=(await reserveDocumentProcessing(scanDb!,hh,processing))!;
    await startDocumentProcessing(scanDb!,hh,processing,lease.lease_token);
    const artifact=prepareLocalDocumentResult(bytes,{id:randomUUID(),processingId:processing,leaseToken:lease.lease_token});
    await publishSyntheticResult(scanDb!,hh,artifact);
    const approved=await runAsUser(owner,()=>approveSyntheticResult(appDb,hh,artifact.id,'APPROVE PUBLIC SYNTHETIC DATE'));
    expect((await runAsUser(owner,()=>approveSyntheticResult(appDb,hh,artifact.id,'APPROVE PUBLIC SYNTHETIC DATE'))).obligationId).toBe(approved.obligationId);
    expect(await readDocumentProcessingUsage(appDb,hh)).toEqual({completed:1,reserved:0,pending:0});
    const sent:string[]=[];
    for(let i=0;i<16;i++)await runHouseholdDispatchOnce(dispatchDb!,hh,"stg",{send:async(_q,body)=>{sent.push(body);}});
    expect(sent).toHaveLength(11);for(const body of sent){expect(body).not.toContain("2026-10-01");expect(body).not.toContain(sha256);}
    const deletionId=await runAsUser(owner,()=>requestHouseholdDeletion(appDb,hh,"DELETE HOUSEHOLD"));
    // Fixture administrator advances time only in this disposable database.
    await admin.$executeRaw`UPDATE household_deletions SET requested_at=clock_timestamp()-interval '20 days',undo_until=clock_timestamp()-interval '6 days' WHERE id=${deletionId}::uuid`;
    expect(await fenceHouseholdDeletion(eraseDb!,hh,deletionId)).toBe(true);store.fence(hh);
    await admin.$executeRaw`UPDATE household_deletions SET fenced_at=clock_timestamp()-interval '16 minutes',settle_until=clock_timestamp()-interval '1 minute' WHERE id=${deletionId}::uuid`;
    const objectCount=store.inventory("objects",hh).count,quarantineCount=store.inventory("quarantine",hh).count;
    const counts=await verifyDb!.withHousehold(hh,async tx=>({
      documents:await tx.document.count()+objectCount,
      quarantine:quarantineCount,
      "derived-records":await tx.item.count()+await tx.obligation.count()+await tx.documentChunk.count(),
      "identifier-secrets":await tx.itemSecret.count(),
      "notifications-reminders":await tx.notification.count()+await tx.notificationDelivery.count()+await tx.reminder.count(),
      "outbox-delivery-inbox":await tx.outboxEvent.count()+await tx.jobDelivery.count()+await tx.jobInbox.count(),
      "job-artifacts":await tx.documentScan.count()+await tx.documentScanAttempt.count(),
      audit:await tx.auditLog.count(),
      "account-household":3, // Exact fixture: one user, household and owner membership; not real account discovery.
    }));
    const manifest=DELETION_COMPONENTS.map(component=>({component,resourceRef:randomUUID(),inventoryCount:(counts as Record<string,number>)[component]??0}));
    await appendDeletionManifest(eraseDb!,hh,deletionId,manifest);await sealDeletionManifest(eraseDb!,hh,deletionId);
    const resources=await appDb.withHousehold(hh,tx=>tx.deletionResource.findMany());
    const observer=syntheticObjectStore(root);
    const claims={} as Record<keyof LocalErasureClaims,NonNullable<Awaited<ReturnType<typeof claimDeletionAttempt>>>>;
    for(const component of ["documents","derived-records","identifier-secrets","notifications-reminders"] as const){
      claims[component]=(await claimDeletionAttempt(eraseDb!,hh,resources.find(r=>r.component===component)!.id))!;
    }
    for(const [component,category] of [["documents","objects"],["quarantine","quarantine"]]){
      const resource=resources.find(r=>r.component===component)!;
      const attempt=component==="documents"?claims.documents:await claimDeletionAttempt(eraseDb!,hh,resource.id);expect(attempt).not.toBeNull();
      const ack=store.erase(category,hh);expect(ack.absenceProven).toBe(false);
      if(component!=="documents")await recordDeletionAttempt(eraseDb!,hh,attempt!.id,attempt!.token,"acknowledged");
      const evidence=observer.observe(category,hh);await recordSyntheticDeletionObservation(verifyDb!,hh,resource.id,{evidenceId:evidence.evidenceId,state:component==="documents"?"unknown":evidence.state,remaining:evidence.remaining});
    }
    expect(cleanStore.remove(ref).absenceProven).toBe(false);
    expect(localCleanCustody(custodyRoot).observe(ref).state).toBe('absent');
    await expect(eraseLocalDocumentBatch(eraseDb!,hh,deletionId,claims)).rejects.toThrow();
    expect(await verifyDb!.withHousehold(hh,tx=>tx.document.count())).toBe(1);
    // File DELETE + online row operations acknowledged; independent observations still
    // distinguish database absence from provider/backup coverage, never a final receipt.
    for(const claim of Object.values(claims))expect(await recordDeletionAttempt(eraseDb!,hh,claim.id,claim.token,"acknowledged")).toBe(true);
    expect(await observeLocalDeletionResource(verifyDb!,hh,resources.find(r=>r.component==="derived-records")!.id)).toMatchObject({state:"remaining"});
    expect(await readDeletionProgress(appDb,hh,deletionId)).toMatchObject({finalReceiptIssuable:false,providerErasure:"unverified",backupExpiry:"unverified"});
    expect(await runHouseholdDispatchOnce(dispatchDb!,hh,"stg",{send:async()=>{throw new Error("fenced");}})).toMatchObject({status:"blocked"});
    expect(observer.restoreGate([hh]).activationAllowed).toBe(false);
  } finally {
    vi.restoreAllMocks();if(previous.intake===undefined)delete process.env.DOCUMENT_INTAKE_ENABLED;else process.env.DOCUMENT_INTAKE_ENABLED=previous.intake;
    if(previous.issuer===undefined)delete process.env.AUTH_ISSUER;else process.env.AUTH_ISSUER=previous.issuer;
    if(previous.scope===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous.scope;
    const where={householdId:hh};
    await admin.deletionObservation.deleteMany({where});await admin.deletionAttempt.deleteMany({where});await admin.deletionResource.deleteMany({where});await admin.householdDeletion.deleteMany({where});
    await admin.documentResultReview.deleteMany({where});await admin.documentResult.deleteMany({where});await admin.documentProcessing.deleteMany({where});await admin.documentCustody.deleteMany({where});
    await admin.documentScanAttempt.deleteMany({where});await admin.documentScan.deleteMany({where});await admin.outboxEvent.deleteMany({where});
    await admin.household.deleteMany({where:{id:hh}});await admin.auditLog.deleteMany({where});await admin.user.deleteMany({where:{id:owner}});
    for(const role of roles)await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);
    await Promise.all([admin,app,...clients].map(c=>c.$disconnect()));rmSync(root,{recursive:true,force:true});rmSync(custodyRoot,{recursive:true,force:true});
  }
});
