import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/patterns/command-palette";
import {
  HouseholdProvider,
  type ActiveHousehold,
  type HouseholdOption,
  type Viewer,
} from "@/providers/household-provider";
import { HouseholdChooser } from "@/components/layout/household-chooser";
import { activeHouseholdFrom } from "@/lib/active-household";
import { authConfigFromEnv } from "@/server/auth/config";
import {
  HOUSEHOLD_HEADER,
  RequestContextError,
  membershipsVia,
  readCookie,
  resolveRequestContext,
} from "@/server/auth/context";
import { createJwtVerifier } from "@/server/auth/jwt";
import { getDatabase } from "@/server/db";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/server/http/public-routes";

/**
 * Authenticated route group (ADR-009 D1/D3).
 *
 * D3 places the resolver in the request tier — "server components and `/v1` handlers"
 * — because that is where a pooled connection and a `RequestContext` legitimately
 * exist. This is the server-component half of that sentence. Middleware has already
 * established that the session is valid; nothing here re-does that work, and nothing
 * here trusts a header: identity comes from the cookie's verified subject, via the
 * same `resolveRequestContext` the `/v1` boundary uses.
 *
 * TIMEZONE AND LOCALE ARE UI COMPATIBILITY FIELDS
 * -----------------------------------------------
 * `ActiveHousehold` carries `timezone` and `locale`, but no household-level source
 * for them exists: doc 02 puts both on `user_profiles`, and `households` has neither
 * column. Doc 03 §1 settles which clock renders — "user timezone applied only at
 * render/scheduling" — so the value supplied here is the *viewer's*. The fields keep
 * their current home on the household object only because the provider's shape
 * predates that reading; moving them is UI work, not this gate's.
 */

type Resolution =
  | {
      readonly kind: "ready";
      readonly household: ActiveHousehold;
      readonly viewer: Viewer;
      readonly households: readonly HouseholdOption[];
    }
  /** More than one membership and no usable preference — the person picks (P1-03). */
  | { readonly kind: "choose"; readonly households: readonly HouseholdOption[] }
  /** Authenticated, but no household yet — onboarding, not an error page (P1-02). */
  | { readonly kind: "onboarding" }
  | { readonly kind: "sign-in" };

/**
 * The principal's own households, by name, read in phase 1 (P1-03).
 *
 * Only reached when the resolver refused to guess between several memberships, so the
 * cost is paid by the case that needs it. The token is verified again here rather than
 * plumbed out of the rejection: `resolveRequestContext` deliberately reports *why* it
 * refused and nothing about who was asking, and widening that to carry a subject would
 * make an error type into an identity channel.
 *
 * `withPrincipal` sets `request.user_id` and no household, which is exactly the condition
 * `self_households_read` is guarded on — so this sees this principal's households and no
 * others. Nothing the browser sent is consulted.
 */
