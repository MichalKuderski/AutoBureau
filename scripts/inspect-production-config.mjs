/**
 * TEMPORARY — pre-cutover verification. Delete once production configuration is settled.
 *
 * Answers three questions that cannot be answered from outside a runner, and answers them
 * WITHOUT deploying anything, connecting to any database, or printing any value that is not
 * already public.
 *
 *   1. `secrets.PRODUCTION_MIGRATION_DATABASE_URL` — what is its structure, and does its
 *      username carry the PRODUCTION project ref rather than staging's?
 *   2. `vercel pull --environment=production` — which Vercel project did `VERCEL_PROJECT_ID`
 *      actually resolve to, and which variable NAMES arrived in that project's Production
 *      scope?
 *   3. Do the auth URLs in that scope name the production Supabase project, or staging's?
 *
 * WHAT IT PRINTS
 * --------------
 * Structure and public identifiers only: schemes, usernames, hostnames, ports, database
 * names, query-parameter NAMES, variable NAMES, and Supabase project refs. A project ref
 * appears in every Supabase URL and a role name is not a credential.
 *
 * WHAT IT NEVER PRINTS
 * --------------------
 * No password — not its value, not its length, not a digest. No key, no token, no full
 * connection string. A truncated hash of a whole URL is deliberately absent: every other
 * field is already in the log, so the password would be the digest's only unknown and anyone
 * holding the log could brute-force it offline.
 *
 * This never opens a network connection to any database. It reads strings and decomposes
 * them. `vercel pull` is the one network call, and it is read-only.
 */

import { readFileSync, existsSync } from "node:fs";

const PROD_REF = "hdoknvqnjyttondgidvi";
const STAGING_REF = "kdqnfruwgocfqwpbpuxo";

const say = (k, v) => console.error(`  ${String(k).padEnd(34)} ${v}`);
const rule = (t) => console.error(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);

let problems = 0;
const bad = (msg) => {
  problems += 1;
  console.error(`  FAIL  ${msg}`);
};

