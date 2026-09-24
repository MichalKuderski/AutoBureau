import { UUID_RE } from "@autobureau/contracts";
import type { Database } from "./scoped.js";
import { currentActor } from "./audit.js";
const refuse = (): never => { throw new Error("Export journal unavailable"); };
export interface ExportPublication { householdId:string; requestId:string; ownerId:string; digest:string; bytes:number; snapshotAt:string; expiresAt:string; format?:'jsonl-v2'|'archive-v3'; complete?:boolean }
/** Only authenticated ciphertext metadata enters this journal, never plaintext
 * digest, filename, key, content or download capability. SQL enforces live owner,
 * intent TTL, immutable columns, privacy fence and terminal denial. */
export async function journalExportPublication(db:Database,p:ExportPublication){
 if(![p.householdId,p.requestId,p.ownerId].every(v=>UUID_RE.test(v))||!/^[a-f0-9]{64}$/.test(p.digest)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>((p.format??'jsonl-v2')==='archive-v3'?629145600:4194304)||(p.complete===true&&p.format!=='archive-v3'))return refuse();
 const actor=currentActor();if(actor?.type!=="user"||actor.userId!==p.ownerId)return refuse();
 return db.withHousehold(p.householdId,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${p.householdId}::uuid)`;
  await tx.$executeRaw`INSERT INTO local_export_artifacts(household_id,request_id,owner_id,ciphertext_digest,size_bytes,snapshot_at,expires_at,format,complete)
   VALUES(${p.householdId}::uuid,${p.requestId}::uuid,${p.ownerId}::uuid,${p.digest},${p.bytes},${new Date(p.snapshotAt)},${new Date(p.expiresAt)},${p.format??'jsonl-v2'},${p.complete??false}) ON CONFLICT(household_id,request_id) DO NOTHING`;
  const [r]=await tx.$queryRaw<Array<{owner_id:string;ciphertext_digest:string;size_bytes:number;state:string;snapshot_at:Date;expires_at:Date;format:string;complete:boolean}>>`SELECT owner_id,ciphertext_digest,size_bytes,state,snapshot_at,expires_at,format,complete FROM local_export_artifacts WHERE household_id=${p.householdId}::uuid AND request_id=${p.requestId}::uuid`;
  if(!r||r.state!=="partial"||r.owner_id!==p.ownerId||r.ciphertext_digest!==p.digest||r.size_bytes!==p.bytes||r.snapshot_at.getTime()!==Date.parse(p.snapshotAt)||r.expires_at.getTime()!==Date.parse(p.expiresAt)||r.format!==(p.format??'jsonl-v2')||r.complete!==(p.complete??false))return refuse();
 });
}
export async function assertExportPublication(db:Database,p:ExportPublication){
 return db.withHousehold(p.householdId,async tx=>{
  const actor=currentActor();if(actor?.type!=="user"||actor.userId!==p.ownerId)return refuse();
  const [r]=await tx.$queryRaw<Array<{ok:boolean}>>`SELECT true AS ok FROM local_export_artifacts WHERE household_id=${p.householdId}::uuid AND request_id=${p.requestId}::uuid
   AND owner_id=${p.ownerId}::uuid AND state='partial' AND ciphertext_digest=${p.digest} AND size_bytes=${p.bytes} AND expires_at>clock_timestamp()
   AND format=${p.format??'jsonl-v2'} AND complete=${p.complete??false}`;
  if(!r)return refuse();
 });
}
export async function revokeExportPublication(db:Database,hh:string,requestId:string){
 return db.withHousehold(hh,async tx=>{
  await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
  await tx.$executeRaw`UPDATE local_export_artifacts SET state='revoked' WHERE household_id=${hh}::uuid AND request_id=${requestId}::uuid AND state='partial'`;
 });
}
