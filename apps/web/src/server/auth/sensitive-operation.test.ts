// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createSensitiveOperationPolicy, sensitiveOperations } from "./sensitive-operation";
import type { VerifiedPrincipal } from "./jwt";
const now=1790000000, userId="a0000000-0000-4000-8000-000000000001", sessionId="b0000000-0000-4000-8000-000000000001", hh="c0000000-0000-4000-8000-000000000001";
function setup() {
 const principal: VerifiedPrincipal={userId,email:undefined,issuedAt:now,expiresAt:now+600,assurance:{sessionId,level:"aal1",methods:[{method:"password",timestamp:now-1}]}};
 const factors={userId,factors:[] as Array<{id:string;factor_type:"totp";status:"verified"|"unverified"}>};
 const ports={verifyJwt:vi.fn(async()=>principal),factors:vi.fn(async()=>factors),admit:vi.fn(async()=>({requiresMfa:false}))};
 return {principal,factors,ports,run:()=>createSensitiveOperationPolicy(ports,()=>now)("synthetic.signed.token",hh,"export.download")};
}
it.each(sensitiveOperations)("requires the same fresh checks for %s",async operation=>{
 const f=setup();const result=await createSensitiveOperationPolicy(f.ports,()=>now)("synthetic.signed.token",hh,operation);
 expect(result).toMatchObject({authorized:true,userId,householdId:hh,sessionId,operation,sessionRevocationVerified:false});
 expect(f.ports.admit).toHaveBeenCalledTimes(2);expect(f.ports.factors).toHaveBeenCalledWith("synthetic.signed.token");
});
it.each(["stale","expired","unknown-session","unknown-operation","bad-signature","foreign-user","unavailable","malformed-factor","duplicate-factor","fenced-before","fenced-after","stale-factor-read"])("refuses %s",async mode=>{
 const f=setup();
 if(mode==="stale")f.principal.assurance!.methods[0]!.timestamp=now-900;
 if(mode==="expired")Object.assign(f.principal,{expiresAt:now});
 if(mode==="unknown-session")f.principal.assurance!.sessionId="unknown";
 if(mode==="bad-signature")f.ports.verifyJwt.mockRejectedValue(new Error("signature"));
 if(mode==="foreign-user")f.factors.userId=sessionId;
 if(mode==="unavailable")f.ports.factors.mockRejectedValue(new Error("unavailable"));
 if(mode==="malformed-factor")f.factors.factors.push({id:hh,factor_type:"totp",status:"revoked" as never});
 if(mode==="duplicate-factor")f.factors.factors.push(...Array(2).fill({id:hh,factor_type:"totp",status:"verified"}));
 if(mode==="fenced-before")f.ports.admit.mockRejectedValue(new Error("fence"));
 if(mode==="fenced-after")f.ports.admit.mockResolvedValueOnce({requiresMfa:false}).mockRejectedValueOnce(new Error("fence"));
 if(mode==="stale-factor-read") {let calls=0;await expect(createSensitiveOperationPolicy(f.ports,()=>++calls<3?now:now+61)("token",hh,"export.download")).rejects.toThrow();return;}
 await expect(mode==="unknown-operation"?createSensitiveOperationPolicy(f.ports,()=>now)("token",hh,"unknown" as never):f.run()).rejects.toThrow();
});
it.each(["missing","unverified","aal1","no-totp","stale-totp"])("required MFA rejects %s",async mode=>{
 const f=setup();f.ports.admit.mockResolvedValue({requiresMfa:true});
 if(mode!=="missing")f.factors.factors.push({id:hh,factor_type:"totp",status:mode==="unverified"?"unverified":"verified"});
 f.principal.assurance!.level=mode==="aal1"?"aal1":"aal2";
 if(mode!=="no-totp")f.principal.assurance!.methods.push({method:"totp",timestamp:mode==="stale-totp"?now-900:now});
 await expect(f.run()).rejects.toThrow();
});
it("accepts required MFA with current factor and recent signed TOTP",async()=>{
 const f=setup();f.ports.admit.mockResolvedValue({requiresMfa:true});f.factors.factors.push({id:hh,factor_type:"totp",status:"verified"});
 f.principal.assurance!.level="aal2";f.principal.assurance!.methods.push({method:"totp",timestamp:now});expect((await f.run()).authorized).toBe(true);
});
it("uses stricter policy if secrets appear during provider I/O",async()=>{
 const f=setup();f.ports.admit.mockResolvedValueOnce({requiresMfa:false}).mockResolvedValueOnce({requiresMfa:true});await expect(f.run()).rejects.toThrow();
});
it("does not cache provider evidence across decisions",async()=>{
 const f=setup();await f.run();f.ports.factors.mockRejectedValueOnce(new Error("revoked"));await expect(f.run()).rejects.toThrow();expect(f.ports.factors).toHaveBeenCalledTimes(2);
});

it("provider lookup duration consumes, rather than renews, factor-evidence lifetime",async()=>{
 const f=setup();let at=now;f.ports.factors.mockImplementation(async()=>{at+=61;return f.factors;});
 await expect(createSensitiveOperationPolicy(f.ports,()=>at)("token",hh,"export.download")).rejects.toThrow();
});
