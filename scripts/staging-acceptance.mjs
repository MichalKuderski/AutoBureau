/**
 * Staging acceptance — the deployed application, exercised as a caller.
 *
 * `smoke-deployment.mjs` answers "did a correct build reach this URL": headers, CSP nonce,
 * and that neither route serves data unauthenticated. It deliberately never signs anyone in.
 * This answers the next question — "does the product work here" — by driving the real
 * identity lifecycle against the real provider and the real database: sign-up, the household
 * bootstrap behind it, sessions, tenant isolation, CSRF and the rate limiter.
 *
 * WHY THIS RUNS IN CI RATHER THAN FROM A DEVELOPER MACHINE
 * -------------------------------------------------------
 * Preview URLs sit behind Vercel Deployment Protection, and the bypass secret that lets
 * automation through is a CI secret. The runner is therefore the only caller that can reach
 * a preview at all, which is the same reason the smoke suite runs here.
 *
 * WHAT IT WRITES
 * --------------
 * Real rows in the staging database — auth users, households, memberships, entitlements.
 * That is the point: a household bootstrap asserted against a mock proves nothing about the
 * deployment. Every identity is prefixed `acc-` at `example.com`, the IETF-reserved test
 * domain, and doc 09 §1 already fixes staging as synthetic-only. It never runs against
 * production: the workflow only ever hands it a preview URL.
 *
 * REQUIRES "Confirm email" OFF on the staging project. With it on, sign-up issues no
 * session and there is nothing here to exercise; worse, each attempt sends mail through
 * Supabase's built-in SMTP, whose few-per-hour cap then answers 429 to everything.
 *
 * ORDERING IS LOAD-BEARING. The rate-limit section is last because it deliberately spends
 * the per-address budget, and `sign_up.ip` is shared by every sign-up in the run. Moving it
 * earlier would make later sections fail for a reason that has nothing to do with them.
 */

import { probeForeignHousehold } from './acceptance-tenant-probe.mjs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

const BASE = (process.argv[2] ?? process.env.ACCEPTANCE_BASE_URL ?? "").replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
// Set by the billing-runtime job after it deploys the exact candidate: checkout must work.
const REQUIRE_BILLING = process.env.ACCEPTANCE_REQUIRE_BILLING === "1";
const BYPASS_HEADERS = BYPASS === "" ? {} : { "x-vercel-protection-bypass": BYPASS };

if (!BASE || !URL.canParse(BASE) || new URL(BASE).hostname === "") {
  console.error(`usage: node scripts/staging-acceptance.mjs <base-url>  (got ${JSON.stringify(BASE)})`);
  process.exit(2);
}

