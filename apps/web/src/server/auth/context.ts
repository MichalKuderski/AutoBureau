import { UUID_RE } from "@autobureau/contracts";
import type { Database } from "@autobureau/db";
import { TokenError, type JwtVerifier } from "./jwt";
import type { HouseholdRole, PolicySubject } from "./policy";

/**
 * RequestContext resolution (ADR-009 D1, D3, D5; doc 06 §2).
 *
 * Doc 06 §2 specifies exactly three fields — `{user_id, household_id, role}` — and each
 * is independently justified: the user id attributes the audit row, the household id is
 * the only input to `withHousehold`, and the role is the only input to `can()`. Nothing
 * else is carried, because nothing else is needed yet.
 *
 * THE ORDER IS THE SECURITY PROPERTY (A7)
 * ---------------------------------------
 *   verified token → user id → memberships (phase 1) → household decision → context
 *
 * The household setting is never established here. This function decides *which*
 * household a request belongs to; the caller then opens `withHousehold` with the answer.
 * A rejected request therefore never opens a household scope at all, rather than opening
 * one and discovering afterwards that it should not have.
 *
 * IDENTITY IS NEVER TAKEN FROM A HEADER (A5)
 * ------------------------------------------
 * The only identity input is the `sub` of a verified token. `X-Household-Id` is read,
 * but purely as a *candidate* to be checked against membership (D1) — it never becomes
 * authority. No other request header is consulted for identity, so an injected
 * `x-user-id` (or anything shaped like one) is not ignored by policy, it is simply never
 * looked at.
 */

export interface RequestContext extends PolicySubject {
  readonly userId: string;
  readonly householdId: string;
  readonly role: HouseholdRole;
}

export type ContextRejection =
  /** No token, or a token that did not verify. */
  | "unauthenticated"
  /** The candidate household is not one this principal belongs to. */
  | "not-a-member"
  /** The principal belongs to no household at all. */
  | "no-membership"
  /** More than one membership and no explicit choice — D1 refuses to guess. */
  | "ambiguous-household"
  /** The candidate header was present but not a well-formed id. */
  | "malformed-household";

const STATUS: Record<ContextRejection, number> = {
  unauthenticated: 401,
  "not-a-member": 403,
  "no-membership": 403,
  "ambiguous-household": 400,
  "malformed-household": 400,
};

export class RequestContextError extends Error {
  override readonly name = "RequestContextError";
  readonly status: number;
  constructor(
    readonly reason: ContextRejection,
    message: string,
  ) {
    super(message);
    this.status = STATUS[reason];
  }
}

export const HOUSEHOLD_HEADER = "x-household-id";

export interface Membership {
  readonly householdId: string;
  readonly role: HouseholdRole;
}

/** Phase-1 membership lookup. The one dependency that genuinely needs a database. */
export type MembershipReader = (userId: string) => Promise<readonly Membership[]>;

export interface ResolveContextDeps {
  readonly verifier: JwtVerifier;
  readonly memberships: MembershipReader;
  /** Name of the `HttpOnly` cookie carrying the access token (D2). */
  readonly cookieName: string;
}

/**
 * Minimal cookie reader. Splits on the first `=` only, because a base64url JWT contains
 * none but a future value might; returns the first match, as browsers send it.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * Phase-1 reader over the real database.
 *
 * `withPrincipal` establishes `request.user_id` and no household, which is the exact
 * condition the self-read policies are guarded on — so this can see the principal's own
 * membership rows and nothing else. The explicit `where` is the application-layer scope
 * ADR-002 ¶2 asks for; the policy behind it is the second wall.
 */
export function membershipsVia(db: Database): MembershipReader {
  return (userId) =>
    db.withPrincipal(userId, async (tx) => {
      const rows = await tx.householdUser.findMany({
        where: { userId },
        select: { householdId: true, role: true },
      });
      return rows.map((row) => ({ householdId: row.householdId, role: row.role }));
    });
}

export async function resolveRequestContext(
  request: Request,
  deps: ResolveContextDeps,
): Promise<RequestContext> {
  const token = readCookie(request.headers.get("cookie"), deps.cookieName);
  if (token === null) {
    throw new RequestContextError("unauthenticated", "no session cookie");
  }

  let userId: string;
  try {
    ({ userId } = await deps.verifier.verify(token));
  } catch (cause) {
    // Every token failure collapses to one outcome. Which check failed is the
    // verifier's business and an attacker's curiosity, not part of this contract.
    if (cause instanceof TokenError) {
      throw new RequestContextError("unauthenticated", "session is not valid");
    }
    throw cause;
  }

  const candidate = normaliseCandidate(request.headers.get(HOUSEHOLD_HEADER));
  const memberships = await deps.memberships(userId);

  if (candidate !== null) {
    const match = memberships.find((m) => m.householdId === candidate);
    if (!match) {
      // Indistinguishable from "no such household" on purpose: confirming that an id
      // exists but belongs to someone else is an enumeration oracle.
      throw new RequestContextError("not-a-member", "no access to that household");
    }
    return { userId, householdId: match.householdId, role: match.role };
  }

  if (memberships.length === 0) {
    throw new RequestContextError("no-membership", "this account belongs to no household");
  }
  if (memberships.length > 1) {
    throw new RequestContextError(
      "ambiguous-household",
      `more than one household — name one with the ${HOUSEHOLD_HEADER} header`,
    );
  }

  const only = memberships[0]!;
  return { userId, householdId: only.householdId, role: only.role };
}

function normaliseCandidate(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;
  if (!UUID_RE.test(trimmed)) {
    throw new RequestContextError("malformed-household", "household id is not well formed");
  }
  return trimmed;
}
