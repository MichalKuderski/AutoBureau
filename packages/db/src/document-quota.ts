import {DocumentQuotaSchema} from '@autobureau/contracts';
import type {Database} from './scoped.js';
/** One household-scoped statement. Display is never mutation authorization. The
 * legacy upload counter and browser time are deliberately not used. */
export async function readDocumentQuota(db:Database,hh:string){
 return db.withHousehold(hh,async tx=>{
  const [r]=await tx.$queryRaw<Array<{plan:string;allowance:number;warningThreshold:number;processed:bigint;reservedSlots:bigint;queuedClean:bigint;processing:bigint;needsReview:bigint;actionRequired:bigint;nextPeriod:Date;grace:boolean}>>`
   WITH clock AS MATERIALIZED(SELECT clock_timestamp() AS at), period AS(SELECT at,date_trunc('month',at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start FROM clock),
   work AS(SELECT w.*,c.state AS custody_state,c.review_at,r.id AS artifact FROM document_processing w JOIN document_custodies c ON c.id=w.custody_id AND c.household_id=w.household_id
    LEFT JOIN document_results r ON r.processing_id=w.id AND r.household_id=w.household_id WHERE w.household_id=${hh}::uuid)
   SELECT p.tier AS plan,p.documents_per_month AS allowance,p.document_warning AS "warningThreshold",
    (SELECT count(*) FROM work WHERE state='completed' AND period_start=t.start) AS processed,
    (SELECT count(*) FROM work WHERE state IN ('reserved','started','indeterminate') AND period_start=t.start) AS "reservedSlots",
    (SELECT count(*) FROM work WHERE state='waiting' AND custody_state='ready' AND review_at>t.at) AS "queuedClean",
    (SELECT count(*) FROM work WHERE state='started' AND artifact IS NULL AND lease_until>t.at) AS processing,
    (SELECT count(*) FROM work WHERE state IN ('started','indeterminate') AND artifact IS NOT NULL) AS "needsReview",
    (SELECT count(*) FROM work WHERE state NOT IN ('completed','cancelled','failed') AND (custody_state='held' OR review_at<=t.at OR (state='indeterminate' AND artifact IS NULL) OR (artifact IS NOT NULL AND period_start<>t.start))) AS "actionRequired",
    ((t.start AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' AS "nextPeriod",
    (p.tier='premium' AND EXISTS(SELECT 1 FROM billing_test_eligibility b WHERE b.household_id=${hh}::uuid AND b.state='grace' AND b.eligible)) AS grace
    FROM effective_plan p CROSS JOIN period t WHERE p.household_id=${hh}::uuid`;
  if(!r)throw new Error('Document quota unavailable');
  return DocumentQuotaSchema.parse({...r,processed:Number(r.processed),reservedSlots:Number(r.reservedSlots),queuedClean:Number(r.queuedClean),processing:Number(r.processing),needsReview:Number(r.needsReview),actionRequired:Number(r.actionRequired),warning:Number(r.processed)>=r.warningThreshold,nextPeriod:r.nextPeriod.toISOString(),localOnly:true});
 });
}
