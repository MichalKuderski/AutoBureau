// @vitest-environment node
import { it, expect } from "vitest";
import { accountOperationEvidence, authorizeAccountOperation, type AccountOperation } from "./account-operation-policy";
import type { VerifiedPrincipal } from "./jwt";
const user="10000000-0000-4000-8000-000000000001",session="10000000-0000-4000-8000-000000000002",factor="10000000-0000-4000-8000-000000000003";
const now=2000;
function fixture(verified=false) {
 const principal:VerifiedPrincipal={userId:user,email:undefined,issuedAt:now,expiresAt:now+600,
  assurance:{sessionId:session,level:verified?"aal2":"aal1",methods:[{method:verified?"totp":"password",timestamp:now}]}};
 const factors={userId:user,factors:[{id:factor,factor_type:"totp" as const,status:verified?"verified" as const:"unverified" as const}]};
 return {principal,factors,e:()=>accountOperationEvidence(principal,factors,now,factor)};
}
it.each(["list","enroll","challenge","verify","remove"] as const)("accepts bounded recent local authority for %s",op=>{
 expect(authorizeAccountOperation(op,fixture().e(),false,now)).toEqual({sessionRevocationVerified:false});
});
it.each(["future", "stale", "expired", "invalid-policy", "bad-session", "unknown-action", "aal1-factor", "future-auth", "unknown-factor"])("closed account policy refuses %s",mode=>{
 const f=fixture(mode==="aal1-factor");
 if(mode==="expired")Object.assign(f.principal,{expiresAt:now});
 if(mode==="bad-session")f.principal.assurance!.sessionId="not-uuid";
 if(mode==="aal1-factor")f.principal.assurance!.level="aal1";
 if(mode==="future-auth")f.principal.assurance!.methods[0]!.timestamp=now+1;
 let e=f.e();if(mode==="future")e={...e,checkedAt:now+1};if(mode==="stale")e={...e,checkedAt:now-61};if(mode==="unknown-factor")e={...e,factorId:user};
 expect(()=>authorizeAccountOperation(mode==="unknown-action"?"unknown" as AccountOperation:"remove",e,mode==="invalid-policy"?undefined as never:false,now)).toThrow();
});
it("bootstrap can enroll a missing required factor but cannot remove a required verified one",()=>{
 expect(()=>authorizeAccountOperation("enroll",fixture().e(),true,now)).not.toThrow();
 expect(()=>authorizeAccountOperation("remove",fixture(true).e(),true,now)).toThrow();
});
it("factor challenge can step up aal1 but does not confer sensitive operation authority",()=>{
 const f=fixture(true);f.principal.assurance!.level="aal1";
 expect(()=>authorizeAccountOperation("challenge",f.e(),true,now)).not.toThrow();
 expect(()=>authorizeAccountOperation("remove",f.e(),false,now)).toThrow();
});
it("fresh password session cannot masquerade as single-use recovery redemption",()=>{
 const f=fixture();f.factors.factors=[];
 expect(()=>authorizeAccountOperation("recovery",f.e(),false,now)).toThrow();
 f.principal.assurance!.methods=[{method:"recovery",timestamp:now}];
 expect(()=>authorizeAccountOperation("recovery",f.e(),false,now)).not.toThrow();
 expect(()=>authorizeAccountOperation("recovery",f.e(),true,now)).toThrow();
 expect(()=>authorizeAccountOperation("recovery",{...f.e(),checkedAt:now+61},false,now+61)).toThrow();
});
it("copies and freezes factor/session evidence including authentication timestamps",()=>{
 const f=fixture(),e=f.e();f.principal.assurance!.methods[0]!.timestamp=0;f.factors.factors=[];
 expect(e.principal.assurance!.methods[0]!.timestamp).toBe(now);expect(e.factors.factors).toHaveLength(1);
 expect(()=>{e.principal.assurance!.methods[0]!.timestamp=0;}).toThrow();
});
it.each(["extra-field","duplicate","unknown-status","foreign-user"])("rejects malformed provider state %s",mode=>{
 const f=fixture();let raw:unknown=f.factors;
 if(mode==="extra-field")raw={...f.factors,metadata:{isAdmin:true}};
 if(mode==="duplicate")f.factors.factors.push(f.factors.factors[0]!);
 if(mode==="unknown-status")raw={userId:user,factors:[{id:factor,factor_type:"totp",status:"maybe"}]};
 if(mode==="foreign-user")f.factors.userId=session;
 expect(()=>authorizeAccountOperation("enroll",accountOperationEvidence(f.principal,raw,now),false,now)).toThrow();
});
