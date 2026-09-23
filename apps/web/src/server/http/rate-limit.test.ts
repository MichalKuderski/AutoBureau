// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAGIC_LINK_POLICIES,
  SIGN_IN_CLEAR_ON_SUCCESS,
  SIGN_IN_POLICIES,
  bucketOf,
  clientIpFrom,
  normalizeIdentifier,
} from "./rate-limit";

/**
 * The pure half of the limiter (blueprint P1-08, ADR-013 D3/D5/D6).
 *
 * Scope is deliberately narrow: counting, atomicity, window rollover, fail-open and the
 * HTTP shape all need a real database and a real route, and live in
 * `rate-limit.integration.test.ts`. What is provable without one is subject derivation —
 * which is where the two silent-evasion bugs live (a limit dodged by pressing shift, and a
 * bucket key chosen by the attacker) — plus the policy table's own shape.
 */

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://app.autobureau.com/v1/auth/sign-in", { method: "POST", headers });
}

describe("normalizeIdentifier — the limit must not be evadable by typing differently", () => {
  it("folds case", () => {
    expect(normalizeIdentifier("Ada@Example.test")).toBe("ada@example.test");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIdentifier("  ada@example.test\t")).toBe("ada@example.test");
  });

  it("maps every casing/padding variant of one address to ONE bucket", () => {
    const variants = [
      "ada@example.test",
      "ADA@EXAMPLE.TEST",
      "Ada@Example.Test",
      " ada@example.test ",
      "\nada@example.test\n",
    ];
    const buckets = new Set(
      variants.map((v) => bucketOf("sign_in.identifier", normalizeIdentifier(v))),
    );
    // If this is ever >1, the per-identifier limit can be walked around with the shift key.
    expect(buckets.size).toBe(1);
  });

  it("is idempotent", () => {
    const once = normalizeIdentifier(" Ada@Example.test ");
    expect(normalizeIdentifier(once)).toBe(once);
  });

  it("does NOT strip dots or plus-tags — those are different accounts to the provider", () => {
    // Deliberate: merging them would rate-limit an address the provider considers separate,
    // which is a correctness bug pointing the wrong way (ADR-013 D3).
    expect(normalizeIdentifier("a.b@example.test")).not.toBe(normalizeIdentifier("ab@example.test"));
    expect(normalizeIdentifier("ada+x@example.test")).not.toBe(
      normalizeIdentifier("ada@example.test"),
    );
  });
});

