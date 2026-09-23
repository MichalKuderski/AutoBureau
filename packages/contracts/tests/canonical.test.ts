import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { canonicalize, payloadSha256Hex, CanonicalizationError } from "../src/canonical.js";

type Vector = { name: string; input: unknown; canonical: string; sha256?: string };

const vectorsPath = fileURLToPath(new URL("../test-vectors/canonical.json", import.meta.url));
const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, "utf8"));

describe("canonicalize — RFC 8785 profile", () => {
  it("has vectors to test against", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(8);
  });

  for (const v of vectors) {
    it(`vector: ${v.name}`, () => {
      expect(canonicalize(v.input)).toBe(v.canonical);
      if (v.sha256) {
        expect(payloadSha256Hex(v.input)).toBe(v.sha256);
      }
    });
  }

  it("sorts keys by UTF-16 code units regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, Z: 3 });
    const b = canonicalize({ Z: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"Z":3,"a":2,"b":1}');
  });

  it("normalizes -0 to 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("rejects floats — money is integer cents by contract", () => {
    expect(() => canonicalize({ amount: 12.5 })).toThrow(CanonicalizationError);
  });

  it("rejects NaN, Infinity, and unsafe integers", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError);
    expect(() => canonicalize(2 ** 53)).toThrow(CanonicalizationError);
  });

  it("rejects undefined values instead of silently dropping them", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(/undefined value at key "a"/);
  });

  it("rejects non-plain objects (Date, Map, class instances)", () => {
    expect(() => canonicalize(new Date())).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Map())).toThrow(CanonicalizationError);
    class X { y = 1; }
    expect(() => canonicalize(new X())).toThrow(CanonicalizationError);
  });

  it("accepts null-prototype objects", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o["k"] = "v";
    expect(canonicalize(o)).toBe('{"k":"v"}');
  });

  it("hash equals sha256 of the canonical string", () => {
    const payload = { kind: "send_email", to: "dmv@example.com", body: "Renewal enclosed", cents: 1200 };
    const expected = createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
    expect(payloadSha256Hex(payload)).toBe(expected);
  });

  it("is insensitive to key order but sensitive to any value change (approval-gate property)", () => {
    const approved = { action: "send_email", to: "x@y.com", subject: "Hi" };
    const reordered = { subject: "Hi", action: "send_email", to: "x@y.com" };
    const tampered = { action: "send_email", to: "attacker@y.com", subject: "Hi" };
    expect(payloadSha256Hex(approved)).toBe(payloadSha256Hex(reordered));
    expect(payloadSha256Hex(approved)).not.toBe(payloadSha256Hex(tampered));
  });
});
