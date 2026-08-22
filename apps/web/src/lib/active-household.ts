/**
 * The active-household selection (blueprint P1-03).
 *
 * A principal may belong to more than one household — the caregiver wedge is exactly the
 * persona with two. `resolveRequestContext` has always known how to handle that: one
 * membership resolves itself, more than one without a named candidate is
 * `ambiguous-household` (400), and a candidate that is not a membership is
 * `not-a-member` (403). What never existed was a way for the browser to *name* one.
 *
 * WHY A COOKIE AND NOT A ROUTE SEGMENT
 * ------------------------------------
 * The deciding constraint is that `(app)/layout.tsx` resolves the household on the
 * server, during a document navigation. A browser sends cookies on such a navigation and
 * never sends a custom header, so a header alone cannot survive a page load or a refresh.
 *
 * A route segment (`/[household]/dashboard`) would also survive, and was rejected on
 * blast radius rather than taste: it restructures every route under `(app)`, and this
 * repository has `typedRoutes` on, a `dynamicHref` escape hatch used at each data-derived
 * link, a middleware matcher written as a catch-all, and P0-14's route manifest asserting
 * the exact route list. Rewriting all of that to carry a preference — on the task the
 * blueprint marks "High risk — chokepoint" — buys shareable URLs the product has not
 * asked for.
 *
 * WHAT THIS VALUE IS, AND WHAT IT IS NOT
 * --------------------------------------
 * It is a *preference*: which household the person last chose to look at. It is not
 * authorization and is never treated as any. Every request re-derives access from the
 * verified token's memberships, and the cookie only ever supplies a candidate that
 * `resolveRequestContext` then accepts or refuses. That is also why it is not signed —
 * signing would imply the value carries trust of its own, when the point is that it
 * carries none.
 *
 * `HttpOnly` is deliberately absent, for two reasons that both follow from it being a
 * preference: the switcher sets it in the browser, which a server-only cookie would
 * require a new endpoint to do; and a household id is not a secret. It travels in
 * `X-Household-Id` on ordinary requests already.
 */

export const ACTIVE_HOUSEHOLD_COOKIE = "ab_household";

/** A year. This is a preference, so it should outlive the session that expressed it. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read the selection from a raw `Cookie` header value.
 *
 * Deliberately tolerant: an unparseable or absent value is "no selection", never an
 * error. A malformed preference must not be able to break a page load — the worst it can
 * do is resolve nothing, which is the same as never having chosen.
 */
export function activeHouseholdFrom(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== ACTIVE_HOUSEHOLD_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value === "" ? null : value;
  }
  return null;
}

/**
 * Persist the selection in the browser.
 *
 * `SameSite=Lax` so it is sent on the top-level navigation that follows — the whole
 * point is that the *server* sees it on the next page render. `Secure` unconditionally,
 * matching the session cookies: a flag that is sometimes absent is one nobody can reason
 * about.
 */
export function writeActiveHousehold(householdId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${ACTIVE_HOUSEHOLD_COOKIE}=${encodeURIComponent(householdId)}`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}

/** Drop the selection — used when the server refuses it, so a stale one cannot stick. */
export function clearActiveHousehold(): void {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${ACTIVE_HOUSEHOLD_COOKIE}=`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

/**
 * Re-render everything from the server after a selection changes.
 *
 * A full document load rather than `router.refresh()`, for two reasons. The honest one is
 * correctness: the entire premise is that the *server* re-decides which household this
 * is, and a document load re-runs the layout, re-reads the cookie, and rebuilds every
 * cache from scratch — there is no partially-refreshed state in which the sidebar names B
 * while a cached query still holds A's rows.
 *
 * The second is that it keeps `HouseholdProvider` free of the router. The provider wraps
 * every authenticated screen and every screen test; making it call `useRouter` would have
 * required a Next router in each of them, which is a lot of test surface bent around a
 * transition that happens rarely and can afford a page load.
 */
export function reloadForHousehold(): void {
  if (typeof window !== "undefined") window.location.reload();
}

/** The `Set-Cookie` value that clears the selection from a server response. */
export function clearedActiveHouseholdCookie(): string {
  return [
    `${ACTIVE_HOUSEHOLD_COOKIE}=`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}
