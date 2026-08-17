import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/patterns/command-palette";
import {
  HouseholdProvider,
  type ActiveHousehold,
  type Viewer,
} from "@/providers/household-provider";
import { authConfigFromEnv } from "@/server/auth/config";
import {
  RequestContextError,
  membershipsVia,
  resolveRequestContext,
} from "@/server/auth/context";
import { createJwtVerifier } from "@/server/auth/jwt";
import { getDatabase } from "@/server/db";
import { SIGN_IN_PATH } from "@/server/http/public-routes";

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
  | { readonly kind: "ready"; readonly household: ActiveHousehold; readonly viewer: Viewer }
  | { readonly kind: "sign-in" };

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

  let ctx;
  try {
    ctx = await resolveRequestContext(new Request("http://localhost/", { headers: requestHeaders }), {
      verifier: createJwtVerifier({
        jwks: config.jwks,
        issuer: config.issuer,
        audience: config.audience,
        algorithms: config.algorithms,
      }),
      memberships: membershipsVia(db),
      cookieName: config.cookieName,
    });
  } catch (cause) {
    // Only the unauthenticated case redirects: that is the single HTML behaviour D3
    // specifies. Every other rejection — `no-membership` above all — is left to
    // propagate rather than rerouted. D1 fixes zero memberships at `403` and A2 tests
    // it, and the `/v1` boundary already answers exactly that; turning it into a
    // redirect here would invent a recovery route no document defines, and would send
    // someone to a screen that cannot create a household anyway. Next offers no way to
    // answer an HTML segment with 403 without `experimental.authInterrupts`, so failing
    // closed through the error boundary is the honest option available.
    if (cause instanceof RequestContextError && cause.reason === "unauthenticated") {
      return { kind: "sign-in" };
    }
    throw cause;
  }

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

  return (
    <HouseholdProvider household={resolved.household} viewer={resolved.viewer}>
      <AppShell>{children}</AppShell>
      <CommandPalette />
    </HouseholdProvider>
  );
}

/** Per-principal, per-household. Nothing under this layout may be cached or prerendered. */
export const dynamic = "force-dynamic";
