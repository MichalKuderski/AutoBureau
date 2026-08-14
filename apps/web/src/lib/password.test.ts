import { describe, expect, it } from "vitest";
import { assessPassword, isPlausibleEmail } from "./password";

/**
 * The property that matters is the direction of the incentive: this meter must
 * reward length and must not reward punctuation-stuffing, or it will teach the
 * exact habit NIST 800-63B told us to stop teaching.
 */

describe("assessPassword", () => {
  it("rates a long passphrase above a short complex password", () => {
    const passphrase = assessPassword("otter harbour lantern");
    const gauntlet = assessPassword("P@ssw0r!");
    expect(passphrase.score).toBeGreaterThan(gauntlet.score);
    expect(passphrase.acceptable).toBe(true);
  });

  it("refuses passwords that are on every attacker's first list", () => {
    for (const common of ["password123", "QWERTYUIOP", "iloveyou"]) {
      const result = assessPassword(common);
      expect(result.acceptable).toBe(false);
      expect(result.score).toBe(0);
    }
  });

  it("refuses a password built from the email address", () => {
    const result = assessPassword("danareyes-2026!", "danareyes@example.com");
    expect(result.acceptable).toBe(false);
    expect(result.hint).toMatch(/email/i);
  });

  it("does not count runs and sequences as strength", () => {
    expect(assessPassword("aaaaaaaaaaaaaaaa").acceptable).toBe(false);
    expect(assessPassword("abcdefghijklmnop").acceptable).toBe(false);
  });

  it("asks for length before anything else when the password is short", () => {
    const result = assessPassword("Ab3$x");
    expect(result.label).toBe("Too short");
    expect(result.hint).toMatch(/at least 8/);
  });

  it("never scolds — every hint says what to do next", () => {
    for (const candidate of ["", "short", "password", "otter harbour lantern moth"]) {
      const { hint } = assessPassword(candidate);
      expect(hint).toBeTruthy();
      expect(hint).not.toMatch(/invalid|error|wrong/i);
    }
  });
});

describe("isPlausibleEmail", () => {
  it("accepts the addresses real people have", () => {
    for (const address of [
      "dana@example.com",
      "dana.reyes+bills@example.co.uk",
      "d@sub.domain.org",
    ]) {
      expect(isPlausibleEmail(address)).toBe(true);
    }
  });

  it("rejects only what could not possibly be delivered", () => {
    for (const address of ["dana", "dana@", "@example.com", "dana@example", "a b@c.com"]) {
      expect(isPlausibleEmail(address)).toBe(false);
    }
  });
});
