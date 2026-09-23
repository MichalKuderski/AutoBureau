import { z } from "zod";

/** TEST journal projections only; no provider payload or credentials. */
export const stripeTestId = (prefix: string) => z.string().max(245).regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,240}$`));
export const StripeTestBindingSchema = z.object({ accountId:stripeTestId("acct"),customerId:stripeTestId("cus"),subscriptionId:stripeTestId("sub"),livemode:z.literal(false) }).strict();
export const StripeTestNoticeSchema = z.object({ eventId:stripeTestId("evt"),eventType:z.enum(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed"]),
 objectId:z.string().regex(/^(sub|in)_[A-Za-z0-9]{1,240}$/),created:z.number().int().min(0).max(8_640_000_000_000) }).strict();

/** Closed persisted TEST decision, not an activated cap catalog. */
const stripeTime=z.number().int().nonnegative().max(8_640_000_000_000);
export const StripeTestStateSchema=z.object({accountId:stripeTestId("acct"),customerId:stripeTestId("cus"),subscriptionId:stripeTestId("sub"),
 state:z.enum(["inactive","active","canceling","grace","past_due","canceled","blocked"]),plan:z.enum(["monthly","annual"]),
 paidThrough:stripeTime.nullable(),premiumUntil:stripeTime.nullable()}).strict().superRefine((v,ctx)=>{
 const eligible=["active","canceling","grace"].includes(v.state);
 if(eligible ? v.premiumUntil===null||v.paidThrough===null||v.premiumUntil>v.paidThrough+(v.state==="grace"?604800:0) : v.premiumUntil!==null)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"Invalid TEST decision"});
});
export type StripeTestState=z.infer<typeof StripeTestStateSchema>;
