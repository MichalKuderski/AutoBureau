import { describe, expect, it } from "vitest";
import { signInternalRequest, verifyInternalRequest, internalSecretOk } from "./internal-signature.js";

const key = "k".repeat(43), path = "/v1/stripe-test/internal/checkout-session", body = new TextEncoder().encode('{"a":1}'), t = 1_790_000_000;

describe("web → billing internal request signature", () => {
  it("is a fixed, reproducible HMAC so both runtimes agree byte for byte", () => {
    // Independently computed (Python hmac/hashlib) over `1790000000.POST.<path>.sha256(body)`.
    expect(signInternalRequest(key, "POST", path, body, t)).toBe("v1=73ae91330b0d4b5e401bfa0cddf032430c6829a5908a5c895b4e92a9b0fdd89e");
    expect(verifyInternalRequest(key, "POST", path, body, String(t), signInternalRequest(key, "POST", path, body, t), t + 30)).toBe(true);
  });
  it.each([
    ["another secret", { k: "j".repeat(43) }], ["another path", { p: "/v1/stripe-test/internal/portal" }], ["changed body", { b: new TextEncoder().encode('{"a":2}') }],
    ["stale timestamp", { now: t + 61 }], ["future timestamp", { now: t - 61 }], ["GET", { m: "GET" }],
  ])("refuses %s", (_, change: { k?: string; p?: string; b?: Uint8Array; now?: number; m?: string }) => {
    const sig = signInternalRequest(key, "POST", path, body, t);
    expect(verifyInternalRequest(change.k ?? key, change.m ?? "POST", change.p ?? path, change.b ?? body, String(t), sig, change.now ?? t)).toBe(false);
  });
  it.each([null, "", "v1=", "v2=" + "a".repeat(64), "v1=" + "A".repeat(64), "v1=" + "a".repeat(63)])("refuses malformed signature %s", sig => {
    expect(verifyInternalRequest(key, "POST", path, body, String(t), sig, t)).toBe(false);
  });
  it.each([null, "", "1.5", "-1", "9".repeat(13)])("refuses malformed timestamp %s", ts => {
    expect(verifyInternalRequest(key, "POST", path, body, ts, signInternalRequest(key, "POST", path, body, t), t)).toBe(false);
  });
  it("refuses weak secrets, foreign paths and oversized bodies at both ends", () => {
    for (const s of ["short", "k".repeat(42), "k".repeat(129), "k".repeat(42) + "!"]) expect(internalSecretOk(s)).toBe(false);
    expect(() => signInternalRequest("short", "POST", path, body, t)).toThrow();
    expect(() => signInternalRequest(key, "POST", "/v1/households/x", body, t)).toThrow();
    expect(() => signInternalRequest(key, "POST", path, new Uint8Array(8193), t)).toThrow();
    expect(verifyInternalRequest(key, "POST", path, new Uint8Array(8193), String(t), "v1=" + "a".repeat(64), t)).toBe(false);
  });
});
