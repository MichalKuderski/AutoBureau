import { createPasswordPolicy, type PasswordVerdict } from "./password-policy";

/** The only public breach-range service. Only a 5-character SHA-1 prefix ever reaches it. */
export const BREACH_RANGE_ORIGIN = "https://api.pwnedpasswords.com";

/**
 * Where breach-range lookups go. Hosted and any unrecognized runtime use the public
 * k-anonymity service. A synthetic loopback configuration (the local account mount, or a
 * test run against a loopback fake provider) is served by that provider's `/range/`
 * fixture instead, so tests and local QA never depend on network egress. Nothing here can
 * disable the check: an unreachable fixture is "unavailable", which refuses.
 */
export function breachRangeOrigin(env: Readonly<Record<string, string | undefined>>, apiUrl: string): string {
  try {
    const api = new URL(apiUrl);
    const loopback = api.protocol === "http:" && api.hostname === "127.0.0.1" && !api.search && !api.hash;
    const synthetic = env.LOCAL_ACCOUNT_ROUTES === "synthetic-only" || env.NODE_ENV === "test";
    if (loopback && synthetic && !env.VERCEL && !env.AWS_EXECUTION_ENV && env.NODE_ENV !== "production") return api.origin; // same resolution as the local mount's fixture: `/range/…` at the provider origin
  } catch { /* an unparseable provider URL never selects the fixture */ }
  return BREACH_RANGE_ORIGIN;
}

/**
 * The authoritative policy for every route that creates or changes a password: 8–128
 * characters, zxcvbn ≥ 3, and a k-anonymity breach lookup with a bounded deadline. The
 * verdict is "unavailable" when the lookup cannot complete, and callers must refuse on it.
 */
export function passwordPolicyFor(env: Readonly<Record<string, string | undefined>>, apiUrl: string): (password: string) => Promise<PasswordVerdict> {
  const origin = breachRangeOrigin(env, apiUrl);
  if (origin === BREACH_RANGE_ORIGIN) return createPasswordPolicy();
  return createPasswordPolicy(async (input, init) => {
    const u = new URL(String(input));
    if (u.origin !== BREACH_RANGE_ORIGIN || !/^\/range\/[A-F0-9]{5}$/.test(u.pathname)) throw new Error("Breach fixture refused");
    return fetch(`${origin}${u.pathname}`, init);
  });
}

/** User-facing wording for a refusal. Never echoes the password or says which check failed beyond this. */
export const PASSWORD_REFUSAL = {
  weak: "Choose a longer, less predictable password — a few unrelated words works well.",
  breached: "That password appears in known data breaches. Choose a different one.",
  unavailable: "We couldn't check that password just now. Nothing was changed; try again in a moment.",
} as const satisfies Record<Exclude<PasswordVerdict, "allowed">, string>;
