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
 * deployment. Every identity it creates is prefixed `acc-` and addressed at a domain that
 * receives no mail, and doc 09 §1 already fixes staging as synthetic-only. It never runs
 * against production: the workflow only ever hands it a preview URL.
 *
 * ORDERING IS LOAD-BEARING. The rate-limit section is last because it deliberately spends
 * the per-address budget, and `sign_up.ip` is shared by every sign-up in the run. Moving it
 * earlier would make later sections fail for a reason that has nothing to do with them.
 */

const BASE = (process.argv[2] ?? process.env.ACCEPTANCE_BASE_URL ?? "").replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const BYPASS_HEADERS = BYPASS === "" ? {} : { "x-vercel-protection-bypass": BYPASS };

if (!BASE || !URL.canParse(BASE) || new URL(BASE).hostname === "") {
  console.error(`usage: node scripts/staging-acceptance.mjs <base-url>  (got ${JSON.stringify(BASE)})`);
  process.exit(2);
}

/** The deployment's own origin — what `APP_ORIGIN` derives to, so CSRF should accept it. */
const ORIGIN = new URL(BASE).origin;
const CSRF = { "x-autobureau-request": "1" };
const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN, ...CSRF };
const PASSWORD = "Correct-Horse-Battery-77";

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
const addressFor = (tag) => `acc-${tag}-${stamp}@autobureau-staging.invalid`;
const created = [];

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
  created.push(email);
  return { email, jar: j, res };
}

/* ───────────────────────────── 1. sign-up and bootstrap ───────────────────────────── */

heading("sign-up → identity → household bootstrap");

const alice = await signUp("alice");
const confirmationRequired = alice.res.status === 202;
console.error(
  `      provider mode: ${confirmationRequired ? "CONFIRMATION REQUIRED (202)" : "session issued (204)"}`,
);

if (confirmationRequired) {
  const body = await alice.res.clone().json().catch(() => null);
  check("sign-up returns 202 confirmation-required", body?.status === "confirmation-required", body);
  check(
    "no session cookies are issued before confirmation",
    !(alice.res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("ab_session")),
  );
  console.error("\nSTOP: this deployment requires email confirmation, so no session can be");
  console.error("      established from here. The rest of the suite needs a signed-in caller.");
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

/* ───────────────────────────── 3. tenant isolation ───────────────────────────── */

heading("authorization · cross-household denial (RLS boundary)");

const bob = await signUp("bob");
check("a second sign-up also succeeds", bob.res.status === 204, { status: bob.res.status });
const bobHousehold = await (
  await req("/v1/households/current", { headers: { cookie: bob.jar.header() } })
).json().catch(() => null);
check(
  "the second caller gets a DIFFERENT household",
  typeof bobHousehold?.id === "string" && bobHousehold.id !== household?.id,
);

const stolen = await req("/v1/households/current", {
  headers: { cookie: alice.jar.header(), "x-household-id": bobHousehold?.id ?? "" },
});
check("selecting another tenant's household is denied", stolen.status === 403, { status: stolen.status });
const stolenBody = await stolen.text();
check("the denial leaks nothing about the other tenant", !stolenBody.includes(bob.email));

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

const replay = await req("/auth/refresh?next=%2Fdashboard", {
  headers: { cookie: `ab_session_refresh=${beforeRefresh}` },
});
check(
  "replaying the OLD refresh token is refused",
  replay.status === 303 && /\/sign-in/.test(replay.headers.get("location") ?? ""),
  { status: replay.status },
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
  for (const f of failed) console.error(`  [${f.section}] ${f.name}`);
}
process.exit(failed.length === 0 ? 0 : 1);
