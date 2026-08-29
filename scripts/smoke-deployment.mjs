#!/usr/bin/env node
/**
 * Deployment smoke test (blueprint P1-01).
 *
 * The gate the blueprint asks for: *"a deploy that serves `/` and returns 503 on `/v1`
 * until `AUTH_*` is set."* This runs against any origin — a local `next start`, a Vercel
 * preview, staging, or production — and is the same script CI runs after every deploy,
 * so "the deployment works" means the same thing in every environment.
 *
 *   node scripts/smoke-deployment.mjs https://example.vercel.app
 *   node scripts/smoke-deployment.mjs http://localhost:3000 --expect-unconfigured
 *
 * `--expect-unconfigured` asserts the *stricter* posture of a deployment that has no
 * `AUTH_*` set yet: the boundary must refuse every domain request. Without the flag the
 * boundary is expected to be configured, and the assertion relaxes to "never serves
 * domain data unauthenticated" — which is the property that must hold in production.
 *
 * WHY `/v1` IS NOT UNIFORMLY 503
 * ------------------------------
 * The blueprint's one-line phrasing hides a real split, and this script encodes the split
 * rather than the phrasing:
 *
 *   - `/v1/auth/sign-in` is a **public** path (`server/http/public-routes.ts`), so
 *     middleware lets it through and it reaches the boundary, which answers **503
 *     "Authentication is not configured on this deployment."**
 *   - `/v1/households/current` is **protected**, so middleware denies it first and
 *     answers **401** — ADR-009 D3 deny-by-default, deliberately ahead of the boundary.
 *
 * Both are safe refusals. Rewriting middleware to make the protected route report 503
 * instead would mean weakening deny-by-default to satisfy a doc sentence, so the script
 * asserts what the architecture actually guarantees: neither route ever serves data, and
 * the *reachable* boundary reports itself unconfigured.
 */

const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
const EXPECT_UNCONFIGURED = process.argv.includes("--expect-unconfigured");

// Vercel Deployment Protection sits *in front of* the deployment: it answers before the
// Build Output runs, so an unauthenticated CI request never reaches middleware at all.
// The bypass secret is how automation identifies itself to that gate without turning the
// gate off — preview URLs stay private to everyone else. Absent, every request below is
// byte-for-byte what it was before, which is what keeps `next start` and any unprotected
// origin working unchanged.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const BYPASS_HEADERS = BYPASS === "" ? {} : { "x-vercel-protection-bypass": BYPASS };

if (!BASE) {
  console.error("usage: node scripts/smoke-deployment.mjs <base-url> [--expect-unconfigured]");
  process.exit(2);
}

// A scheme with no host — `https://` — survives the check above, because stripping the
// trailing slashes leaves the truthy string `https:`. It is checked separately, and named
// rather than left to `fetch`'s "Failed to parse URL", because there is exactly one caller
// that produces this shape: §9.7's rollback step interpolating an unset `PRODUCTION_HOST`.
// That step runs only when the job is already failing, so an unexplained stack trace there
// reads as part of the original failure. The rollback itself still ran — `vercel rollback`
// precedes this — so what an unset variable costs is the proof that it landed.
if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/*$/.test(BASE)) {
  console.error(`FAIL  base URL has a scheme but no host: ${JSON.stringify(BASE)}`);
  console.error("      From CI this means the repository variable PRODUCTION_HOST is unset");
  console.error("      (doc 09 §9.4). The rollback ran; its verification did not.");
  process.exit(2);
}
if (!URL.canParse(BASE) || new URL(BASE).hostname === "") {
  console.error(`FAIL  not a usable base URL: ${JSON.stringify(BASE)}`);
  console.error("      Expected an absolute origin, e.g. https://app.example.com");
  process.exit(2);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  const line = detail === undefined ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.error(`${ok ? "PASS" : "FAIL"}  ${name}${line}`);
}

async function get(path, init) {
  // The bypass header goes first so an explicit `headers` in `init` still wins — no caller
  // sets it today, and none should have to think about it.
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    headers: { ...BYPASS_HEADERS, ...init?.headers },
  });
  return response;
}

/**
 * Is something answering ahead of the application?
 *
 * Two signals, both unambiguous. The application's own redirects are built with
 * `new URL(to, request.nextUrl.origin)` (`apps/web/src/middleware.ts`), so they are
 * same-origin by construction and can never point at `vercel.com`; and nothing in this
 * codebase sets a `_vercel_sso_nonce` cookie. Either one means the response came from the
 * protection gate, not from us.
 */
function interceptedBy(response) {
  const location = response.headers.get("location");
  if (location !== null && URL.canParse(location, BASE)) {
    const host = new URL(location, BASE).hostname;
    if (host === "vercel.com" || host.endsWith(".vercel.com")) return `redirect to ${host}`;
  }
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  if (cookies.some((c) => c.includes("_vercel_sso_nonce"))) return "_vercel_sso_nonce cookie";
  return null;
}

// ── 1. The application shell serves ───────────────────────────────────────────────────
const root = await get("/");

