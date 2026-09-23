import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPlaidWebhookVerifier } from "./webhook";
let pair: Awaited<ReturnType<typeof generateKeyPair>>, jwk: Record<string, unknown>;
const now = 1_800_000_000_000, kid = randomUUID();
const raw = Buffer.from(JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "opaque-sandbox-item", environment: "sandbox", extra: "must not leave verifier", error: { display_message: "must not leave verifier" } }));
beforeAll(async () => { pair = await generateKeyPair("ES256"); jwk = { ...await exportJWK(pair.publicKey), alg: "ES256", use: "sig", kid, created_at: now / 1000 - 3600, expired_at: null }; });
async function signed(body = raw, claims: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) {
  return new SignJWT({ iat: now / 1000, request_body_sha256: createHash("sha256").update(body).digest("hex"), ...claims })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid, ...headers }).sign(pair.privateKey);
}
function setup(key: unknown = jwk) {
  const provider = { getVerificationKey: vi.fn(async () => key) };
  return { provider, verify: createPlaidWebhookVerifier(provider, () => now) };
}
describe("Plaid Sandbox webhook signature boundary", () => {
  it("verifies the exact signed bytes and projects only opaque routing fields", async () => {
    const { verify } = setup();
    expect(await verify(raw, await signed())).toEqual({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "opaque-sandbox-item", environment: "sandbox" });
  });
  it("rejects modified whitespace/body before projection", async () => {
    const { verify } = setup(); await expect(verify(Buffer.concat([raw, Buffer.from(" ")]), await signed())).rejects.toThrow("could not be verified");
  });
  it.each([null, "", "x".repeat(8193), "not-a-token"])("rejects missing/malformed/oversized signatures without provider I/O", async token => {
    const { verify, provider } = setup(); await expect(verify(raw, token)).rejects.toThrow(); expect(provider.getVerificationKey).not.toHaveBeenCalled();
  });
  it.each([-301, 1])("rejects stale or future signed claims (%i seconds)", async delta => {
    await expect(setup().verify(raw, await signed(raw, { iat: now / 1000 + delta }))).rejects.toThrow();
  });
  it("rejects a wrong signing key", async () => {
    const wrong = await generateKeyPair("ES256"); const { verify } = setup({ ...jwk, ...await exportJWK(wrong.publicKey) });
    await expect(verify(raw, await signed())).rejects.toThrow();
  });
  it.each([{ expired_at: now / 1000 - 1 }, { created_at: now / 1000 + 1 }, { kid: randomUUID() }, { alg: "RS256" }])("rejects mismatched, expired or future provider keys", async change => {
    await expect(setup({ ...jwk, ...change }).verify(raw, await signed())).rejects.toThrow();
  });
  it.each([{ request_body_sha256: "short" }, { request_body_sha256: 123 }, { iat: 1.5 }])("rejects invalid signed claim shapes", async claims => {
    await expect(setup().verify(raw, await signed(raw, claims))).rejects.toThrow();
  });
  it("refuses Production and missing-environment payloads even with a valid signature", async () => {
    for (const environment of ["production", undefined]) {
      const body = Buffer.from(JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "opaque", environment }));
      await expect(setup().verify(body, await signed(body))).rejects.toThrow();
    }
  });
  it("does not trust caller-supplied JWK URLs", async () => {
    const { verify, provider } = setup(); await expect(verify(raw, await signed(raw, {}, { jku: "https://untrusted.example/keys" }))).rejects.toThrow(); expect(provider.getVerificationKey).not.toHaveBeenCalled();
  });
  it("coalesces concurrent reads and caches only bounded verification keys", async () => {
    const { verify, provider } = setup(); const token = await signed(); await Promise.all([verify(raw, token), verify(raw, token)]); await verify(raw, token);
    expect(provider.getVerificationKey).toHaveBeenCalledTimes(1);
  });
  it("sanitizes provider failures without retaining their content", async () => {
    const verify = createPlaidWebhookVerifier({ getVerificationKey: async () => { throw new Error("private provider secret"); } }, () => now);
    try { await verify(raw, await signed()); throw new Error("expected refusal"); } catch (e) { expect(String(e)).not.toContain("private provider secret"); expect(e).not.toHaveProperty("cause"); }
  });
  it("refuses unbounded bodies before key lookup", async () => {
    const { verify, provider } = setup(); await expect(verify(new Uint8Array(131073), await signed())).rejects.toThrow(); expect(provider.getVerificationKey).not.toHaveBeenCalled();
  });
});
