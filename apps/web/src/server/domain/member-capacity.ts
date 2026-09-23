import {readEffectivePlan,managedHumanCount,consumesHumanAllowance,type ScopedClient} from "@autobureau/db";
import {HttpProblem} from "@/server/http/problem";
export async function assertMemberCapacity(tx:ScopedClient,householdId:string,next:{kind:string;userId:string|null;archivedAt:Date|null},prior?:{kind:string;userId:string|null;archivedAt:Date|null}){
 const hh=await tx.household.findUnique({where:{id:householdId},select:{createdBy:true}});
 if(!hh)throw new HttpProblem("unavailable","Your household plan could not be loaded.");
 if(!consumesHumanAllowance(next,hh.createdBy)||prior&&consumesHumanAllowance(prior,hh.createdBy))return;
 const plan=await readEffectivePlan(tx,householdId);
 if(plan.managedHumans!==null && await managedHumanCount(tx,householdId)>=plan.managedHumans)
  throw new HttpProblem("cap-exceeded","Your plan’s managed-person allowance has been reached. Existing people and records remain safe.");
}

/** Explicit owner declaration. Never infer identity from age, kind, name or order. */
export async function assertNewSelfBinding(tx:ScopedClient,householdId:string,userId:string){
 const hh=await tx.household.findUnique({where:{id:householdId},select:{createdBy:true}});
 if(hh?.createdBy!==userId)throw new HttpProblem("forbidden","Only the account holder can create their own record.");
 if(await tx.householdMember.findFirst({where:{householdId,userId},select:{id:true}}))
  throw new HttpProblem("conflict","Your account-holder record already exists. Edit or restore that record instead.");
}