/** The deployment's own origin — what `APP_ORIGIN` derives to, so CSRF should accept it. */
const ORIGIN = new URL(BASE).origin;
const CSRF = { "x-autobureau-request": "1" };
const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN, ...CSRF };
// Per run and never printed: a fixed password in a public repository would be a breached
// password by construction, and the authoritative policy now refuses those at sign-up.
const PASSWORD = `Acc-${randomBytes(12).toString("base64url")}-${randomBytes(3).toString("hex")}`;

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for the synthetic factor this run enrolls. Never printed. */
function totp(base32, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

const results = [];
let section = "";
function check(name, ok, detail) {
  results.push({ section, name, ok });
  const line = detail === undefined ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.error(`${ok ? "PASS" : "FAIL"}  ${name}${line}`);
}
function heading(title) {
  section = title;
  console.error(`\n── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
}
function blocked(name) {
  results.push({ section, name, ok: false, blocked: true });
  console.error(`BLOCKED  ${name}  (a distinct authenticated second household was not established)`);
}

async function req(path, init) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    headers: { ...BYPASS_HEADERS, ...init?.headers },
  });
}

/**
 * A cookie jar that stores names and values but is never printed.
 *
 * Session cookies are credentials; the assertions below are all about their *attributes*
 * and their *effect*, so no value ever reaches stdout.
 */
function jar() {
  return {
    c: new Map(),
    header() {
      return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    take(res) {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (value === "") this.c.delete(name);
        else this.c.set(name, value);
      }
      return res;
    },
  };
}
const attrsOf = (res, name) =>
  (res.headers.getSetCookie?.() ?? [])
    .filter((c) => c.startsWith(`${name}=`))
    .map((c) => c.split(";").slice(1).map((s) => s.trim()).join("; "))[0] ?? "";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// `example.com` is the IETF-reserved test domain. The previous `.invalid` TLD is reserved
// precisely to never resolve, and Supabase rejects it outright with `email_address_invalid`
// — every sign-up here failed on the address before any of this suite was exercised.
const addressFor = (tag) => `acc-${tag}-${stamp}@example.com`;
const created = [];

/**
 * A 5xx here is the deployment's own fault rather than a verdict about the request, and it
 * is the one case where this suite can hand over something that shortens the next step.
 *
 * `problemResponse` bodies are written to be safe to show — deliberately generic, naming no
 * account and no configuration — and `x-request-id` is the id the server put on its own log
 * record. Printing the pair turns "search the function logs" into "search for this id",
 * which matters because the actual cause (a database error, say) never reaches the caller.
 */
async function diagnose(label, res) {
  if (res.status < 500) return;
  const trace = res.headers.get("x-request-id") ?? res.headers.get("x-trace-id") ?? "(none)";
  const body = await res.clone().text().catch(() => "");
  let detail = body.slice(0, 200);
  try {
    detail = JSON.parse(body).detail ?? detail;
  } catch {
    /* not problem+json — show the truncated body as-is */
  }
  console.error(`      ↳ ${label} ${res.status} · trace ${trace} · ${JSON.stringify(detail)}`);
}

async function signUp(tag) {
  const email = addressFor(tag);
  const j = jar();
  const res = j.take(
    await req("/v1/auth/sign-up", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: `Acceptance ${tag}`, email, password: PASSWORD }),
    }),
  );
  await diagnose(`sign-up(${tag})`, res);
  created.push(email);
  return { email, jar: j, res };
}

/* ───────────────────────────── 1. sign-up and bootstrap ───────────────────────────── */

heading("sign-up → identity → household bootstrap");

const alice = await signUp("alice");

/**
 * A 202 does NOT mean "confirmation required".
 *
 * `/v1/auth/sign-up` answers 202 in two cases it deliberately refuses to tell apart: the
 * provider issued no session because confirmation is on, and the provider REFUSED the
 * request for any reason that is a fact about the account. That is the enumeration
 * protection working — an already-registered address must look exactly like a fresh one —
 * and it means a caller out here cannot distinguish "working, awaiting confirmation" from
 * "the provider rejected us" no matter what it asserts.
 *
 * So this reports both readings instead of picking one. Which it is has to be settled where
 * the evidence lives: whether an `auth.users` row appeared in the expected Supabase project,
 * and whether the limiter wrote its rows — the limiter runs BEFORE the provider call and
 * fails open, so a database this deployment cannot reach leaves no trace in any response.
 */
if (alice.res.status === 202) {
  const body = await alice.res.clone().json().catch(() => null);
  check("sign-up answers 202 with the non-committal body", body?.status === "confirmation-required", body);
  check(
    "no session cookies are issued on the 202 path",
    !(alice.res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("ab_session")),
  );
  console.error("\nSTOP: sign-up returned 202, which is EITHER confirmation-required OR a provider");
  console.error("      refusal — the endpoint does not distinguish them, by design. No session");
  console.error("      exists either way, so the rest of the suite cannot run.");
  console.error("\n      Settle it against the database, not this output:");
  console.error(`        · did an auth.users row appear for ${alice.email}?`);
  console.error("        · did auth_rate_limits gain rows? (the limiter runs before the");
  console.error("          provider call and fails open, so an unreachable DATABASE_URL is");
  console.error("          silent here and invisible to the smoke suite)");
  console.error("");
  console.error('      Note: with "Confirm email" ON, this suite cannot pass at all. Sign-up');
  console.error("      issues no session, and each attempt sends mail — Supabase's built-in");
  console.error("      SMTP allows only a handful per hour, so repeated runs then fail on");
  console.error("      over_email_send_rate_limit rather than on anything this suite asserts.");
  process.exit(3);
}

check("POST /v1/auth/sign-up issues a session (204)", alice.res.status === 204, { status: alice.res.status });
check("access cookie issued", alice.jar.c.has("ab_session"));
check("refresh cookie issued", alice.jar.c.has("ab_session_refresh"));

for (const name of ["ab_session", "ab_session_refresh"]) {
  const attrs = attrsOf(alice.res, name);
  check(`${name} is HttpOnly`, /HttpOnly/i.test(attrs));
  check(`${name} is Secure`, /Secure/i.test(attrs));
  check(`${name} is SameSite=Lax`, /SameSite=Lax/i.test(attrs));
  check(`${name} is scoped to Path=/`, /Path=\//i.test(attrs));
  check(`${name} carries a Max-Age`, /Max-Age=\d+/i.test(attrs));
}

const currentRes = await req("/v1/households/current", { headers: { cookie: alice.jar.header() } });
const household = await currentRes.json().catch(() => null);
check("GET /v1/households/current returns the bootstrapped household", currentRes.status === 200, {
  status: currentRes.status,
});
check("the caller owns it", household?.role === "owner", { role: household?.role });
check("it has an id", typeof household?.id === "string" && household.id.length > 0);
console.error(`      household: ${household?.id} · role=${household?.role} · name=${JSON.stringify(household?.name)}`);
if (alice.res.status !== 204 || !alice.jar.c.has('ab_session') || !alice.jar.c.has('ab_session_refresh')
  || currentRes.status !== 200 || household?.role !== 'owner' || typeof household?.id !== 'string') {
  console.error('STOP: first authenticated household prerequisite failed; dependent acceptance checks were not run.');
  process.exit(1);
}

/* ───────────────────────────── 2. routing and dashboard ───────────────────────────── */

heading("routing · authenticated and anonymous");

for (const path of ["/", "/sign-in", "/sign-up", "/forgot-password"]) {
  const res = await req(path);
  check(`public ${path} is reachable anonymously`, res.status === 200, { status: res.status });
}

for (const path of ["/dashboard", "/obligations", "/settings/privacy", "/onboarding"]) {
  const res = await req(path);
  const location = res.headers.get("location") ?? "";
  check(
    `anonymous ${path} redirects to sign-in`,
    [302, 307, 308].includes(res.status) && /\/sign-in/.test(location),
    { status: res.status },
  );
}

const anonApi = await req("/v1/households/current");
check("anonymous /v1/households/current is 401", anonApi.status === 401, { status: anonApi.status });

for (const path of ["/dashboard", "/obligations", "/settings/privacy", "/onboarding", "/onboarding/census"]) {
  const res = await req(path, { headers: { cookie: alice.jar.header() } });
  check(`authenticated ${path} renders (200, never 500)`, res.status === 200, { status: res.status });
}

/* ─────────────────── 2b. hosted Stripe TEST checkout (no payment) ─────────────────── */

heading("hosted Stripe TEST checkout · session created, then expired; nothing paid or bound");

const billingPath = `/v1/households/${household.id}/billing`;
const ownerJson = { ...JSON_HEADERS, cookie: alice.jar.header() };
const billingStatus = async () => { const r = await req(billingPath, { headers: { cookie: alice.jar.header() } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const before = await billingStatus();
check("billing status is readable by the owner and starts unsubscribed", before.status === 200 && before.json?.subscribed === false && before.json?.state === "none", { status: before.status });
if (!before.json?.checkoutAvailable) {
  if (REQUIRE_BILLING) check("the billing runtime is mounted for checkout on this deployment", false, { checkoutAvailable: before.json?.checkoutAvailable });
  else console.error("      billing runtime not mounted on this deployment: checkout checks skipped (the billing job requires them)");
} else {
  const start = await req(`${billingPath}/checkout`, { method: "POST", headers: ownerJson, body: JSON.stringify({ plan: "monthly", requestId: randomUUID() }) });
  const started = await start.json().catch(() => null);
  let origin = ""; try { origin = new URL(started?.url ?? "").origin; } catch { /* not a URL */ }
  check("checkout returns a Stripe-hosted TEST checkout URL (and nothing else)", start.status === 200 && origin === "https://checkout.stripe.com"
    && Object.keys(started ?? {}).join() === "url", { status: start.status, origin });
  const open = await billingStatus();
  check("the owner's checkout is open and grants nothing yet", open.json?.checkoutOpen === true && open.json?.subscribed === false && open.json?.tier === "free", open.json && { checkoutOpen: open.json.checkoutOpen, tier: open.json.tier });
  const pending = await req(`${billingPath}/confirm`, { method: "POST", headers: ownerJson, body: JSON.stringify({ cancel: false }) });
  const pendingJson = await pending.json().catch(() => null);
  check("returning without paying is not a payment: the session is still open", pending.status === 200 && pendingJson?.status === "pending", { status: pending.status, outcome: pendingJson?.status });
  const cancelled = await req(`${billingPath}/confirm`, { method: "POST", headers: ownerJson, body: JSON.stringify({ cancel: true }) });
  const cancelledJson = await cancelled.json().catch(() => null);
  check("cancelling expires the provider session and abandons the checkout", cancelled.status === 200 && cancelledJson?.status === "abandoned", { status: cancelled.status, outcome: cancelledJson?.status });
  const after = await billingStatus();
  check("after cancel: no binding, no open checkout, still Free", after.json?.subscribed === false && after.json?.checkoutOpen === false && after.json?.tier === "free");
  const portal = await req(`${billingPath}/portal`, { method: "POST", headers: ownerJson, body: "{}" });
  check("no billing portal without a verified subscription", portal.status === 409, { status: portal.status });
  const plan = await req(`${billingPath}/checkout`, { method: "POST", headers: ownerJson, body: JSON.stringify({ plan: "weekly", requestId: randomUUID() }) });
  check("an unknown plan is refused before any provider call", plan.status === 400, { status: plan.status });
}

/* ───────────────────────────── 3. tenant isolation ───────────────────────────── */

heading("authorization · cross-household denial (RLS boundary)");

const bob = await signUp("bob");
check("a second sign-up also succeeds", bob.res.status === 204, { status: bob.res.status });
const bobCurrent = bob.res.status === 204 ? await req("/v1/households/current", { headers: { cookie: bob.jar.header() } }) : null;
const bobHousehold = bobCurrent ? await bobCurrent.json().catch(() => null) : null;
check(
  "the second caller gets a DIFFERENT household",
  typeof bobHousehold?.id === "string" && bobHousehold.id !== household?.id,
);

const stolen = await probeForeignHousehold(req, {
  cookie: alice.jar.header(), ownId: household.id, foreignId: bobHousehold?.id,
  foreignReady: bob.res.status === 204 && bobCurrent?.status === 200,
});
if (stolen) {
  check("selecting another tenant's household is denied", stolen.status === 403, { status: stolen.status });
  const stolenBody = await stolen.text();
  check("the denial leaks nothing about the other tenant", !stolenBody.includes(bob.email));
} else {
  blocked("selecting another tenant's household is denied");
  blocked("the denial leaks nothing about the other tenant");
}

const nonexistent = await req("/v1/households/current", {
  headers: { cookie: alice.jar.header(), "x-household-id": "00000000-0000-0000-0000-000000000000" },
});
check("a nonexistent household is denied identically", nonexistent.status === 403, { status: nonexistent.status });

const malformed = await req("/v1/households/current", {
  headers: { cookie: alice.jar.header(), "x-household-id": "not-a-uuid" },
});
check("a malformed household id is rejected cleanly (no 500)", malformed.status >= 400 && malformed.status < 500, {
  status: malformed.status,
});

const own = await req("/v1/households/current", {
  headers: { cookie: alice.jar.header(), "x-household-id": household?.id ?? "" },
});
check("selecting one's OWN household explicitly still works", own.status === 200, { status: own.status });

/* ───────────────────────────── 4. CSRF ───────────────────────────── */

heading("CSRF");

const foreign = await req("/v1/auth/sign-in", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://evil.example", ...CSRF },
  body: JSON.stringify({ email: alice.email, password: PASSWORD }),
});
check("cross-origin POST is rejected", foreign.status === 403, { status: foreign.status });

const headerless = await req("/v1/auth/sign-in", {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ email: alice.email, password: PASSWORD }),
});
check("same-origin POST without the CSRF header is rejected", headerless.status === 403, {
  status: headerless.status,
});

/* ───────────────────────────── 5. session lifecycle ───────────────────────────── */

heading("session lifecycle");

const signedIn = jar();
const signInRes = signedIn.take(
  await req("/v1/auth/sign-in", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: alice.email, password: PASSWORD }),
  }),
);
check("sign-in with correct credentials succeeds", signInRes.status === 204, { status: signInRes.status });
await diagnose("sign-in(correct password)", signInRes);

const wrong = await req("/v1/auth/sign-in", {
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify({ email: alice.email, password: "definitely-not-the-password" }),
});
check("sign-in with a wrong password is refused", wrong.status === 401, { status: wrong.status });

const forged = await req("/v1/households/current", {
  headers: { cookie: "ab_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciJ9.zzzz" },
});
check("a forged / alg-confusion token is rejected", forged.status === 401, { status: forged.status });

const beforeAccess = signedIn.c.get("ab_session");
const beforeRefresh = signedIn.c.get("ab_session_refresh");
const refreshed = signedIn.take(
  await req("/auth/refresh?next=%2Fdashboard", { headers: { cookie: signedIn.header() } }),
);
check("GET /auth/refresh redirects (303)", refreshed.status === 303, { status: refreshed.status });
check("it returns to the requested destination", (refreshed.headers.get("location") ?? "").endsWith("/dashboard"));
check("the access token was rotated", signedIn.c.get("ab_session") !== beforeAccess);
check("the refresh token was rotated", signedIn.c.get("ab_session_refresh") !== beforeRefresh);

const afterRefresh = await req("/v1/households/current", { headers: { cookie: signedIn.header() } });
check("the rotated session still authenticates", afterRefresh.status === 200, { status: afterRefresh.status });

/*
 * Replaying the rotated-away refresh token.
 *
 * This asserted "the old token is refused" and failed against the real provider, correctly.
 * Supabase's `refresh_token_reuse_interval` (10s by default) deliberately accepts the same
 * refresh token again for a short window and returns the SAME rotated session, so that two
 * concurrent requests racing a refresh do not destroy each other's login. Demanding an
 * immediate refusal asserts against the provider's documented contract rather than against
 * anything this application does.
 *
 * What IS ours is asserted instead: whatever the provider decides, the replay resolves to a
 * safe same-origin destination and never errors. A rotation genuinely broken on our side
 * shows up in the four checks above — the redirect, both tokens changing, and the rotated
 * session still authenticating — every one of which is unconditional.
 */
const replay = await req("/auth/refresh?next=%2Fdashboard", {
  headers: { cookie: `ab_session_refresh=${beforeRefresh}` },
});
const replayTo = replay.headers.get("location") ?? "";
check("replaying the OLD refresh token resolves safely, never 5xx", replay.status === 303, {
  status: replay.status,
});
check(
  "the replay lands on this origin — sign-in or the requested path, never elsewhere",
  replayTo.startsWith(ORIGIN) && (/\/sign-in/.test(replayTo) || replayTo.endsWith("/dashboard")),
  { to: replayTo.replace(ORIGIN, "") || "(none)" },
);

for (const hostile of ["https://evil.example/x", "//evil.example/x"]) {
  const res = await req(`/auth/refresh?next=${encodeURIComponent(hostile)}`, {
    headers: { cookie: signedIn.header() },
  });
  check(`a hostile ?next=${hostile} is not honoured`, !(res.headers.get("location") ?? "").includes("evil.example"));
}

const signedOut = await req("/v1/auth/sign-out", {
  method: "POST",
  headers: { cookie: signedIn.header(), origin: ORIGIN, ...CSRF },
});
check("sign-out is accepted", signedOut.status === 204, { status: signedOut.status });
const cleared = signedOut.headers.getSetCookie?.() ?? [];
check(
  "sign-out clears both session cookies",
  ["ab_session", "ab_session_refresh"].every((n) =>
    cleared.some((c) => c.startsWith(`${n}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)),
  ),
);
signedIn.take(signedOut);

