import type { Database } from "@autobureau/db";
import type { AccountProvider } from "./account-provider";
import type { VerifiedPrincipal } from "./jwt";
import { membershipsVia } from "./context";
import { withHouseholdSession } from "./household-session";
import { dashboardPhase } from "../observability/dashboard-render";
/** Phase one reveals only candidate UUIDs/roles to the server. Names are released
 * only after each candidate's live policy and provider-factor checks pass. */
export async function householdOptions(db:Database,principal:VerifiedPrincipal,token:string,provider:Pick<AccountProvider,"factors">) {
  const memberships=await dashboardPhase("memberships", () => membershipsVia(db)(principal.userId));
  const rows=[];
  for(const membership of memberships){
    const ctx={...membership,userId:principal.userId};
    rows.push(await withHouseholdSession(db,ctx,principal,token,provider,"registry.read",()=>dashboardPhase("option_read", () => db.withHousehold(ctx.householdId,async tx=>{
      const row=await tx.household.findFirst({select:{id:true,name:true}});
      if(!row)throw new Error("Household unavailable");
      return row;
    }))));
  }
  return rows;
}