// An intercepted deployment does not fail this suite honestly: the negative assertions
// below are all satisfied by a 302 (`!== 200`, `!== 503`), and the CSP checks read an
// empty `script-src`, so a deployment nobody ever reached scores a comfortable majority of
// passes. Stop here instead, and say which of the two causes it is.
const intercepted = interceptedBy(root);
if (intercepted !== null) {
  console.error(`FAIL  the deployment is behind Vercel Deployment Protection (${intercepted})`);
  console.error("      The gate answered before the application did, so nothing below would");
  console.error("      have tested this deployment.");
  console.error(
    BYPASS === ""
      ? "      VERCEL_AUTOMATION_BYPASS_SECRET is unset. CI must pass the repository secret\n" +
          "      of that name into this step's environment."
      : "      VERCEL_AUTOMATION_BYPASS_SECRET is set but was refused: it does not match the\n" +
          "      Protection Bypass for Automation value on this Vercel project.",
  );
  process.exit(2);
}

check("GET / responds 200", root.status === 200, { status: root.status });
const html = await root.text();
check("GET / returns an HTML document", /<html[\s>]/i.test(html));

// ── 2. Security headers survive the deployment (doc 12 §4) ────────────────────────────
// A deployment that drops these is a deployment that silently undoes P0-15 and the header
// work before it, which no functional test would notice.
const CONSTANT_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
};
for (const [header, expected] of Object.entries(CONSTANT_HEADERS)) {
  const actual = root.headers.get(header);
  check(`header ${header}`, actual === expected, { expected, actual });
}

// ── 3. CSP is still nonce-based with no script 'unsafe-inline' (ADR-010) ──────────────
const csp = root.headers.get("content-security-policy");
const scriptSrc = (csp ?? "")
  .split(";")
  .map((d) => d.trim())
  .find((d) => d.startsWith("script-src"));
check("CSP header present", Boolean(csp));
check("script-src carries a per-request nonce", /'nonce-[A-Za-z0-9+/_-]+={0,2}'/.test(scriptSrc ?? ""), scriptSrc);
check("script-src has no 'unsafe-inline'", !(scriptSrc ?? "").includes("'unsafe-inline'"));

// A second request must not reuse the nonce — a constant nonce is not a nonce.
const rootAgain = await get("/");
const nonceOf = (value) => /'nonce-([^']+)'/.exec(value ?? "")?.[1];
check(
  "the nonce differs between two requests",
  nonceOf(csp) !== undefined && nonceOf(csp) !== nonceOf(rootAgain.headers.get("content-security-policy")),
);

// Every inline script in the served HTML must carry that response's nonce, or the page is
// broken in exactly the way a CSP regression breaks it: silently, only in a browser.
const inline = [...html.matchAll(/<script\b([^>]*)>/gi)]
  .map((m) => m[1])
  .filter((attrs) => !/\ssrc=/i.test(attrs));
const nonce = nonceOf(csp);
check(
  "every inline script carries the response nonce",
  inline.length > 0 && inline.every((attrs) => attrs.includes(`nonce="${nonce}"`)),
  { inlineScripts: inline.length },
);

// ── 4. The domain boundary refuses safely ─────────────────────────────────────────────
const protectedRoute = await get("/v1/households/current");
check(
  "GET /v1/households/current never serves data unauthenticated",
  protectedRoute.status !== 200,
  { status: protectedRoute.status },
);
if (EXPECT_UNCONFIGURED) {
  // Middleware denies before the boundary can report itself unconfigured (ADR-009 D3).
  check(
    "protected /v1 is denied by the route guard (401)",
    protectedRoute.status === 401,
    { status: protectedRoute.status },
  );
}

// The public auth endpoint reaches the boundary, so it is the one that can report 503.
const signIn = await get("/v1/auth/sign-in", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-autobureau-request": "1",
    origin: BASE,
  },
  body: JSON.stringify({ email: "smoke@example.invalid", password: "not-a-real-password" }),
});
check("POST /v1/auth/sign-in never returns 200 for smoke credentials", signIn.status !== 200, {
  status: signIn.status,
});
if (EXPECT_UNCONFIGURED) {
  check(
    "unconfigured boundary reports 503",
    signIn.status === 503,
    { status: signIn.status },
  );
  const body = await signIn.clone().json().catch(() => null);
  check(
    "503 body is problem+json naming configuration, not a stack",
    body?.status === 503 && typeof body?.detail === "string" && /not configured/i.test(body.detail),
    body?.detail,
  );
} else {
  check(
    "configured boundary does not answer 503",
    signIn.status !== 503,
    { status: signIn.status, hint: "AUTH_* appears unset on this deployment" },
  );
}

// ── 5. No development affordances leaked into the deployment ──────────────────────────
check("no x-powered-by header", root.headers.get("x-powered-by") === null);
check("script-src has no 'unsafe-eval' (development-only)", !(scriptSrc ?? "").includes("'unsafe-eval'"));

const failed = results.filter((r) => !r.ok);
console.error(
  `\n${results.length - failed.length}/${results.length} checks passed against ${BASE}` +
    (EXPECT_UNCONFIGURED ? " (expecting an unconfigured boundary)" : ""),
);
process.exit(failed.length === 0 ? 0 : 1);
