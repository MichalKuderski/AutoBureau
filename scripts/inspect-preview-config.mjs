/**
 * What configuration did this deployment actually receive?
 *
 * A 17/17 smoke run and a Doppler dashboard reading "In Sync" can both be true while the
 * deployment holds configuration for the wrong backend. That happened: the boundary came up
 * configured — sign-in answered 401 rather than 503, so all seven values were present — and
 * yet no `auth.users` row appeared in the staging project and `auth_rate_limits` had never
 * received a single row, across five limiter writes that should have landed. Values present,
 * pointing somewhere else.
 *
 * Nothing in a response can distinguish those two worlds. The limiter runs before the
 * provider call and fails OPEN by design, so a database this deployment cannot reach is
 * silent in every HTTP status the smoke suite looks at. So this reads the environment
 * `vercel pull` produced and asserts the one property no status code carries: that every
 * value names the SAME Supabase project.
 *
 * WHAT IT PRINTS, AND WHAT IT NEVER PRINTS
 * ----------------------------------------
 * Only derived structure — hostnames, ports, a database name, and the project ref a value
 * refers to. Never a password, never a key, never a connection string, not even a length.
 * A project ref is a public identifier that appears in every Supabase URL; a password is
 * not, so the password is reported as present/absent and nothing more.
 *
 * These values are NOT registered GitHub secrets — they arrive from Doppler through Vercel
 * at pull time — so Actions' log masking does not apply to them. Everything printed here is
 * printed because it was deliberately constructed to be safe, not because a filter would
 * catch a mistake.
 */

import { readFileSync, existsSync } from "node:fs";

const CANDIDATES = [".vercel/.env.preview.local", ".vercel/.env.development.local", ".vercel/.env.local"];
const REQUIRED = [
  "AUTH_ISSUER",
  "AUTH_AUDIENCE",
  "AUTH_JWKS_URL",
  "AUTH_API_URL",
  "AUTH_ANON_KEY",
  "AUTH_COOKIE_NAME",
  "DATABASE_URL",
];
/** Derived per deployment (doc 09 §9.3), so its absence from the pulled file is correct. */
const DERIVED = ["APP_ORIGIN"];

const source = CANDIDATES.find((p) => existsSync(p));
if (source === undefined) {
  console.error("FAIL  no pulled Vercel environment file found");
  console.error(`      looked for: ${CANDIDATES.join(", ")}`);
  console.error("      `vercel pull` must run before this step");
  process.exit(1);
}
console.error(`pulled environment: ${source}\n`);

