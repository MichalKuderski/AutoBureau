/** Preliminary TEST-mode catalog checks, not billing activation or entitlements.
 * Price/product IDs must come from a server-owned catalog, never request metadata.
 * Amounts are integer USD cents. Taxes, discounts and final invoice amounts are not
 * inferred from these base prices. Public pricing and caps remain provisional.
 */
const PLANS = Object.freeze({
  monthly: Object.freeze({ amountCents: 1200, interval: "month" as const }),
  annual: Object.freeze({ amountCents: 9900, interval: "year" as const }),
});
export type PellumBillingPlan = keyof typeof PLANS;
export interface StripeTestPriceBinding { plan: PellumBillingPlan; priceId: string; productId: string }
export class StripeTestPolicyError extends Error {
  override name = "StripeTestPolicyError";
  constructor() { super("Test billing evidence could not be verified"); }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validateStripeTestPrice(price: unknown, binding: StripeTestPriceBinding) {
  try {
    if (!Object.prototype.hasOwnProperty.call(PLANS, binding.plan)
      || !/^price_[A-Za-z0-9]{1,240}$/.test(binding.priceId)
      || !/^prod_[A-Za-z0-9]{1,240}$/.test(binding.productId)) throw new StripeTestPolicyError();
    const plan = PLANS[binding.plan];
    if (!record(price) || price.object !== "price" || price.id !== binding.priceId
      || price.livemode !== false || price.active !== true || price.type !== "recurring"
      || price.currency !== "usd" || price.unit_amount !== plan.amountCents
      || price.billing_scheme !== "per_unit" || price.transform_quantity != null
      || price.custom_unit_amount != null || !record(price.recurring)
      || price.recurring.interval !== plan.interval || price.recurring.interval_count !== 1
      || price.recurring.usage_type !== "licensed") throw new StripeTestPolicyError();
    const product = record(price.product) ? price.product.id : price.product;
    if (product !== binding.productId || record(price.product) && (price.product.livemode !== false || price.product.deleted === true)) throw new StripeTestPolicyError();
    return Object.freeze({ plan: binding.plan, priceId: binding.priceId, productId: binding.productId,
      currency: "usd" as const, amountCents: plan.amountCents, interval: plan.interval, livemode: false as const });
  } catch { throw new StripeTestPolicyError(); }
}