const afterSignOut = await req("/v1/households/current", { headers: { cookie: signedIn.header() } });
check("a protected endpoint refuses the revoked session", afterSignOut.status === 401, {
  status: afterSignOut.status,
});

const reLogin = await req("/v1/auth/sign-in", {
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify({ email: alice.email, password: PASSWORD }),
});
check("re-login after sign-out succeeds", reLogin.status === 204, { status: reLogin.status });

/* ───────────────────────────── 5b. password policy, MFA and recovery (hosted) ───────────── */

heading("authoritative password policy");

// Two refused sign-ups. The policy runs after the limiter, so each spends one `sign_up.ip`
// unit; the budget for the whole run stays at 9 of 10.
for (const [label, password, detail] of [
  ["a predictable password (zxcvbn < 3)", "qwertyuiopasdfgh", /longer, less predictable/i],
  ["a strong-looking but breached passphrase (k-anonymity)", "correcthorsebatterystaple", /known data breaches/i],
]) {
  const email = addressFor(`pw-${label.includes("breached") ? "breached" : "weak"}`);
  const res = await req("/v1/auth/sign-up", { method: "POST", headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Acceptance policy", email, password }) });
  const body = await res.text();
  check(`sign-up refuses ${label}`, res.status === 400 && detail.test(body), { status: res.status });
  const probe = await req("/v1/auth/sign-in", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password }) });
  check(`no account exists after refusing ${label}`, probe.status === 401, { status: probe.status });
}

