import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Database, GlobalClient } from "@autobureau/db";
import { log } from "../observability";
import { problemResponse } from "./problem";

/**
 * Authentication rate limiting (blueprint P1-08; ADR-013 is the accepted design).
 *
 * WHAT THIS CLOSES
 * ----------------
 * `01-current-state-ground-truth.md` §S5: "Auth throttling is entirely delegated to
 * GoTrue." A provider `429` was already *handled* (`provider.ts:88`) and rendered; nothing
 * was ever *enforced* here. This is the enforcement — and, per ADR-013 D7, it will be the
 * first and only implemented control of doc 12 §1 T2, because MFA, breach-corpus checks and
 * new-device notices do not exist yet.
 *
 * WHY POSTGRES AND NOT REDIS: ADR-013 D1. Redis is in no dependency, no lockfile entry, and
 * no deployed environment. The atomic counter costs one statement here and would cost a new
 * vendor there.
 *
 * WHY IT CAN REACH THE DATABASE AT ALL: `Database.withGlobalTable` (ADR-013 D2). A sign-in
 * is counted before any token is verified, so there is no principal and no household — and
 * that method deliberately sets no GUC, which is what keeps this path unable to touch
 * tenant data even by mistake.
 *
 * THE ORDER MATTERS AND IS FIXED BY ADR-013 D9
 * --------------------------------------------
 * Inside a public auth handler: configuration → CSRF → schema validation → **this** →
 * provider call. CSRF stays ahead so a hostile page cannot burn a victim's allowance with
 * forged cross-site posts; schema validation stays ahead because the identifier does not
 * exist until the body parses, and because garbage should not be able to make the limiter
 * do work. The `/v1` boundary in `route.ts` is NOT touched: `/v1/auth/*` is ADR-011 D14's
 * documented exception and is not wrapped in `authenticated()` at all.
 *
 * THIS IS NOT AUTHORIZATION. It answers "has this bucket had too many attempts", never
 * "may this principal do this". It runs before any identity exists, it produces `429` and
 * never `401`/`403`, and no capability check consults it.
 */

/* ─────────────────────────────── policies ─────────────────────────────── */

export type PolicyName =
  | "sign_in.identifier_ip"
  | "sign_in.identifier"
  | "sign_in.ip"
  | "magic_link.identifier"
  | "magic_link.ip"
  | "sign_up.identifier"
  | "sign_up.ip";

/** Which subject a policy counts against. `identifier` here always means the email. */
type Dimension = "identifier" | "identifier_ip" | "ip";