/** Decompose one connection string. Never touches the network. */
function describeConnection(label, raw, expect) {
  rule(label);
  if (raw === undefined || raw === "") {
    say("present", "NO — unset or empty");
    bad(`${label} did not reach this step`);
    return;
  }
  say("present", "yes");

  let url;
  try {
    url = new URL(raw);
  } catch {
    say("parseable as a URL", "NO");
    bad(`${label} is present but not decomposable (an unencoded reserved character?)`);
    return;
  }

  const username = decodeURIComponent(url.username);
  const names = [...url.searchParams.keys()];

  say("scheme", url.protocol.replace(":", ""));
  say("username", username === "" ? "(empty)" : username);
  say("password", url.password === "" ? "ABSENT" : "present (never printed)");
  say("hostname", url.hostname);
  say("port", url.port === "" ? "(default)" : url.port);
  say("database", url.pathname.replace(/^\//, "") || "(none)");
  say("query parameter names", names.length > 0 ? names.join(", ") : "(none)");

  // Which tenant does the role name claim?
  if (username.includes(`.${STAGING_REF}`)) bad(`${label} names the STAGING project — must be production`);
  else if (username.includes(`.${PROD_REF}`)) say("tenant suffix", `production (.${PROD_REF})`);
  else bad(`${label} username carries no recognisable project ref — Supavisor needs .<ref>`);

  if (expect === "migration") {
    if (!username.startsWith("postgres.")) bad("migration role should be postgres.<ref>");
    if (url.port !== "5432") bad(`migration connection should use port 5432 (session mode), saw ${url.port || "(default)"}`);
    if (names.includes("pgbouncer")) bad("migration connection must NOT set pgbouncer=true");
    if (names.includes("connection_limit")) bad("migration connection must NOT set connection_limit");
  }
  if (expect === "runtime") {
    if (!username.startsWith("app_user.")) bad("runtime role should be app_user.<ref>");
    if (url.port !== "6543") bad(`runtime connection should use port 6543 (transaction mode), saw ${url.port || "(default)"}`);
    if (url.searchParams.get("pgbouncer") !== "true") bad("runtime connection must set pgbouncer=true");
    if (url.searchParams.get("connection_limit") !== "1") bad("runtime connection must set connection_limit=1");
  }
}

/** Minimal dotenv. Values are decomposed, never echoed. */
function readPulled(path) {
  const env = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env.set(t.slice(0, eq).trim(), v);
  }
  return env;
}

function refOfSupabaseHost(hostname) {
  return /^([a-z0-9]{20})\.supabase\.(co|in)$/i.exec(hostname)?.[1];
}

const mode = process.argv[2];

if (mode === "migration-secret") {
  describeConnection("secrets.PRODUCTION_MIGRATION_DATABASE_URL", process.env["DATABASE_URL"], "migration");
} else if (mode === "pulled-scope") {
  const REQUIRED = [
    "AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL", "AUTH_API_URL", "AUTH_ANON_KEY",
    "AUTH_COOKIE_NAME", "DATABASE_URL", "APP_ORIGIN", "SENTRY_DSN",
  ];
  const candidates = [".vercel/.env.production.local", ".vercel/.env.local"];
  const src = candidates.find((p) => existsSync(p));

  rule("Vercel Production scope — variable NAMES only");
  if (src === undefined) {
    bad("no pulled environment file found — `vercel pull` did not produce one");
    process.exit(problems > 0 ? 1 : 0);
  }
  console.error(`  source: ${src}\n`);

  const env = readPulled(src);

  // Three states, not two. `vercel pull` writes "[SENSITIVE]" in place of a value it may not
  // hand back, so a key present-but-unreadable is configured correctly and simply cannot be
  // asserted on here. Collapsing that into "present" would overstate what was verified;
  // collapsing it into "missing" would raise a false alarm. It is reported as itself.
  const SENSITIVE = /^\[SENSITIVE\]$/i;
  for (const key of REQUIRED) {
    const v = env.get(key);
    if (v === undefined || v === "") {
      say(key, "ABSENT — the key is not in this scope at all");
      bad(`${key} is absent from the Production scope`);
    } else if (SENSITIVE.test(v.trim())) {
      say(key, "present, value withheld (Sensitive)");
    } else {
      say(key, "present and readable");
    }
  }

  // Doppler stamps its own source into every scope it syncs. These are identifiers, not
  // credentials, and they answer the question the sync UI cannot: which config landed here.
  rule("Which Doppler config synced into this scope?");
  for (const key of ["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"]) {
    const v = env.get(key);
    say(key, v === undefined || v === "" ? "(absent — no Doppler sync stamp)" : v);
  }
  const cfg = (env.get("DOPPLER_CONFIG") ?? "").trim();
  if (cfg !== "" && /stg|stag/i.test(cfg)) bad(`the STAGING Doppler config (${cfg}) is synced into the production scope`);

  const extra = [...env.keys()].filter((k) => !REQUIRED.includes(k) && !k.startsWith("VERCEL_") && !k.startsWith("DOPPLER_"));
  if (extra.length > 0) console.error(`\n  other names present: ${extra.sort().join(", ")}`);

  rule("Which Supabase project do the auth values name?");
  let opaque = 0;
  for (const key of ["AUTH_ISSUER", "AUTH_JWKS_URL", "AUTH_API_URL"]) {
    const v = env.get(key);
    if (!v) continue;
    if (!URL.canParse(v)) { say(key, "not readable here (Sensitive values are write-only)"); opaque += 1; continue; }
    const host = new URL(v).hostname;
    const ref = refOfSupabaseHost(host);
    say(key, `host ${host}${ref ? ` → project ${ref}` : ""}`);
    if (ref === STAGING_REF) bad(`${key} names the STAGING project`);
  }
  if (opaque > 0) {
    console.error("\n  Some values are marked Sensitive in Vercel, so `vercel pull` returns them");
    console.error("  unreadable. That is not a misconfiguration and this step cannot assert on them;");
    console.error("  the names above are still authoritative.");
  }

  const appOrigin = env.get("APP_ORIGIN");
  if (appOrigin && URL.canParse(appOrigin)) {
    rule("APP_ORIGIN");
    say("hostname", new URL(appOrigin).hostname);
  }

  const dbUrl = env.get("DATABASE_URL");
  if (dbUrl && URL.canParse(dbUrl)) describeConnection("DATABASE_URL (runtime)", dbUrl, "runtime");
} else {
  console.error("usage: node scripts/inspect-production-config.mjs <migration-secret|pulled-scope>");
  process.exit(2);
}

console.error("");
if (problems > 0) {
  console.error(`${problems} problem(s) found — see FAIL lines above.`);
  process.exit(1);
}
console.error("no structural problems found");
