import { randomUUID } from "node:crypto";
import { recordAudit, runAsSystem } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";
import { outbox } from "./outbox.js";

/** ADR-021 local broker. No provider/network/filesystem work in scoped transactions.
 * The hostile scanner and model stub never receive this database authority. */
async function locked<T>(db:Database,hh:string,fn:(tx:ScopedClient)=>Promise<T>):Promise<T>{
 return runAsSystem("Bounded local processing transition",()=>db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`processing-quota:${hh}`},0))`;
  return fn(tx);
 }));
}
export async function registerCleanCustody(db:Database,hh:string,scanId:string){
 return locked(db,hh,async tx=>{
  const [s]=await tx.$queryRaw<Array<{id:string;document_id:string;sha256:Uint8Array;size_bytes:number}>>`SELECT id,document_id,sha256,size_bytes FROM document_scans WHERE id=${scanId}::uuid AND household_id=${hh}::uuid AND state='clean'`;
  if(!s)throw new Error("Clean custody refused");
  const existing=await tx.documentCustody.findFirst({where:{householdId:hh,documentId:s.document_id}});
  if(existing){if(existing.scanId!==scanId)throw new Error("Custody binding changed");return existing;}
  await tx.$executeRaw`INSERT INTO document_custodies(household_id,document_id,scan_id,object_id,sha256,size_bytes)
   VALUES(${hh}::uuid,${s.document_id}::uuid,${scanId}::uuid,${randomUUID()}::uuid,${s.sha256},${s.size_bytes})`;
  return (await tx.documentCustody.findFirst({where:{householdId:hh,documentId:s.document_id}}))!;
 });
}
/** Call only after the separate local adapter verifies exact immutable bytes. A
 * broker acknowledgement is not proof against a compromised broker or OS owner. */
export async function markCleanCustodyReady(db:Database,hh:string,id:string){
 return locked(db,hh,async tx=>{
  await tx.$executeRaw`UPDATE document_custodies SET state='ready' WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='copying'`;
  const c=await tx.documentCustody.findFirst({where:{id,householdId:hh,state:"ready"}});
  if(!c)throw new Error("Custody not ready");
  await tx.$executeRaw`INSERT INTO document_processing(household_id,custody_id) VALUES(${hh}::uuid,${id}::uuid) ON CONFLICT(custody_id) DO NOTHING`;
  return (await tx.documentProcessing.findFirst({where:{householdId:hh,custodyId:id}}))!.id;
 });
}
export async function reserveDocumentProcessing(db:Database,hh:string,id:string){
 return locked(db,hh,async tx=>{
  const [r]=await tx.$queryRaw<Array<{id:string;lease_token:string;lease_until:Date;period_start:Date}>>`UPDATE document_processing SET state='reserved',lease_token=${randomUUID()}::uuid
   WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='waiting' AND attempts<3 RETURNING id,lease_token,lease_until,period_start`;
  return r??null;
 });
}
export async function startDocumentProcessing(db:Database,hh:string,id:string,token:string){
 return locked(db,hh,async tx=>{
  const n=await tx.$executeRaw`UPDATE document_processing SET state='started' WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='reserved' AND lease_token=${token}::uuid`;
  if(n!==1)return false;
  const [d]=await tx.$queryRaw<Array<{document_id:string}>>`SELECT c.document_id FROM document_custodies c JOIN document_processing w ON w.custody_id=c.id AND w.household_id=c.household_id WHERE w.id=${id}::uuid AND w.household_id=${hh}::uuid`;
  if(!d)throw new Error('Document processing binding lost');
  await tx.$executeRaw`UPDATE documents SET status='processing',updated_at=clock_timestamp() WHERE id=${d.document_id}::uuid AND household_id=${hh}::uuid`;
  await recordAudit(tx,'document.processing_transitioned',{type:'document',id:d.document_id});return true;
 });
}
async function documentAttention(tx:ScopedClient,hh:string,id:string,state:'failed'|'needs_review'){
 const [r]=await tx.$queryRaw<Array<{id:string}>>`UPDATE documents d SET status=${state}::"DocStatus",updated_at=clock_timestamp()
 FROM document_custodies c JOIN document_processing w ON w.custody_id=c.id AND w.household_id=c.household_id
 WHERE d.id=c.document_id AND d.household_id=c.household_id AND w.id=${id}::uuid AND w.household_id=${hh}::uuid AND d.status<>${state}::"DocStatus" RETURNING d.id`;
 if(r){await recordAudit(tx,'document.processing_transitioned',{type:'document',id:r.id});
  await outbox(tx).emit({event_type:state==='failed'?'document.failed':'document.needs_review',aggregate_type:'document',aggregate_id:r.id,household_id:hh,payload:{processing_id:id}});}
}
export async function finishDocumentProcessing(db:Database,hh:string,id:string,token:string,resultRef:string|null){
 return locked(db,hh,async tx=>{
  const old=await tx.documentProcessing.findFirst({where:{id,householdId:hh}});
  if(old?.state==='completed'&&old.leaseToken===token&&old.resultRef===resultRef)return "already-completed" as const;
  const [r]=await tx.$queryRaw<Array<{custody_id:string}>>`UPDATE document_processing SET state=${resultRef===null?'failed':'completed'},result_ref=${resultRef}::uuid
   WHERE id=${id}::uuid AND household_id=${hh}::uuid AND state='started' AND lease_token=${token}::uuid RETURNING custody_id`;
  if(!r)return "not-owned" as const;
  if(resultRef!==null){
   const c=await tx.documentCustody.findFirst({where:{id:r.custody_id,householdId:hh}});
   if(!c)throw new Error("Custody lost");
   await outbox(tx).emit({event_type:"document.processed",aggregate_type:"document",aggregate_id:c.documentId,household_id:hh,payload:{processing_id:id}});
  }
  if(resultRef===null)await documentAttention(tx,hh,id,'failed');
  return resultRef===null?"failed" as const:"completed" as const;
 });
}
/** No external retries. Expired unstarted work can retry; started ambiguity cannot. */
export async function reconcileDocumentProcessing(db:Database,hh:string){
 return locked(db,hh,async tx=>{
  const held=await tx.$executeRaw`UPDATE document_custodies SET state='held' WHERE household_id=${hh}::uuid AND state IN ('copying','ready') AND review_at<=clock_timestamp()`;
  const releasedRows=await tx.$queryRaw<Array<{id:string;state:string}>>`UPDATE document_processing SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'waiting' END WHERE household_id=${hh}::uuid AND state='reserved' AND lease_until<=clock_timestamp() RETURNING id,state`;
  for(const r of releasedRows)if(r.state==='failed')await documentAttention(tx,hh,r.id,'failed');
  const released=releasedRows.length;
  const uncertainRows=await tx.$queryRaw<Array<{id:string}>>`UPDATE document_processing SET state='indeterminate' WHERE household_id=${hh}::uuid AND state='started' AND lease_until<=clock_timestamp() RETURNING id`;
  for(const r of uncertainRows)await documentAttention(tx,hh,r.id,'needs_review');
  const uncertain=uncertainRows.length;
  // Custody budget bounds this scan to 20 records; no unscoped discovery or scheduler.
  const next=await tx.$queryRaw<Array<{id:string}>>`SELECT w.id FROM document_processing w JOIN document_custodies c ON c.id=w.custody_id AND c.household_id=w.household_id
   WHERE w.household_id=${hh}::uuid AND w.state='waiting' AND w.attempts<3 AND c.state='ready' AND c.review_at>clock_timestamp() ORDER BY w.created_at,w.id LIMIT 1`;
  return {held,released,uncertain,next:next[0]?.id??null};
 });
}
export async function readDocumentProcessingUsage(db:Database,hh:string){
 return db.withHousehold(hh,async tx=>{
  const [r]=await tx.$queryRaw<Array<{completed:bigint;reserved:bigint;pending:bigint}>>`SELECT
   count(*) FILTER(WHERE state='completed' AND period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS completed,
   count(*) FILTER(WHERE state IN ('reserved','started','indeterminate') AND period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS reserved,
   count(*) FILTER(WHERE state='waiting') AS pending FROM document_processing WHERE household_id=${hh}::uuid`;
  return {completed:Number(r!.completed),reserved:Number(r!.reserved),pending:Number(r!.pending)};
 });
}