interface Policy {
  readonly dimension: Dimension;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * The thresholds, verbatim from ADR-013 D6, with the reasoning in R1.
 *
 * LITERALS, AND NEVER CONFIGURATION (ADR-013 R1 clause 3). No value here may be read from
 * `process.env`, from a database row, or from any other runtime-mutable source: an operator
 * who could widen a security control without a code review would be outside the governance
 * that owns these numbers, and a deployment could then differ from what the ADR says it
 * enforces. A CI guardrail greps this file for exactly that.
 *
 * CHANGING A NUMBER IS GOVERNED BY DIRECTION, NOT SIZE (R1 clause 4). A policy's posture is
 * its permitted rate, `limit ÷ window`, plus the set of policies in force. Tightening is
 * ordinary code review. **Weakening — raising a limit or rate, removing or disabling a
 * policy, changing a dimension — requires amending ADR-013**, under the rule that already
 * governs this repository: the architecture set is frozen, and evidence opens the amendment
 * door rather than walking around it (FOUNDING_PRINCIPLES §10). Reducing a limit to zero is
 * also a weakening — of availability — and takes the same route.
 */
const WINDOW = 15 * 60;

const POLICIES: Readonly<Record<PolicyName, Policy>> = {
  // Above ordinary human error — someone who has forgotten a password tries three or four
  // times, then uses recovery — and far below a useful guessing budget.
  "sign_in.identifier_ip": { dimension: "identifier_ip", limit: 5, windowSeconds: WINDOW },
  // Four times the single-source limit, so a distributed attacker needs at least four
  // addresses to reach it, while someone on a mobile connection that changes address
  // mid-session is not caught by the stricter bucket.
  "sign_in.identifier": { dimension: "identifier", limit: 20, windowSeconds: WINDOW },
  // A shared office or CGNAT egress with twenty people signing in over a morning stays far
  // below; a spray across sixty accounts from one host does not.
  "sign_in.ip": { dimension: "ip", limit: 60, windowSeconds: WINDOW },
  // Caps mail to one address at twelve an hour, leaving room to resend twice.
  "magic_link.identifier": { dimension: "identifier", limit: 3, windowSeconds: WINDOW },
  "magic_link.ip": { dimension: "ip", limit: 30, windowSeconds: WINDOW },
  // Sign-up is a NEW fence over a previously unlimited endpoint, so it is a tightening
  // under R1 clause 4 rather than a weakening — ordinary code review, no ADR amendment.
  //
  // Matched to `magic_link` on the identifier because both send mail to an address that
  // did not ask for it, and one address needs at most a couple of attempts plus a resend.
  "sign_up.identifier": { dimension: "identifier", limit: 3, windowSeconds: WINDOW },
  // Stricter than `magic_link.ip` (30) deliberately: a magic link is a *login* for an
  // account that already exists, while each of these mints a new identity row. A shared
  // office signing in all morning is normal; ten new households an hour from one address
  // is not, and the cost of being wrong is a bulk account-creation run rather than a
  // person waiting for a second email.
  "sign_up.ip": { dimension: "ip", limit: 10, windowSeconds: WINDOW },
};

/**
 * Evaluated most specific first. Order is not a security property — every listed policy is
 * incremented regardless (see `enforceRateLimit`) — but it decides which policy name a
 * rejection reports, and the narrowest one is the most useful thing to see in a log.
 */
export const SIGN_IN_POLICIES: readonly PolicyName[] = [
  "sign_in.identifier_ip",
  "sign_in.identifier",
  "sign_in.ip",
];

export const MAGIC_LINK_POLICIES: readonly PolicyName[] = [
  "magic_link.identifier",
  "magic_link.ip",
];

export const SIGN_UP_POLICIES: readonly PolicyName[] = ["sign_up.identifier", "sign_up.ip"];

/**
 * The policies a successful sign-in clears (ADR-013 D6).
 *
 * Identifier-keyed only, and the omission of `sign_in.ip` is the point: one person signing
 * in successfully must not reset a bucket shared with everyone else behind the same address,
 * or an attacker on a shared egress would get their budget refunded by every neighbour's
 * successful login.
 */
export const SIGN_IN_CLEAR_ON_SUCCESS: readonly PolicyName[] = [
  "sign_in.identifier_ip",
  "sign_in.identifier",
];

/* ──────────────────────────── subject derivation ──────────────────────────── */

/**
 * Normalization is load-bearing (ADR-013 D3).
 *
 * `Ada@Example.test` and `ada@example.test ` must land in the same bucket, or the limit is
 * evaded by pressing shift. Only case and surrounding whitespace are folded: anything
 * cleverer — stripping dots, dropping `+tags` — would silently merge addresses that the
 * identity provider treats as distinct accounts, which is a correctness bug pointing the
 * wrong way.
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/**
 * The client address, per ADR-013 D5 — **the ADR's documented inference, not a property
 * this repository has verified.**
 *
 * The trusted topology is doc 09 §3 (review A7/F-03): `app.autobureau.com` is DNS-only to
 * Vercel with no Cloudflare proxy in front, so exactly one hop precedes a handler. No
 * governing document says anything about forwarded headers — `docs/` and `ops/` contain no
 * mention of `X-Forwarded-For` at all — so the rule below rests on two premises the ADR
 * names and this code cannot check: that the edge appends (or replaces) rather than passing
 * the header through, and that it is the last appending hop.
 *
 * RIGHT-MOST, AND ONLY RIGHT-MOST. Under append semantics the left-most value is whatever
 * the *client* sent, so a left-most rule hands the bucket key to an attacker. Right-most can
 * be wrong — an extra internal hop would make it an internal address — but it cannot be
 * chosen by the caller. That failure direction is the entire justification, and it is why
 * the IP dimension is generous and strictly secondary everywhere it appears.
 *
 * One header, one position. Not `Forwarded`, not `x-real-ip`, not any `x-vercel-*` header,
 * not a caller-chosen index — broadening this is how a limiter quietly becomes advisory.
 *
 * Returns `null` rather than throwing when there is nothing trustworthy to use. An endpoint
 * that refused to authenticate anyone because it could not determine an IP would be a worse
 * outcome than the abuse this dimension exists to blunt.
 */
export function clientIpFrom(request: Request): string | null {
  const header = request.headers.get("x-forwarded-for");
  if (header === null) return null;
  const values = header.split(",");
  const candidate = values[values.length - 1]?.trim() ?? "";
  // Strict on purpose: `isIP` is the whole accepted grammar. A value carrying a port, a
  // zone id, or an obfuscated identifier is treated as absent rather than guessed at.
  return isIP(candidate) === 0 ? null : candidate;
}

/**
 * The bucket key: SHA-256 of the policy-domain-separated subject.
 *
 * NOT SECRECY, and ADR-013 D3 says so at length. An email's preimage space is small and
 * enumerable — and `users.email` is readable in plaintext by `app_user` anyway — so this
 * digest is reversible by anyone holding the table and a wordlist. What it buys is that the
 * table never becomes a *second* plaintext corpus of addresses that attempted sign-in, and
 * that nothing reversible-looking is available to be logged or screenshotted.
 *
 * Domain-separated by policy so the same address occupies different rows under
 * `sign_in.identifier` and `magic_link.identifier`. The NUL separator makes the composition
 * unambiguous: without it, `("a", "bc")` and `("ab", "c")` would collide.
 */
export function bucketOf(policy: PolicyName, subject: string): string {
  return createHash("sha256").update(`${policy}\u0000${subject}`).digest("hex");
}

/** The subject a policy counts, or `null` when its dimension is unavailable. */
function subjectFor(policy: Policy, identifier: string, ip: string | null): string | null {
  switch (policy.dimension) {
    case "identifier":
      return identifier;
    case "ip":
      return ip;
    case "identifier_ip":
      return ip === null ? null : `${identifier}\u0000${ip}`;
  }
}

/* ──────────────────────────────── the store ──────────────────────────────── */

interface CounterRow {
  readonly attempts: number;
  readonly retry_after: number;
}

/**
 * Count one attempt and report the running total, atomically.
 *
 * ATOMICITY LIVES IN THIS STATEMENT, not in application code — the same property ADR-012
 * relies on for idempotency. `INSERT … ON CONFLICT DO UPDATE` against the unique index takes
 * the row lock, so of two simultaneous attempts on one bucket, one sees 1 and the other sees
 * 2. A read-then-write would let both read the same value and both write back "one more",
 * which is how a limit of five becomes a limit of "five, mostly".
 *
 * THE WINDOW IS COMPUTED BY THE DATABASE. `now()` here is the transaction clock, so every
 * serverless instance floors to the same window boundary regardless of its own clock. Doing
 * this in JavaScript would make the bucket a function of whichever machine answered.
 *
 * The DELETE ahead of it is the expiry sweep (ADR-013 D11): bounded by `LIMIT`, so one
 * request can never do unbounded work, and `SKIP LOCKED` so two concurrent sweeps never wait
 * on each other — this runs on the hot path of exactly the attack that creates contention.
 */
async function count(tx: GlobalClient, policy: PolicyName, bucket: string, windowSeconds: number) {
  await tx.$queryRaw`
    DELETE FROM auth_rate_limits
    WHERE id IN (
      SELECT id FROM auth_rate_limits
      WHERE policy = ${policy} AND expires_at <= now()
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
  `;
  const rows = await tx.$queryRaw<CounterRow[]>`
    WITH w AS (
      SELECT to_timestamp(
               floor(extract(epoch FROM now()) / ${windowSeconds}::double precision)
               * ${windowSeconds}::double precision
             ) AS started
    )
    INSERT INTO auth_rate_limits (policy, bucket, window_started_at, attempts, expires_at)
    SELECT ${policy}, ${bucket}, w.started, 1,
           w.started + ${windowSeconds}::double precision * interval '1 second'
      FROM w
    ON CONFLICT (policy, bucket, window_started_at)
      DO UPDATE SET attempts = auth_rate_limits.attempts + 1, updated_at = now()
    RETURNING attempts,
              GREATEST(1, ceil(extract(epoch FROM expires_at - now()))::int) AS retry_after
  `;
  return rows[0];
}

/**
 * Forget a subject's counters for these policies, across every live window.
 *
 * `window_started_at` is deliberately not constrained: a user whose fifth attempt lands one
 * second after a window boundary would otherwise succeed while the previous window's row
 * still stood, and the next attempt would be counted against a bucket they had already
 * cleared.
 */
async function forget(tx: GlobalClient, policies: readonly PolicyName[], buckets: string[]) {
  await tx.$queryRaw`
    DELETE FROM auth_rate_limits
    WHERE policy = ANY(${[...policies]}::text[])
      AND bucket = ANY(${buckets}::text[])
  `;
}

/* ─────────────────────────────── enforcement ─────────────────────────────── */

export interface RateLimitInput {
  readonly db: Database;
  readonly request: Request;
  /** The raw identifier from the validated body. Normalized here, never logged. */
  readonly identifier: string;
  readonly policies: readonly PolicyName[];
  readonly traceId: string;
  readonly route: string | undefined;
}

/** One policy's verdict. `failed` is the store, not the caller. */
type Verdict =
  | { readonly kind: "ok" }
  | { readonly kind: "exceeded"; readonly policy: PolicyName; readonly retryAfter: number }
  | { readonly kind: "failed"; readonly policy: PolicyName; readonly cause: unknown };

/**
 * The one call site an auth handler makes. Returns a `429` to send, or `null` to proceed.
 *
 * EVERY LISTED POLICY IS INCREMENTED, even after one has already been exceeded (ADR-013 D6:
 * "every attempt counts"). Returning early on the first rejection would mean an attacker who
 * trips the narrow identifier+IP bucket stops accumulating against the broad per-IP one —
 * which is precisely the dimension that catches them spreading out.
 *
 * FAIL OPEN, LOUDLY (ADR-013 D7). If the store cannot be consulted the request proceeds, on
 * every endpoint, and the failure is recorded at `error`. This is a deliberate risk decision
 * and not a technicality: limiter degradation is not database failure. A lock-wait timeout on
 * a hot bucket, a statement timeout, pool exhaustion, or a migration that has not reached a
 * live deployment all leave authentication working and only the counting broken — and
 * fail-closed would convert the contention an attack creates into a full authentication
 * outage, making the limiter the denial of service. The accepted residual risk is that
 * during degradation nothing else implemented here throttles credential stuffing, which is
 * why the `error` record is an obligation rather than decoration.
 *
 * A store that ANSWERS "over limit" is always honoured — fail-open covers only the case
 * where it could not be reached, never a verdict it actually returned. So a rejection from
 * one policy outranks a storage failure in another.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<Response | null> {
  const { db, request, policies, traceId, route } = input;
  const identifier = normalizeIdentifier(input.identifier);
  const ip = clientIpFrom(request);

  const verdicts: Verdict[] = [];
  const skipped: PolicyName[] = [];

  for (const name of policies) {
    const policy = POLICIES[name];
    const subject = subjectFor(policy, identifier, ip);
    if (subject === null) {
      // No trustworthy IP: this dimension is skipped, never an error and never a rejection.
      skipped.push(name);
      continue;
    }
    try {
      const row = await db.withGlobalTable("auth_rate_limits", (tx) =>
        count(tx, name, bucketOf(name, subject), policy.windowSeconds),
      );
      // A missing row would mean the upsert returned nothing, which cannot happen — but
      // treating it as "counted zero" would silently disable the policy, so it is a failure.
      if (row === undefined) {
        verdicts.push({ kind: "failed", policy: name, cause: new Error("counter returned no row") });
      } else if (row.attempts > policy.limit) {
        verdicts.push({ kind: "exceeded", policy: name, retryAfter: row.retry_after });
      } else {
        verdicts.push({ kind: "ok" });
      }
    } catch (cause) {
      verdicts.push({ kind: "failed", policy: name, cause });
    }
  }

  if (skipped.length > 0) {
    log({
      event: "auth.rate_limit_degraded",
      level: "warn",
      traceId,
      route,
      method: request.method,
      // Policy names are classes, never subjects. No address, no IP, no bucket.
      meta: { skipped_policies: skipped },
    });
  }

  const exceeded = verdicts.filter(
    (v): v is Extract<Verdict, { kind: "exceeded" }> => v.kind === "exceeded",
  );
  if (exceeded.length > 0) {
    // The longest remaining window among the tripped policies: retrying earlier than that
    // would only earn a second rejection.
    const retryAfter = Math.max(...exceeded.map((v) => v.retryAfter));
    log({
      event: "auth.rate_limited",
      level: "warn",
      traceId,
      route,
      method: request.method,
      status: 429,
      meta: { policy: exceeded[0]?.policy },
    });
    return rateLimitedResponse(retryAfter);
  }

  const failure = verdicts.find(
    (v): v is Extract<Verdict, { kind: "failed" }> => v.kind === "failed",
  );
  if (failure !== undefined) {
    // ONE record per request, not one per policy: a database outage would otherwise triple
    // the log volume of every sign-in at exactly the moment logging matters most.
    log({
      event: "auth.rate_limit_unavailable",
      level: "error",
      traceId,
      route,
      method: request.method,
      error: failure.cause,
      meta: { policy: failure.policy },
    });
  }
  return null;
}

/**
 * Clear a subject's identifier buckets after a genuine success (ADR-013 D6).
 *
 * Best effort, and deliberately so: a clear that fails must not turn a completed sign-in
 * into an error. The consequence of failing is that the user keeps counters they have
 * earned the right to lose, which expires on its own within the window.
 */
export async function clearRateLimit(input: RateLimitInput): Promise<void> {
  const { db, request, policies, traceId, route } = input;
  const identifier = normalizeIdentifier(input.identifier);
  const ip = clientIpFrom(request);

  const buckets = policies
    .map((name) => {
      const subject = subjectFor(POLICIES[name], identifier, ip);
      return subject === null ? null : bucketOf(name, subject);
    })
    .filter((bucket): bucket is string => bucket !== null);
  if (buckets.length === 0) return;

  try {
    await db.withGlobalTable("auth_rate_limits", (tx) => forget(tx, policies, buckets));
  } catch (cause) {
    log({
      event: "auth.rate_limit_clear_failed",
      level: "warn",
      traceId,
      route,
      method: request.method,
      error: cause,
    });
  }
}

/**
 * The `429` (ADR-013 D10).
 *
 * `Retry-After` in seconds, as doc 03 §1 requires. `RateLimit-*` headers are deliberately
 * NOT emitted: doc 03 §1 lists them for the authenticated domain API, where the caller owns
 * the budget being described — on an unauthenticated endpoint they tell an attacker exactly
 * how much budget remains, and differing values per identifier are an enumeration oracle.
 *
 * The detail is one fixed sentence, identical to the one a provider `429` already produces,
 * so a provider-imposed limit and an application-imposed one are indistinguishable to the
 * caller. It carries no count, no threshold, no window, and no hint about which dimension
 * tripped or whether the account exists.
 */
function rateLimitedResponse(retryAfterSeconds: number): Response {
  return problemResponse("rate-limited", {
    detail: "Too many attempts — try again shortly.",
    headers: { "retry-after": String(retryAfterSeconds) },
  });
}
