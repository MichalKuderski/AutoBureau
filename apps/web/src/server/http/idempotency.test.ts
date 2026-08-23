// @vitest-environment node
import { describe, expect, it } from "vitest";
import { idempotencyFingerprintInput } from "@autobureau/contracts";
import { payloadSha256Hex } from "@autobureau/contracts/node";
import { fingerprintOf } from "./idempotency";

/**
 * The fingerprint, isolated from the database.
 *
 * The storage machinery is proved end to end against real Postgres in
 * `idempotency.integration.test.ts`; this file covers the one pure function, whose job is
 * to decide when two requests are the same request. Its failure modes are silent — a
 * fingerprint that collides replays the wrong answer, and one that differs when it should
 * not turns a retry into a 409 — so they are worth pinning without a server.
 */

const base = {
  householdId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  method: "POST",
  path: "/v1/items",
  rawBody: '{"name":"Ada","kind":"passport"}',
};

describe("fingerprintOf", () => {
  it("produces a sha256 hex digest", () => {
    expect(fingerprintOf(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the contract's own hash, not a second scheme", () => {
    // If this drifts, `packages/contracts` and the server have two answers to "is this the
    // same request", which is exactly what ADR-011 put the helper in contracts to prevent.
    expect(fingerprintOf(base)).toBe(
      payloadSha256Hex(
        idempotencyFingerprintInput({
          householdId: base.householdId,
          userId: base.userId,
          method: base.method,
          path: base.path,
          body: { name: "Ada", kind: "passport" },
        }),
      ),
    );
  });

  it("ignores JSON key order", () => {
    expect(fingerprintOf({ ...base, rawBody: '{"kind":"passport","name":"Ada"}' })).toBe(
      fingerprintOf(base),
    );
  });

  it("ignores insignificant whitespace", () => {
    expect(fingerprintOf({ ...base, rawBody: '{ "name" : "Ada", "kind":  "passport" }' })).toBe(
      fingerprintOf(base),
    );
  });

  it("separates households", () => {
    expect(fingerprintOf({ ...base, householdId: "33333333-3333-4333-8333-333333333333" })).not.toBe(
      fingerprintOf(base),
    );
  });

  it("separates principals", () => {
    expect(fingerprintOf({ ...base, userId: "44444444-4444-4444-8444-444444444444" })).not.toBe(
      fingerprintOf(base),
    );
  });

  it("separates paths, query strings included", () => {
    expect(fingerprintOf({ ...base, path: "/v1/obligations" })).not.toBe(fingerprintOf(base));
    expect(fingerprintOf({ ...base, path: "/v1/items?dry_run=1" })).not.toBe(fingerprintOf(base));
  });

  it("separates methods", () => {
    expect(fingerprintOf({ ...base, method: "PUT" })).not.toBe(fingerprintOf(base));
  });

  it("separates bodies", () => {
    expect(fingerprintOf({ ...base, rawBody: '{"name":"Grace","kind":"passport"}' })).not.toBe(
      fingerprintOf(base),
    );
  });

  it("treats an empty body as null rather than throwing", () => {
    expect(fingerprintOf({ ...base, rawBody: "" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("survives a body the canonical profile refuses, and stays deterministic", () => {
    // Money is integer cents by contract, so a float is a client bug — but the
    // fingerprint is computed before any schema runs, and turning that 400 into a 500
    // would be the boundary's fault rather than the client's.
    const float = { ...base, rawBody: '{"amount":12.5}' };
    expect(() => fingerprintOf(float)).not.toThrow();
    expect(fingerprintOf(float)).toBe(fingerprintOf(float));
    expect(fingerprintOf(float)).not.toBe(fingerprintOf(base));
  });

  it("survives a body that is not JSON at all", () => {
    const junk = { ...base, rawBody: "<xml/>" };
    expect(() => fingerprintOf(junk)).not.toThrow();
    expect(fingerprintOf(junk)).toBe(fingerprintOf(junk));
  });
});
