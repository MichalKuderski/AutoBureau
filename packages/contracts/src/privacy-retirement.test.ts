import { expect,it } from "vitest";
import { planPrivacyRetirement } from "./privacy-retirement.js";
const base={component:"outbox-delivery-inbox",irreversibleFence:true,settledAt:1,now:15*86400_000,activeLeaseCount:0,remainingDocumentCount:0,securityHold:"clear",independentTombstoneVerified:true,policyApproved:true};
it("plans bounded retirement without erasing audit/fence or issuing a receipt",()=>{expect(planPrivacyRetirement(base)).toMatchObject({eligible:true,batchLimit:100,retainFence:true,deleteAudit:false,finalReceiptIssuable:false});});
it.each([{policyApproved:false},{irreversibleFence:false},{independentTombstoneVerified:false},{securityHold:"unknown"},{securityHold:"held"},{activeLeaseCount:1},{remainingDocumentCount:1},{now:14*86400_000},{now:0},{arbitrary:"payload"}])("fails closed for incomplete retirement evidence %j",change=>{expect(planPrivacyRetirement({...base,...change}).eligible).toBe(false);});
it("keeps separate fixed scan and queue horizons",()=>{
 expect(planPrivacyRetirement({...base,component:"scan-journals",now:7*86400_000})).toMatchObject({eligible:false});
 expect(planPrivacyRetirement({...base,component:"scan-journals",now:7*86400_000+1})).toMatchObject({eligible:true});
 expect(planPrivacyRetirement({...base,now:14*86400_000+1})).toMatchObject({eligible:true});
});
