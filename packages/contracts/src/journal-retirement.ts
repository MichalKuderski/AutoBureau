import {z} from 'zod';

export const JOURNAL_CLASSES=['scan','custody','processing','results','outbox','account-security','exports','stripe','plaid','deletion','audit'] as const;
const dependencies={
 scan:['replay','content','restore'],custody:['replay','accounting','content','restore'],processing:['replay','accounting','provider','restore'],
 results:['replay','accounting','content','restore'],outbox:['replay','provider','restore','content'],
 'account-security':['replay','restore'],exports:['replay','content','restore'],stripe:['replay','accounting','provider','restore'],
 plaid:['replay','accounting','provider','content','restore'],deletion:['replay','provider','restore','audit'],audit:['replay','accounting','restore','audit','content'],
} as const;
const evidence=z.object({state:z.enum(['closed','open','unknown']),reference:z.string().uuid(),validUntil:z.string().datetime()}).strict();
export const RetirementReviewSchema=z.object({
 version:z.literal(1),householdId:z.string().uuid(),deletionId:z.string().uuid(),operationId:z.string().uuid(),journalClass:z.enum(JOURNAL_CLASSES),
 snapshotAt:z.string().datetime(),leaseUntil:z.string().datetime().nullable(),fenced:z.boolean(),count:z.number().int().min(0).max(100),
 dependencies:z.object({replay:evidence,accounting:evidence,provider:evidence,content:evidence,restore:evidence,audit:evidence}).strict(),
 hold:z.object({state:z.enum(['clear','active','unknown']),authorizationId:z.string().uuid(),reviewBy:z.string().datetime()}).strict(),
}).strict();
/** Readiness calculation ONLY. Inputs must come from independently reviewed sources.
 * A caller-supplied boolean, an expired hold or DB-local replica never authorizes purge.
 * There is deliberately no executor, delete capability or final receipt in this result. */
export function reviewJournalRetirement(input:unknown,dbNow:Date){
 const r=RetirementReviewSchema.parse(input),now=dbNow.getTime();
 if(!Number.isFinite(now)||Date.parse(r.snapshotAt)>now)throw new Error('Retirement review refused');
 const blockers:string[]=[];
 if(!r.fenced)blockers.push('deletion-fence');
 if(r.leaseUntil&&Date.parse(r.leaseUntil)>now)blockers.push('active-lease');
 if(r.hold.state!=='clear'||Date.parse(r.hold.reviewBy)<=now)blockers.push('incident-hold-unresolved');
 for(const key of dependencies[r.journalClass]){const e=r.dependencies[key];if(e.state!=='closed'||Date.parse(e.validUntil)<=now)blockers.push(key);}
 return Object.freeze({operationId:r.operationId,count:r.count,blockers:Object.freeze(blockers),status:blockers.length?'blocked' as const:'ready-for-independent-review' as const,
  operationalRetirementAuthorized:false as const,finalReceiptIssuable:false as const});
}
export const RETIREMENT_DEPENDENCIES=dependencies;
