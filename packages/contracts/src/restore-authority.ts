import { z } from "zod";
const id=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const RestoreSubjectSchema=z.object({scope:z.enum(["account","household"]),id}).strict();
export const RestoreAuthorityResponseSchema=z.object({
 body:z.object({version:z.literal(1),authority:digest,generation:id,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),ledgerDigest:digest,
  challenge:id,issuedAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-300_000),expiresAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  subjects:z.array(RestoreSubjectSchema.extend({state:z.enum(["active","deleted","unknown"])}).strict()).min(1).max(100),
 }).strict(),signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();
export type RestoreAuthorityResponse=z.infer<typeof RestoreAuthorityResponseSchema>;
