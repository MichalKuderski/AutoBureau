/** ADR-019 proposed policy. Planning ONLY; no DELETE authority or provider proof.
 * Fixed horizons derive from ADR-017's longest Standard-queue retention and the
 * proposed seven-day local scan diagnostic window. Manual redrive means a fence
 * must survive forever until independently retired, regardless of queue age. */
import { z } from "zod";
const facts=z.object({
 component:z.enum(["outbox-delivery-inbox","scan-journals"]),
 irreversibleFence:z.boolean(),settledAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 14 * 86400_000),now:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 14 * 86400_000),
 activeLeaseCount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 14 * 86400_000),remainingDocumentCount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 14 * 86400_000),
 securityHold:z.enum(["held","clear","unknown"]),independentTombstoneVerified:z.boolean(),policyApproved:z.boolean(),
}).strict();
export function planPrivacyRetirement(input:unknown){
 const p=facts.safeParse(input);if(!p.success)return {eligible:false,reason:"invalid-evidence" as const,finalReceiptIssuable:false as const};
 const v=p.data,horizon=(v.component==="outbox-delivery-inbox"?14:7)*86400_000;
 const reason=!v.policyApproved?"policy-unapproved":!v.irreversibleFence?"not-fenced":!v.independentTombstoneVerified?"authority-unverified":v.securityHold!=="clear"?"hold-unresolved":v.activeLeaseCount>0?"in-flight":v.remainingDocumentCount>0?"documents-remain":v.now<v.settledAt+horizon?"retention-window":"eligible";
 return {eligible:reason==="eligible",reason,earliestAt:v.settledAt+horizon,batchLimit:100,retainFence:true,deleteAudit:false,finalReceiptIssuable:false as const};
}
