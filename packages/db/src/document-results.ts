import { recordAudit, currentActor, runAsSystem } from "./audit.js";
import type { Database } from "./scoped.js";
import { outbox } from "./outbox.js";

export interface SyntheticResult { id:string; processingId:string; leaseToken:string; sourceSha256:string; citationStart:number; citationEnd:number; dueDate:string }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function refuse():never {throw new Error("Document result refused");}
/** Trusted LOCAL broker attestation, not a parser or HTTP endpoint. The caller must
 * compose the ADR-018 parser/capability; SQL independently checks durable binding. */
export async function publishSyntheticResult(db:Database,hh:string,input:SyntheticResult){
 if(Object.keys(input).sort().join(',')!=='citationEnd,citationStart,dueDate,id,leaseToken,processingId,sourceSha256'
  ||![input.id,input.processingId,input.leaseToken].every(x=>uuid.test(x))||!/^[a-f0-9]{64}$/.test(input.sourceSha256)
  ||!Number.isInteger(input.citationStart)||input.citationStart<0||input.citationEnd!==input.citationStart+10||input.citationEnd>4096
  ||!/^20[2-9][0-9]-[0-1][0-9]-[0-3][0-9]$/.test(input.dueDate))refuse();
 const hash=Buffer.from(input.sourceSha256,'hex');
 return runAsSystem('Publish bound local synthetic result',()=>db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`processing-quota:${hh}`},0))`;
  const existing=await tx.$queryRaw<Array<{matches:boolean}>>`SELECT (id=${input.id}::uuid AND lease_token=${input.leaseToken}::uuid AND source_sha256=${hash}
   AND citation_start=${input.citationStart} AND citation_end=${input.citationEnd} AND due_date=${input.dueDate}::date) AS matches FROM document_results WHERE processing_id=${input.processingId}::uuid AND household_id=${hh}::uuid`;
  if(existing.length){if(!existing[0]!.matches)refuse();return input.id;}
  await tx.$executeRaw`INSERT INTO document_results(id,household_id,processing_id,lease_token,source_sha256,citation_start,citation_end,due_date)
   VALUES(${input.id}::uuid,${hh}::uuid,${input.processingId}::uuid,${input.leaseToken}::uuid,${hash},${input.citationStart},${input.citationEnd},${input.dueDate}::date)`;
  const [doc]=await tx.$queryRaw<Array<{document_id:string}>>`SELECT document_id FROM document_results WHERE id=${input.id}::uuid AND household_id=${hh}::uuid`;
  if(!doc)refuse();
  await tx.$executeRaw`UPDATE documents SET status='needs_review',updated_at=clock_timestamp() WHERE id=${doc.document_id}::uuid AND household_id=${hh}::uuid`;
  await recordAudit(tx,'document.processing_transitioned',{type:'document',id:doc.document_id});
  await outbox(tx).emit({event_type:'document.needs_review',aggregate_type:'document',aggregate_id:doc.document_id,household_id:hh,payload:{processing_id:input.processingId,result_id:input.id}});
  return input.id;
 }));
}
/** Explicit local owner approval. Domain rows, review, charge and intent are atomic.
 * This has no mounted route and cannot approve real documents. */
export async function approveSyntheticResult(db:Database,hh:string,resultId:string,confirmation:'APPROVE PUBLIC SYNTHETIC DATE'){
 const actor=currentActor();if(actor?.type!=='user'||confirmation!=='APPROVE PUBLIC SYNTHETIC DATE'||!uuid.test(resultId))refuse();
 const owner=actor.userId;
 return db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`processing-quota:${hh}`},0))`;
  if(!await tx.householdUser.findFirst({where:{householdId:hh,userId:owner,role:'owner'}}))refuse();
  const [r]=await tx.$queryRaw<Array<{id:string;processing_id:string;document_id:string;due_date:Date;citation_start:number;citation_end:number}>>`SELECT id,processing_id,document_id,due_date,citation_start,citation_end FROM document_results WHERE id=${resultId}::uuid AND household_id=${hh}::uuid`;
  if(!r)refuse();
  const [previous]=await tx.$queryRaw<Array<{item_id:string;obligation_id:string}>>`SELECT v.item_id,v.obligation_id FROM document_result_reviews v JOIN document_processing w ON w.result_ref=v.result_id AND w.household_id=v.household_id WHERE v.result_id=${resultId}::uuid AND v.household_id=${hh}::uuid AND w.state='completed'`;
  if(previous)return {itemId:previous.item_id,obligationId:previous.obligation_id,replayed:true};
  const item=await tx.item.create({data:{householdId:hh,kind:'other',name:'Public synthetic deadline notice',sourceDocumentId:r.document_id,
   attrs:{provenance:{resultId,source:'synthetic-reviewed',page:1,start:r.citation_start,end:r.citation_end}}}});
  const obligation=await tx.obligation.create({data:{householdId:hh,itemId:item.id,title:'Public synthetic deadline',kind:'custom',source:'user',sourceDocumentId:r.document_id,dueAt:r.due_date,verifiedAt:new Date()}});
  await tx.$executeRaw`INSERT INTO document_result_reviews(household_id,result_id,owner_id,item_id,obligation_id) VALUES(${hh}::uuid,${resultId}::uuid,${owner}::uuid,${item.id}::uuid,${obligation.id}::uuid)`;
  const n=await tx.$executeRaw`UPDATE document_processing SET state='completed',result_ref=${resultId}::uuid WHERE id=${r.processing_id}::uuid AND household_id=${hh}::uuid AND state IN ('started','indeterminate')`;
  if(n!==1)refuse();
  await outbox(tx).emit({event_type:'document.processed',aggregate_type:'document',aggregate_id:r.document_id,household_id:hh,payload:{processing_id:r.processing_id}});
  await tx.document.update({where:{id:r.document_id},data:{status:'processed'}});
  await outbox(tx).emit({event_type:'item.created',aggregate_type:'item',aggregate_id:item.id,household_id:hh});
  await outbox(tx).emit({event_type:'obligation.created',aggregate_type:'obligation',aggregate_id:obligation.id,household_id:hh});
  return {itemId:item.id,obligationId:obligation.id,replayed:false};
 });
}
