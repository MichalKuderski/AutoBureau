import {currentActor} from './audit.js';
import type {Database} from './scoped.js';

export type LocalResultResolution = 'reusable-original-period'|'current-period-capacity-unavailable'|'customer-action-required'|'operator-review-required'|'canceled'|'deletion-fenced'|'incompatible-result'|'approved-result-reuse';
/** Bounded owner-only read, not publication/charge authorization. No provider call,
 * period transfer, cancellation, purge or retry is performed by inspecting a hold. */
export async function readLocalResultResolution(db:Database,householdId:string,resultId:string){
 const actor=currentActor();if(actor?.type!=='user')throw new Error('Document resolution unavailable');
 return db.withHousehold(householdId,async tx=>{
  if(!await tx.householdUser.findFirst({where:{householdId,userId:actor.userId,role:'owner'}})||!await tx.user.findFirst({where:{id:actor.userId,status:'active'},select:{id:true}}))throw new Error('Document resolution unavailable');
  const [row]=await tx.$queryRaw<Array<{id:string;period:Date;state:LocalResultResolution;item_id:string|null;obligation_id:string|null}>>`
   WITH clock AS MATERIALIZED(SELECT clock_timestamp() AS at), period AS(SELECT at,date_trunc('month',at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start FROM clock)
   SELECT r.id,r.period_start AS period,v.item_id,v.obligation_id,CASE
    WHEN EXISTS(SELECT 1 FROM household_deletions d WHERE d.household_id=r.household_id AND d.state IN ('fenced','verifying','completed')) THEN 'deletion-fenced'
    WHEN w.state='cancelled' OR c.state='cancelled' THEN 'canceled'
    WHEN r.schema_version<>1 OR r.parser_version<>'canonical-public-deadline-pdf-v1' OR r.redactor_version<>'closed-enums-v1' OR r.source_sha256<>c.sha256 OR r.period_start<>w.period_start OR r.period_end<>w.period_end THEN 'incompatible-result'
    WHEN w.state='completed' AND w.result_ref=r.id AND v.id IS NOT NULL THEN 'approved-result-reuse'
    WHEN w.state NOT IN ('started','indeterminate') OR c.state<>'ready' OR c.review_at<=t.at THEN 'operator-review-required'
    WHEN r.period_start<>t.start OR r.period_end<=t.at THEN 'customer-action-required'
    WHEN p.tier IS NULL THEN 'operator-review-required'
    WHEN (SELECT count(*) FROM document_processing other WHERE other.household_id=r.household_id AND other.id<>w.id AND other.period_start=t.start AND other.state IN ('reserved','started','indeterminate','completed'))>=p.documents_per_month THEN 'current-period-capacity-unavailable'
    ELSE 'reusable-original-period' END AS state
   FROM document_results r JOIN document_processing w ON w.id=r.processing_id AND w.household_id=r.household_id
   JOIN document_custodies c ON c.id=r.custody_id AND c.household_id=r.household_id
   LEFT JOIN document_result_reviews v ON v.result_id=r.id AND v.household_id=r.household_id
   LEFT JOIN effective_plan p ON p.household_id=r.household_id CROSS JOIN period t
   WHERE r.id=${resultId}::uuid AND r.household_id=${householdId}::uuid LIMIT 1`;
  if(!row)throw new Error('Document resolution unavailable');
  return {resultId:row.id,originalPeriod:row.period.toISOString(),state:row.state,
   published:row.state==='approved-result-reuse'?{itemId:row.item_id!,obligationId:row.obligation_id!}:null,
   crossPeriodReusePolicyRequired:row.state==='customer-action-required',providerRetryAllowed:false as const,chargeAuthorized:false as const,localOnly:true as const};
 });
}
