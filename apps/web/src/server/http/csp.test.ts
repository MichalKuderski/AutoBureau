// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NONCE_HEADER, buildCsp, createNonce } from "./csp";

/**
 * ADR-010 — the policy, and the nonce that makes it more than a claim.
 *
 * The assertions that matter here are negative ones. A CSP that *has* a nonce source is
 * easy to produce and proves nothing; the questions worth pinning are whether
 * `'unsafe-inline'` is really gone from `script-src`, whether the nonce is actually
 * unpredictable, and whether every directive that was protecting something before is
 * still there afterwards.
 */

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  if (found === undefined) throw new Error(`no '${name}' directive in: ${csp}`);
  return found;
}

describe("Test D · script-src carries a nonce and no 'unsafe-inline'", () => {
  it("names the nonce it was given", () => {
    expect(directive(buildCsp({ nonce: NONCE }), "script-src")).toContain(`'nonce-${NONCE}'`);
  });

  it("does not contain 'unsafe-inline' in production", () => {
    expect(directive(buildCsp({ nonce: NONCE }), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("does not contain 'unsafe-inline' in development either", () => {
    // A nonce and 'unsafe-inline' together is not a compatibility fallback: browsers that
    // understand nonces ignore 'unsafe-inline' when one is present. Keeping it would
    // protect nothing and hide violations until production.
    const csp = directive(buildCsp({ nonce: NONCE, allowEval: true }), "script-src");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("permits 'unsafe-eval' only when development explicitly asks for it", () => {
    expect(buildCsp({ nonce: NONCE })).not.toContain("'unsafe-eval'");
    expect(directive(buildCsp({ nonce: NONCE, allowEval: true }), "script-src")).toContain(
      "'unsafe-eval'",
    );
  });

  it("still allows same-origin script files, which are served under 'self'", () => {
    expect(directive(buildCsp({ nonce: NONCE }), "script-src")).toContain("'self'");
  });
});

describe("Test F · every directive that was there before is still there", () => {
  // The policy shipped before ADR-010, verbatim, minus the script-src line this ADR
  // changed. If a future edit quietly drops one of these, that is a weakened policy
  // wearing the same shape, and this is the test that says so.
  const PRESERVED = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ] as const;

  it.each(PRESERVED)("still emits %s", (expected) => {
    expect(buildCsp({ nonce: NONCE }).split("; ")).toContain(expected);
  });

  it("emits exactly the ten directives and no wildcard anywhere", () => {
    const csp = buildCsp({ nonce: NONCE });
    expect(csp.split(";")).toHaveLength(10);
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("http:");
    expect(csp).not.toContain("https:");
  });

  it("keeps style-src 'unsafe-inline' — stated honestly rather than quietly dropped", () => {
    // ADR-010 deliberately does not remove this. The test exists so that removing it is a
    // decision someone makes on purpose, with a live response to back it up.
    expect(directive(buildCsp({ nonce: NONCE }), "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });
});

describe("Test B · the nonce is unpredictable and never reused", () => {
  it("returns a different value on every call", () => {
    const seen = new Set(Array.from({ length: 512 }, () => createNonce()));
    expect(seen.size).toBe(512);
  });

  it("carries 128 bits of entropy, base64-encoded", () => {
    const nonce = createNonce();
    expect(nonce).toHaveLength(24);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("matches the grammar Next's own nonce extractor accepts", () => {
    // Mirrors CSP_NONCE_SOURCE_REGEX in next/dist/server/app-render/get-script-nonce-from-header.
    // A nonce Next cannot parse means Next cannot stamp its own streamed scripts, and the
    // page breaks in a way no unit test of ours would otherwise notice.
    for (let i = 0; i < 256; i += 1) {
      expect(`'nonce-${createNonce()}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/);
    }
  });

  it("is not derived from anything about the request", () => {
    // Two nonces minted in the same millisecond must still differ; a timestamp- or
    // id-derived nonce is guessable, and a guessable nonce is 'unsafe-inline' with
    // better manners.
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
  });
});

describe("the nonce request header", () => {
  it("is the name the root layout reads", () => {
    expect(NONCE_HEADER).toBe("x-nonce");
  });
});
