import type { ScopedClient } from "./scoped.js";
export interface EffectivePlan { tier:"free"|"premium";version:number;documentsPerMonth:number;documentWarning:number;managedHumans:number|null }
/** Database-time view; TEST eligibility is usable only when fixture administration
 * explicitly activates it locally. No request or billing role may edit the catalog. */
export async function readEffectivePlan(tx:ScopedClient,householdId:string):Promise<EffectivePlan>{
 const [p]=await tx.$queryRaw<EffectivePlan[]>`SELECT tier,version,documents_per_month AS "documentsPerMonth",document_warning AS "documentWarning",managed_humans AS "managedHumans" FROM effective_plan WHERE household_id=${householdId}::uuid`;
 if(!p)throw new Error("Plan unavailable");return p;
}
export function consumesHumanAllowance(member:{kind:string;userId:string|null;archivedAt:Date|null},ownerId:string){
 return member.archivedAt===null && ["adult","child","dependent"].includes(member.kind) && member.userId!==ownerId;
}
export async function managedHumanCount(tx:ScopedClient,householdId:string){
 const [r]=await tx.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM household_members m JOIN households h ON h.id=m.household_id WHERE m.household_id=${householdId}::uuid AND m.archived_at IS NULL AND m.kind IN ('adult','child','dependent') AND m.user_id IS DISTINCT FROM h.created_by`;
 return Number(r!.count);
}
