import type {Database} from './scoped.js';

export type DocumentWorkState='checking'|'waiting'|'working'|'done'|'held'|'stopped'|'failed'|'rejected'|'none';
export interface DocumentWork {documentId:string;state:DocumentWorkState;cancellable:boolean;reviewAt:string|null}
export class DocumentWorkNotCancellable extends Error {constructor(){super('Document work has started and cannot be cancelled');}}
type Row={id:string;scan:string|null;custody:string|null;review_at:Date|null;work:string|null;lease:boolean|null};

async function read(tx:Parameters<Parameters<Database['withHousehold']>[1]>[0],householdId:string,documentId:string):Promise<DocumentWork|null>{
 const [r]=await tx.$queryRaw<Row[]>`
  SELECT d.id,
   (SELECT s.state FROM document_scans s WHERE s.document_id=d.id AND s.household_id=d.household_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS scan,
   c.state AS custody,c.review_at,w.state AS work,(w.lease_token IS NOT NULL) AS lease
  FROM documents d LEFT JOIN document_custodies c ON c.document_id=d.id AND c.household_id=d.household_id
  LEFT JOIN document_processing w ON w.custody_id=c.id AND w.household_id=c.household_id
  WHERE d.id=${documentId}::uuid AND d.household_id=${householdId}::uuid LIMIT 1`;
 if(!r)return null;
 const state:DocumentWorkState=r.custody===null
  ? r.scan==='queued'||r.scan==='scanning'?'checking':r.scan==='rejected'||r.scan==='exhausted'?'rejected':'none'
  : r.custody==='cancelled'||r.work==='cancelled'?'stopped'
  : r.work==='completed'?'done':r.work==='failed'?'failed'
  : r.work==='reserved'||r.work==='started'||r.work==='indeterminate'?'working'
  : r.custody==='held'?'held':'waiting';
 // Mirrors app.guard_owner_document_cancel; the database remains the authority.
 const cancellable=r.custody!==null&&['copying','ready','held'].includes(r.custody)
  &&(r.work===null||r.work==='failed'||(r.work==='waiting'&&!r.lease));
 return {documentId:r.id,state,cancellable,reviewAt:r.review_at?.toISOString()??null};
}
/** Household-scoped read of one document's work. Metadata only; no content. */
export function readDocumentWork(db:Database,householdId:string,documentId:string){
 return db.withHousehold(householdId,tx=>read(tx,householdId,documentId));
}
/** Stops work that has not been reserved or started. Keeps bytes, custody accounting and
 * journals; never deletes, releases capacity, retries or touches a provider. */
export function cancelDocumentWork(db:Database,householdId:string,documentId:string){
 return db.withHousehold(householdId,async tx=>{
  const before=await read(tx,householdId,documentId);
  if(!before)return null;
  if(before.state==='stopped')return before;
  if(!before.cancellable)throw new DocumentWorkNotCancellable();
  try{
   await tx.$executeRaw`UPDATE document_processing w SET state='cancelled' FROM document_custodies c
    WHERE w.custody_id=c.id AND w.household_id=c.household_id AND c.document_id=${documentId}::uuid
    AND c.household_id=${householdId}::uuid AND w.state='waiting'`;
   const n=await tx.$executeRaw`UPDATE document_custodies SET state='cancelled'
    WHERE document_id=${documentId}::uuid AND household_id=${householdId}::uuid AND state IN ('copying','ready','held')`;
   if(n!==1)throw new DocumentWorkNotCancellable();
  }catch(e){
   if(e instanceof DocumentWorkNotCancellable)throw e;
   if(/Document work has started and cannot be cancelled/.test(String((e as {message?:string})?.message??e)))throw new DocumentWorkNotCancellable();
   throw e;
  }
  return read(tx,householdId,documentId);
 });
}
