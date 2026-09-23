import {z} from 'zod';
const count=z.number().int().nonnegative();
export const DocumentQuotaSchema=z.object({plan:z.enum(['free','premium']),processed:count,allowance:count,warningThreshold:count,warning:z.boolean(),
 reservedSlots:count,queuedClean:count,processing:count,needsReview:count,actionRequired:count,nextPeriod:z.string().datetime(),grace:z.boolean(),
 localOnly:z.literal(true)}).strict();
export type DocumentQuota=z.infer<typeof DocumentQuotaSchema>;
