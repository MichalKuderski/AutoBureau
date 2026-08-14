/**
 * Client-side password guidance.
 *
 * This is a *hint*, not the gate. The binding checks are server-side at set time
 * (zxcvbn ≥ 3 plus a haveibeenpwned k-anonymity lookup, doc 06 §1) — a breach corpus
 * cannot live in a browser bundle, and a client that claimed otherwise would be
 * lying about the one thing users need to trust here.
 *
 * What it does do is steer toward length rather than punctuation. NIST 800-63B
 * abandoned composition rules for good reason: they produce `P@ssw0rd1!`, which is
 * short, memorable to a cracker, and hostile to the 55-year-old caregiver this
 * product is designed for. Length dominates the score; variety is a small bonus.
 */

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordAssessment {
  score: PasswordScore;
  label: string;
  /** Always actionable, never a scold. */
  hint: string;
  /** Below this the sign-up form won't submit; the server may still refuse above it. */
  acceptable: boolean;
}

/**
 * Passwords so common that any strength arithmetic on them is theatre. A short list
 * on purpose — the real corpus is a server lookup, and shipping ten thousand strings
 * to a phone to catch what one HTTP call catches better is not a trade worth making.
 */
const TOO_COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwertyuiop",
  "letmein",
  "iloveyou",
  "welcome",
  "admin",
  "abc123",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "autobureau",
]);

const MIN_LENGTH = 8;

function hasRun(value: string): boolean {
  // "aaaa" or "1111" — length that carries no entropy.
  return /(.)\1{3,}/.test(value);
}

function hasSequence(value: string): boolean {
  const lower = value.toLowerCase();
  const ladders = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i + 4 <= ladders.length; i += 1) {
    const run = ladders.slice(i, i + 4);
    if (lower.includes(run)) return true;
    if (lower.includes([...run].reverse().join(""))) return true;
  }
  return false;
}

export function assessPassword(password: string, email = ""): PasswordAssessment {
  const value = password.trim();

  if (value.length === 0) {
    return {
      score: 0,
      label: "",
      hint: "A few unrelated words work better than one clever word.",
      acceptable: false,
    };
  }

  if (value.length < MIN_LENGTH) {
    return {
      score: 0,
      label: "Too short",
      hint: `Use at least ${MIN_LENGTH} characters — length matters more than symbols.`,
      acceptable: false,
    };
  }

  const lower = value.toLowerCase();
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";

  if (TOO_COMMON.has(lower)) {
    return {
      score: 0,
      label: "Too easy to guess",
      hint: "This one is on every attacker's first list. Try a few unrelated words.",
      acceptable: false,
    };
  }

  if (localPart.length >= 3 && lower.includes(localPart)) {
    return {
      score: 0,
      label: "Too easy to guess",
      hint: "It contains your email address, which is the first thing anyone would try.",
      acceptable: false,
    };
  }

  if (hasRun(value) || hasSequence(value)) {
    return {
      score: 1,
      label: "Weak",
      hint: "Repeated characters and runs like 'abcd' add length but not strength.",
      acceptable: false,
    };
  }

  let score = 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes >= 3) score += 1;

  const capped = Math.min(score, 4) as PasswordScore;

  const LABELS: Record<PasswordScore, string> = {
    0: "Too easy to guess",
    1: "Weak",
    2: "Reasonable",
    3: "Strong",
    4: "Very strong",
  };

  return {
    score: capped,
    label: LABELS[capped],
    hint:
      capped >= 3
        ? "We also check new passwords against known breaches when you save."
        : "Adding another word is the cheapest way to make this much harder to crack.",
    acceptable: capped >= 2,
  };
}

/**
 * Deliberately permissive. The authoritative test of an address is whether the
 * verification email arrives; rejecting valid-but-unusual addresses at the form is a
 * way to lose real users to a regex.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}