heading("MFA (hosted provider)");

const mfa = jar();
mfa.take(await req("/v1/auth/sign-in", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: alice.email, password: PASSWORD }) }));
const security = async (body) => {
  const res = await req("/v1/account/security", { method: "POST", headers: { ...JSON_HEADERS, cookie: mfa.header() }, body: JSON.stringify(body) });
  mfa.take(res);
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};
const listed = await security({ action: "list" });
check("the hosted account-security endpoint lists live factors (aal1, none)", listed.status === 200 && listed.json?.level === "aal1" && Array.isArray(listed.json?.factors) && listed.json.factors.length === 0, { status: listed.status, level: listed.json?.level });
const enrolled = await security({ action: "enroll" });
const secret = enrolled.json?.setupSecret, factorId = enrolled.json?.factorId;
check("enrollment returns a factor and a one-time setup secret", enrolled.status === 200 && typeof secret === "string" && /^[A-Z2-7]{16,}$/.test(secret ?? "") && typeof factorId === "string", { status: enrolled.status });
if (typeof secret === "string" && typeof factorId === "string") {
  const challenged = await security({ action: "challenge", factorId });
  check("a challenge is issued and journaled", challenged.status === 200 && typeof challenged.json?.challengeId === "string", { status: challenged.status });
  const code = totp(secret);
  const verified = await security({ action: "verify", factorId, challengeId: challenged.json?.challengeId, code });
  check("TOTP verification establishes the session", verified.status === 200 && verified.json?.verified === true, { status: verified.status });
  const replay = await security({ action: "verify", factorId, challengeId: challenged.json?.challengeId, code });
  check("replaying a consumed challenge is refused", replay.status === 403, { status: replay.status });
  const elevated = await security({ action: "list" });
  check("the session is now AAL2 with a verified factor", elevated.status === 200 && elevated.json?.level === "aal2" && elevated.json?.factors?.some((f) => f.id === factorId && f.status === "verified"), { level: elevated.json?.level });
  const removed = await security({ action: "remove", factorId });
  check("removing the factor succeeds and requires signing in again", removed.status === 200 && removed.json?.removed === true && removed.json?.signInRequired === true, { status: removed.status });
  const again = jar();
  again.take(await req("/v1/auth/sign-in", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: alice.email, password: PASSWORD }) }));
  const after = await req("/v1/account/security", { method: "POST", headers: { ...JSON_HEADERS, cookie: again.header() }, body: JSON.stringify({ action: "list" }) });
  const afterJson = await after.json().catch(() => null);
  check("after re-sign-in the factor is gone (live provider enumeration)", after.status === 200 && afterJson?.factors?.length === 0, { status: after.status });
} else {
  for (const n of ["a challenge is issued and journaled", "TOTP verification establishes the session", "replaying a consumed challenge is refused",
    "the session is now AAL2 with a verified factor", "removing the factor succeeds and requires signing in again",
    "after re-sign-in the factor is gone (live provider enumeration)"]) blocked(n);
}

