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
  console.error(`${ok ? "ok  " : "FAIL"}  ${text}${detail === undefined ? "" : `  ${detail}`}`);
  if (!ok) problems.push(text);
};

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