describe("clientIpFrom — right-most only (ADR-013 D5)", () => {
  it("returns null when the header is absent", () => {
    expect(clientIpFrom(requestWith({}))).toBeNull();
  });

  it("returns the single value under a single-proxy topology", () => {
    expect(clientIpFrom(requestWith({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("takes the RIGHT-most value, not the left-most", () => {
    expect(clientIpFrom(requestWith({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("SECURITY: a client-supplied prefix cannot choose the bucket key", () => {
    // The attack a left-most rule enables: the caller sends its own header, the edge appends
    // the real peer to the right, and a left-most reader trusts the attacker's string —
    // letting one host spread across unlimited synthetic IP buckets.
    const spoofed = clientIpFrom(
      requestWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.7" }),
    );
    expect(spoofed).toBe("203.0.113.7");
    expect(spoofed).not.toBe("1.2.3.4");
  });

  it("tolerates whitespace around values", () => {
    expect(clientIpFrom(requestWith({ "x-forwarded-for": "10.0.0.1 ,  203.0.113.7  " }))).toBe(
      "203.0.113.7",
    );
  });

  it("accepts IPv6", () => {
    expect(clientIpFrom(requestWith({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it.each([
    ["empty header", ""],
    ["not an address", "not-an-ip"],
    ["trailing comma leaves an empty last value", "203.0.113.7,"],
    ["a port suffix is not an address", "203.0.113.7:443"],
    ["a bracketed IPv6 with port is not an address", "[2001:db8::1]:443"],
    ["an obfuscated identifier (RFC 7239) is not an address", "_hidden"],
    ["a hostname is not an address", "proxy.internal"],
  ])("returns null when the right-most value does not parse: %s", (_label, value) => {
    // Strictness is the decision: a value we cannot parse is treated as ABSENT, which skips
    // the dimension. Guessing at it would key the bucket on something arbitrary.
    expect(clientIpFrom(requestWith({ "x-forwarded-for": value }))).toBeNull();
  });

  it("reads only x-forwarded-for — never Forwarded, x-real-ip, or x-vercel-*", () => {
    const request = requestWith({
      forwarded: "for=203.0.113.9",
      "x-real-ip": "203.0.113.10",
      "x-vercel-forwarded-for": "203.0.113.11",
    });
    // None of these is trusted. Broadening the set is how a limiter quietly becomes
    // advisory, so the absence of x-forwarded-for means no IP at all.
    expect(clientIpFrom(request)).toBeNull();
  });
});

describe("bucketOf — keys are separated so counters cannot be merged or collided", () => {
  it("is deterministic", () => {
    expect(bucketOf("sign_in.identifier", "ada@example.test")).toBe(
      bucketOf("sign_in.identifier", "ada@example.test"),
    );
  });

  it("is a 64-character hex digest, matching the CHAR(64) column", () => {
    expect(bucketOf("sign_in.identifier", "ada@example.test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is domain-separated by policy: one address, different policies, different buckets", () => {
    // Sharing would let a magic-link request consume a sign-in allowance (ADR-013 D6).
    expect(bucketOf("sign_in.identifier", "ada@example.test")).not.toBe(
      bucketOf("magic_link.identifier", "ada@example.test"),
    );
  });

  it("separates distinct subjects", () => {
    expect(bucketOf("sign_in.identifier", "ada@example.test")).not.toBe(
      bucketOf("sign_in.identifier", "bob@example.test"),
    );
  });

  it("SECURITY: the separator makes composition unambiguous", () => {
    // With a joinable separator, ("a", "bc") and ("ab", "c") would hash identically and two
    // unrelated subjects would share a counter. NUL cannot occur in an email or an IP.
    expect(bucketOf("sign_in.identifier_ip", "a\u0000bc")).not.toBe(
      bucketOf("sign_in.identifier_ip", "ab\u0000c"),
    );
  });

  it("does not contain the subject in recoverable form", () => {
    // Not a secrecy claim — ADR-013 D3 is explicit that an unsalted digest of an email is
    // reversible with a wordlist. What is asserted is only that the table never holds the
    // address as plaintext, which is what the digest is actually for.
    const bucket = bucketOf("sign_in.identifier", "ada@example.test");
    expect(bucket).not.toContain("ada");
    expect(bucket).not.toContain("example.test");
  });
});

describe("policy sets — the shape ADR-013 D6/D8 fixes", () => {
  it("sign-in carries all three dimensions", () => {
    expect([...SIGN_IN_POLICIES]).toEqual([
      "sign_in.identifier_ip",
      "sign_in.identifier",
      "sign_in.ip",
    ]);
  });

  it("magic-link carries identifier and IP", () => {
    expect([...MAGIC_LINK_POLICIES]).toEqual(["magic_link.identifier", "magic_link.ip"]);
  });

  it("SECURITY: a successful sign-in never clears the shared per-IP bucket", () => {
    // Clearing it would refund an attacker's budget every time a neighbour behind the same
    // CGNAT address signed in successfully.
    expect([...SIGN_IN_CLEAR_ON_SUCCESS]).not.toContain("sign_in.ip");
    expect([...SIGN_IN_CLEAR_ON_SUCCESS]).toEqual([
      "sign_in.identifier_ip",
      "sign_in.identifier",
    ]);
  });

  it("clears only policies that sign-in actually enforces", () => {
    for (const policy of SIGN_IN_CLEAR_ON_SUCCESS) {
      expect(SIGN_IN_POLICIES).toContain(policy);
    }
  });

  it("the two endpoints share no policy", () => {
    const overlap = SIGN_IN_POLICIES.filter((p) => MAGIC_LINK_POLICIES.includes(p));
    expect(overlap).toEqual([]);
  });
});