heading("recovery (hosted, no mail sent)");

// A never-registered address: the provider sends nothing, so no mail bounces from a synthetic domain.
const unknown = await req("/v1/auth/recovery", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: addressFor("recovery-unknown") }) });
check("recovery initiation answers uniformly (202) without revealing account existence", unknown.status === 202, { status: unknown.status });
const bogus = await req("/v1/auth/recovery/complete", { method: "POST", headers: JSON_HEADERS,
  body: JSON.stringify({ tokenHash: "never_issued_synthetic_hash", password: PASSWORD }) });
check("a never-issued recovery token is refused (no 5xx)", bogus.status === 403, { status: bogus.status });
const weakFirst = await req("/v1/auth/recovery/complete", { method: "POST", headers: JSON_HEADERS,
  body: JSON.stringify({ tokenHash: "never_issued_synthetic_hash", password: "correcthorsebatterystaple" }) });
check("a breached new password is refused before any token redemption", weakFirst.status === 403, { status: weakFirst.status });

/* ───────────────────────────── 6. rate limiting (LAST — spends budget) ───────────── */

heading("rate limiting");

const burnEmail = addressFor("ratelimit");
created.push(burnEmail);
const statuses = [];
for (let i = 0; i < 5; i += 1) {
  const res = await req("/v1/auth/sign-up", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Acceptance rl", email: burnEmail, password: PASSWORD }),
  });
  statuses.push(res.status);
}
console.error(`      sign-up attempts on one address: ${statuses.join(" → ")}`);
check("the documented limit (3 / 15 min) is enforced", statuses.includes(429), { statuses });
check(
  "an already-registered address is never distinguishable as an error",
  statuses.slice(0, 3).every((s) => s === 204 || s === 202),
  { first_three: statuses.slice(0, 3) },
);

/* ───────────────────────────── summary ───────────────────────────── */

const failed = results.filter((r) => !r.ok);
console.error(`\n${results.length - failed.length}/${results.length} acceptance checks passed against ${BASE}`);
console.error(`identities created (staging, synthetic): ${created.join(", ")}`);
if (failed.length > 0) {
  console.error("\nfailed:");
  for (const f of failed) console.error(`  ${f.blocked ? 'BLOCKED ' : ''}[${f.section}] ${f.name}`);
}
process.exit(failed.length === 0 ? 0 : 1);