async function ownHouseholds(
  db: ReturnType<typeof getDatabase>,
  deps: { verifier: ReturnType<typeof createJwtVerifier>; cookieName: string },
  requestHeaders: Headers,
): Promise<readonly HouseholdOption[]> {
  const token = readCookie(requestHeaders.get("cookie"), deps.cookieName);
  if (token === null) return [];
  const { userId } = await deps.verifier.verify(token);
  const rows = await db.withPrincipal(userId, (tx) =>
    tx.household.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Kept separate from the component so `redirect()` is never called inside a `try`.
 * It signals by throwing, and a catch-all would swallow the redirect and render the
 * authenticated shell to someone who is not entitled to it.
 */
async function resolve(): Promise<Resolution> {
  let config;
  let db;
  try {
    config = authConfigFromEnv();
    db = getDatabase();
  } catch {
    // Unreachable in practice — middleware denies every non-public route when the
    // deployment is unconfigured — but failing to sign-in is the only safe answer.
    return { kind: "sign-in" };
  }

  const requestHeaders = await headers();

  const deps = {
    verifier: createJwtVerifier({
      jwks: config.jwks,
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    }),
    memberships: membershipsVia(db),
    cookieName: config.cookieName,
  };

  /**
   * The one place the selection cookie becomes a candidate (P1-03).
   *
   * A browser sends cookies on a document navigation and never a custom header, so the
   * preference arrives as a cookie and is translated here into the `X-Household-Id`
   * `resolveRequestContext` already reads. The resolver is untouched: it still decides,
   * and this only hands it something to decide about.
   */
  const request = (candidate: string | null): Request => {
    const forwarded = new Headers(requestHeaders);
    if (candidate) forwarded.set(HOUSEHOLD_HEADER, candidate);
    return new Request("http://localhost/", { headers: forwarded });
  };

  const preference = activeHouseholdFrom(requestHeaders.get("cookie"));

  let ctx;
  try {
    try {
      ctx = await resolveRequestContext(request(preference), deps);
    } catch (cause) {
      // A preference the server refuses is discarded, not fatal. Membership can be
      // revoked, a cookie can be edited, and an id can go stale between sessions — in
      // every one of those cases the honest reading is "this preference is no longer
      // meaningful", not "this person may never load the application again".
      //
      // The retry names NO candidate, so it cannot widen access by construction: it
      // resolves the sole membership, or raises `ambiguous-household`, or raises
      // `no-membership`. The `/v1` boundary does none of this and stays strict — a
      // refused header there is still a 403, because that is an authorization answer
      // rather than a stale preference.
      const refusedPreference =
        preference !== null &&
        cause instanceof RequestContextError &&
        (cause.reason === "not-a-member" || cause.reason === "malformed-household");
      if (!refusedPreference) throw cause;
      ctx = await resolveRequestContext(request(null), deps);
    }
  } catch (cause) {
    if (cause instanceof RequestContextError && cause.reason === "unauthenticated") {
      return { kind: "sign-in" };
    }
    // `no-membership` used to be left to propagate, and the reason given was that a
    // redirect "would send someone to a screen that cannot create a household anyway".
    // P1-02 removed that premise: `ensureHousehold` now runs at both places a session is
    // established, so a principal reaching this branch is one whose bootstrap has not run
    // — a session predating P1-02, or a sole membership revoked mid-session. Rendering a
    // 500 at them is not D1 being strict, it is an unhandled exception wearing D1's
    // clothes: the person sees "something went wrong" and has no way forward.
    //
    // THE `/v1` BOUNDARY IS UNCHANGED AND STAYS 403. D1 fixes zero memberships at 403 and
    // A2 tests it; that is an authorization answer to a programmatic caller. This is the
    // HTML tier answering a document navigation, where the honest response is the screen
    // that resolves the condition — the same split already made for `ambiguous-household`,
    // which is 400 at `/v1` and a chooser here. Onboarding sits outside this route group,
    // so it renders without re-entering this layout, and it is reached only with a
    // verified session because middleware guards it like every other non-public path.
    if (cause instanceof RequestContextError && cause.reason === "no-membership") {
      return { kind: "onboarding" };
    }
    // `ambiguous-household` is the one rejection P1-03 can answer. It is not a failure:
    // the resolver refusing to guess between two real memberships is D1 working, and the
    // only thing missing was somewhere to express the choice. Without this the resolver
    // would be right and the person would be permanently stuck — unable to reach the
    // switcher that would have unstuck them. The list below is read in phase 1, where the
    // self-read policies let a principal see its own households and nothing else, so this
    // enumerates memberships rather than trusting anything the browser said.
    if (cause instanceof RequestContextError && cause.reason === "ambiguous-household") {
      return { kind: "choose", households: await ownHouseholds(db, deps, requestHeaders) };
    }
    throw cause;
  }

  // Phase 1, before the household scope opens: which households this principal belongs
  // to. It is what the switcher offers, and it is also how the client decides whether a
  // selection needs naming at all — one membership names nothing (P1-03).
  const households = await db.withPrincipal(ctx.userId, (tx) =>
    tx.household.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  );

  // One short scoped transaction, no network I/O inside it. RLS is what scopes the
  // household rows: the queries name no household id and the policy decides.
  const data = await db.withHousehold(ctx.householdId, async (tx) => {
    const household = await tx.household.findFirst({
      select: { name: true, emailAlias: true },
    });
    const members = await tx.householdMember.findMany({
      where: { archivedAt: null },
      select: { id: true, displayName: true, kind: true },
      orderBy: { createdAt: "asc" },
    });
    const entitlement = await tx.entitlement.findFirst({ select: { plan: true } });
    // `users`/`user_profiles` carry no RLS by design (rls migration ¶ "not
    // household-scoped; access is enforced in the application's session layer").
    // The scope is therefore this explicit `where` on the verified subject.
    const user = await tx.user.findUnique({
      where: { id: ctx.userId },
      select: {
        email: true,
        profile: { select: { displayName: true, locale: true, timezone: true } },
      },
    });
    return { household, members, entitlement, user };
  });

  const profile = data.user?.profile;
  const email = data.user?.email ?? "";

  return {
    kind: "ready",
    households: households.map((h) => ({ id: h.id, name: h.name })),
    viewer: {
      id: ctx.userId,
      displayName: profile?.displayName ?? email,
      email,
    },
    household: {
      id: ctx.householdId,
      name: data.household?.name ?? "",
      role: ctx.role,
      // See the header note. The fallbacks are the schema's own defaults, not
      // invented values — identity mirroring always writes a profile, so they are
      // unreachable in practice.
      timezone: profile?.timezone ?? "America/New_York",
      locale: profile?.locale ?? "en-US",
      emailAlias: data.household?.emailAlias ?? null,
      members: data.members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        kind: m.kind,
      })),
      plan: data.entitlement?.plan === "premium" ? "premium" : "free",
    },
  };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const resolved = await resolve();
  if (resolved.kind === "sign-in") redirect(SIGN_IN_PATH);
  if (resolved.kind === "onboarding") redirect(ONBOARDING_PATH);
  // No shell, because there is no household to render one for yet. This is the whole
  // recovery path for a multi-household principal: choose, and the next server render
  // resolves normally.
  if (resolved.kind === "choose") return <HouseholdChooser households={resolved.households} />;

  return (
    <HouseholdProvider
      household={resolved.household}
      viewer={resolved.viewer}
      households={resolved.households}
    >
      <AppShell>{children}</AppShell>
      <CommandPalette />
    </HouseholdProvider>
  );
}

/** Per-principal, per-household. Nothing under this layout may be cached or prerendered. */
export const dynamic = "force-dynamic";