/** Minimal dotenv: `KEY=value`, optionally quoted. Values are never echoed. */
const env = new Map();
for (const line of readFileSync(source, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env.set(trimmed.slice(0, eq).trim(), value);
}

const problems = [];
const refs = new Map();
const note = (ok, text, detail) => {
  console.error(`${ok ? "ok  " : "warn"}  ${text}${detail === undefined ? "" : `  ${detail}`}`);
  if (!ok) problems.push(text);
};

/**
 * Can this file's values be read at all?
 *
 * A variable marked **Sensitive** in Vercel is write-only: the platform will inject it into
 * the running function but will not hand it back, so `vercel pull` writes something opaque
 * in its place. Every value is then simultaneously present and unparseable — which is
 * exactly the shape this check first produced, and it says nothing whatever about the
 * deployment.
 *
 * Detecting that up front matters more than any assertion below it, because the alternative
 * is a report that reads like a misconfiguration when the real finding is "this surface
 * cannot answer the question". Where the runtime values point has to be established from
 * somewhere the runtime touched — the provider's own logs, or rows in the expected database.
 */
const hasScheme = (value, schemes) =>
  URL.canParse(value) && schemes.includes(new URL(value).protocol.replace(":", "").toLowerCase());

const readable = REQUIRED.filter((k) => {
  const v = env.get(k);
  if (v === undefined || v === "") return false;
  // These two are short free-form strings with no shape to check, so they can never
  // distinguish a real value from an opaque one and must not vote on readability.
  if (k === "AUTH_AUDIENCE" || k === "AUTH_COOKIE_NAME") return false;
  if (k === "DATABASE_URL") return hasScheme(v, ["postgres", "postgresql"]);
  if (k === "AUTH_ANON_KEY") return v.startsWith("sb_publishable_") || v.split(".").length === 3;
  return hasScheme(v, ["http", "https"]);
});
const OPAQUE = readable.length === 0;

/* ── presence ─────────────────────────────────────────────────────────────────── */

console.error("── presence ──────────────────────────────────────────────────");
for (const key of REQUIRED) {
  const value = env.get(key);
  const present = value !== undefined && value !== "";
  note(present, `${key} is present`);
}
for (const key of DERIVED) {
  const present = env.get(key) !== undefined && env.get(key) !== "";
  console.error(
    present
      ? `warn  ${key} is SET on preview — it should be unset so it derives from VERCEL_URL (doc 09 §9.3)`
      : `ok    ${key} is correctly unset (derived from VERCEL_URL on preview)`,
  );
}

if (OPAQUE) {
  console.error("\n── values are not readable here ──────────────────────────────");
  console.error("      Every required variable is PRESENT and none is parseable as its own type.");
  console.error("      That is the signature of Vercel 'Sensitive' variables: write-only, so");
  console.error("      `vercel pull` cannot hand back what it will inject at runtime.");
  console.error("");
  console.error("      This is not evidence of a misconfiguration, and this step cannot");
  console.error("      produce any. Establish where the runtime actually points from a surface");
  console.error("      the runtime touched:");
  console.error("        · the Supabase project's auth logs — did /signup and /token arrive?");
  console.error("        · auth_rate_limits — the limiter writes BEFORE the provider call and");
  console.error("          fails open, so an empty table means the database was unreachable");
  console.error("          while every HTTP status looked healthy.");
  console.error("\nnothing further can be asserted from the pulled file");
  process.exit(0);
}

/* ── which project does each value name? ──────────────────────────────────────── */

console.error("\n── project identity ──────────────────────────────────────────");

/** `https://<ref>.supabase.co/...` → `<ref>`. Public information, in every Supabase URL. */
function refFromSupabaseHost(hostname) {
  const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/i.exec(hostname);
  return m?.[1];
}

for (const key of ["AUTH_ISSUER", "AUTH_JWKS_URL", "AUTH_API_URL"]) {
  const value = env.get(key);
  if (!value) continue;
  if (!URL.canParse(value)) {
    note(false, `${key} is a parseable URL`);
    continue;
  }
  const { hostname } = new URL(value);
  const ref = refFromSupabaseHost(hostname);
  console.error(`      ${key} → host ${hostname}${ref ? ` (project ${ref})` : " (not a Supabase host)"}`);
  if (ref) refs.set(key, ref);
}

/**
 * The anon key is a JWT whose payload names the project it belongs to. Only the `ref` and
 * `role` claims are read; the key itself is never printed. A modern `sb_publishable_…` key
 * carries no readable ref, which is reported rather than guessed at.
 */
const anon = env.get("AUTH_ANON_KEY");
if (anon) {
  if (anon.startsWith("sb_publishable_")) {
    console.error("      AUTH_ANON_KEY → modern publishable key (carries no readable project ref)");
  } else {
    try {
      const payload = JSON.parse(Buffer.from(anon.split(".")[1], "base64url").toString("utf8"));
      console.error(`      AUTH_ANON_KEY → project ${payload.ref} (role ${payload.role})`);
      if (typeof payload.ref === "string") refs.set("AUTH_ANON_KEY", payload.ref);
      note(payload.role === "anon", "AUTH_ANON_KEY carries the anon role (never service_role)", `role=${payload.role}`);
    } catch {
      console.error("      AUTH_ANON_KEY → unreadable as a JWT");
    }
  }
}

/* ── the database ─────────────────────────────────────────────────────────────── */

console.error("\n── database ──────────────────────────────────────────────────");
const dbUrl = env.get("DATABASE_URL");
if (dbUrl) {
  if (!URL.canParse(dbUrl)) {
    note(false, "DATABASE_URL is a parseable connection URL");
  } else {
    const u = new URL(dbUrl);
    const database = u.pathname.replace(/^\//, "");
    console.error(`      scheme   ${u.protocol.replace(":", "")}`);
    console.error(`      host     ${u.hostname}`);
    console.error(`      port     ${u.port || "(default)"}`);
    console.error(`      database ${database || "(none)"}`);
    console.error(`      password ${u.password ? "present" : "ABSENT"}`);

    // Supabase poolers take the project ref as a suffix on the role: `app_user.<ref>`.
    const user = decodeURIComponent(u.username);
    const dbRef = /\.([a-z0-9]{20})$/i.exec(user)?.[1];
    console.error(`      role     ${dbRef ? `names project ${dbRef}` : "carries no project ref suffix"}`);
    if (dbRef) refs.set("DATABASE_URL", dbRef);

    note(u.password !== "", "DATABASE_URL carries a password");
    note(
      /pooler\.supabase\.com$/i.test(u.hostname),
      "DATABASE_URL uses the Supabase pooler host (serverless requires it, doc 09 §9.4)",
      u.hostname,
    );
    note(u.port === "6543", "DATABASE_URL uses the transaction pooler port 6543", u.port || "(default)");
    note(!/^postgres$/i.test(user), "DATABASE_URL is NOT the postgres superuser", dbRef ? "app role" : user);

    /*
     * `?pgbouncer=true` is not a tuning preference on port 6543 — it is what makes Prisma
     * usable there at all. Transaction pooling hands a different backend to each statement,
     * so Prisma's prepared statements do not survive between them and every query fails.
     *
     * The failure is invisible from outside, which is why it is asserted here. The limiter
     * is the first thing to touch the database on the auth path and it fails OPEN by
     * design, so a connection that authenticates and then cannot execute produces no error
     * in any response, no pooler auth failure in the logs, and a perfect smoke score — with
     * an empty `auth_rate_limits` as the only trace. `.env.example` §119 spells the whole
     * string out; the two parameters are the half most easily dropped when a connection
     * string is assembled by hand.
     */
    note(
      u.searchParams.get("pgbouncer") === "true",
      "DATABASE_URL sets ?pgbouncer=true (required by Prisma on the transaction pooler)",
      u.searchParams.get("pgbouncer") ?? "(absent)",
    );
    note(
      u.searchParams.get("connection_limit") === "1",
      "DATABASE_URL sets &connection_limit=1 (one handle per serverless instance)",
      u.searchParams.get("connection_limit") ?? "(absent)",
    );
  }
}

/* ── the whole point: do they agree? ──────────────────────────────────────────── */

console.error("\n── agreement ─────────────────────────────────────────────────");
const distinct = [...new Set(refs.values())];
for (const [key, ref] of refs) console.error(`      ${key.padEnd(14)} → ${ref}`);
note(
  distinct.length <= 1,
  "every configured value names the SAME Supabase project",
  distinct.length > 1 ? `found ${distinct.length}: ${distinct.join(", ")}` : distinct[0] ?? "(none resolvable)",
);

console.error("");
if (problems.length > 0) {
  console.error(`${problems.length} configuration problem(s):`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.error("preview configuration is internally consistent");
