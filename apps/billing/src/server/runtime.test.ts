import { afterEach, describe, expect, it } from "vitest";
import { billingRuntime, resetBillingRuntime, serve } from "./runtime";

afterEach(() => resetBillingRuntime());
describe("billing app mount", () => {
  it("fails closed outside a complete hosted TEST configuration", async () => {
    for (const env of [{}, { BILLING_RUNTIME: "stripe-test" }, { VERCEL: "1", NODE_ENV: "production", BILLING_RUNTIME: "stripe-test", BILLING_TEST_DISABLED: "1" }]) {
      resetBillingRuntime();
      expect(billingRuntime(env)).toBeNull();
    }
    const r = await serve(async () => new Response("reached"));
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("reached");
  });
});
