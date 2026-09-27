// @vitest-environment node
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createStripeTestNoticeVerifier } from "./stripe-test-notice.js";
import { StripeTestPolicyError } from "./stripe-test-policy.js";

// Official SDK's offline helpers only. No client instance, API key, endpoint or
// network call exists in this fixture. These are not delivered provider events.
const secret = "whsec_synthetic_conformance_only";
const apiVersion = "2026-02-25.clover";
const event = { id: "evt_Synthetic", object: "event", livemode: false, api_version: apiVersion,
  created: 1_790_000_000, type: "invoice.paid", data: { object: { id: "in_Synthetic", metadata: { private: "PRIVATE_CANARY" } } } };
const verify = createStripeTestNoticeVerifier(
  (bytes, signature, signingSecret, tolerance) => Stripe.webhooks.constructEvent(Buffer.from(bytes), signature, signingSecret, tolerance),
  { signingSecret: secret, apiVersion, mode: "test" },
);
function signed(value: unknown = event, timestamp = Math.floor(Date.now() / 1000), signingSecret = secret) {
  const payload = JSON.stringify(value, null, 2);
  return { bytes: Buffer.from(payload), signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret, timestamp }) };
}

describe("official Stripe SDK signature conformance with synthetic TEST events", () => {
  it("accepts exact signed Buffer bytes and projects only reconciliation data", () => {
    const { bytes, signature } = signed();
    expect(verify(bytes, signature)).toEqual({ kind: "reconcile", eventId: "evt_Synthetic", eventType: "invoice.paid", objectId: "in_Synthetic", created: event.created, customerId: null });
    expect(JSON.stringify(verify(bytes, signature))).not.toContain("PRIVATE_CANARY");
  });
  it("accepts a Uint8Array with the same exact bytes", () => {
    const { bytes, signature } = signed();
    expect(verify(new Uint8Array(bytes), signature).kind).toBe("reconcile");
  });
  it("rejects payload tampering", () => {
    const { bytes, signature } = signed();
    const changed = Buffer.from(bytes.toString().replace("in_Synthetic", "in_Attacker"));
    expect(() => verify(changed, signature)).toThrow(StripeTestPolicyError);
  });
  it("rejects parse-and-reserialize before verification even for equivalent JSON", () => {
    const { bytes, signature } = signed();
    const changed = Buffer.from(JSON.stringify(JSON.parse(bytes.toString())));
    expect(() => verify(changed, signature)).toThrow(StripeTestPolicyError);
  });
  it("rejects a signature made with another endpoint secret", () => {
    const { bytes, signature } = signed(event, Math.floor(Date.now() / 1000), "whsec_other_synthetic_endpoint");
    expect(() => verify(bytes, signature)).toThrow(StripeTestPolicyError);
  });
  it("rejects a cryptographically valid signature outside the five-minute tolerance", () => {
    const { bytes, signature } = signed(event, Math.floor(Date.now() / 1000) - 600);
    expect(() => verify(bytes, signature)).toThrow(StripeTestPolicyError);
  });
  it.each([null, "", "t=garbage,v1=garbage", "t=1790000000,v0=wrong"])("rejects absent or malformed signature %s", signature => {
    expect(() => verify(signed().bytes, signature)).toThrow(StripeTestPolicyError);
  });
  it.each([{ livemode: true }, { api_version: "2020-01-01" }, { account: "acct_Connected" }, { context: "acct_Context" }])(
    "rejects out-of-scope events after authentic SDK verification", change => {
      const { bytes, signature } = signed({ ...event, ...change });
      expect(() => verify(bytes, signature)).toThrow(StripeTestPolicyError);
    },
  );
  it("does not treat a valid replay as domain completion or paid entitlement", () => {
    const { bytes, signature } = signed();
    expect(verify(bytes, signature)).toEqual(verify(bytes, signature));
    expect(verify(bytes, signature)).not.toHaveProperty("entitlement");
  });
  it("projects only an exact TEST customer ID as the routing key, expanded or not", () => {
    for (const customer of ["cus_Route1", { id: "cus_Route1", email: "PRIVATE_CANARY" }]) {
      const { bytes, signature } = signed({ ...event, data: { object: { ...event.data.object, customer } } });
      const projected = verify(bytes, signature);
      expect(projected).toMatchObject({ kind: "reconcile", customerId: "cus_Route1" });
      expect(JSON.stringify(projected)).not.toContain("PRIVATE_CANARY");
    }
    for (const customer of ["cus_", "acct_Route1", "cus_bad id", 7]) {
      const { bytes, signature } = signed({ ...event, data: { object: { ...event.data.object, customer } } });
      expect(verify(bytes, signature)).toMatchObject({ kind: "reconcile", customerId: null });
    }
  });
  it("never turns a checkout completion into a notice: binding comes only from the owner's verified return", () => {
    const { bytes, signature } = signed({ ...event, type: "checkout.session.completed", data: { object: { id: "cs_test_Synthetic", customer: "cus_Route1" } } });
    expect(verify(bytes, signature)).toEqual({ kind: "ignored", eventId: event.id });
  });
  it("ignores authentic unrelated TEST events", () => {
    const { bytes, signature } = signed({ ...event, type: "customer.created" });
    expect(verify(bytes, signature)).toEqual({ kind: "ignored", eventId: event.id });
  });
});
