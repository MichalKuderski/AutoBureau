/**
 * TEMPORARY. Delete once the staging migration credential resolves.
 *
 * What non-secret structure does a connection string actually have?
 *
 * Three staging runs failed with a byte-identical `P1000 ... credentials for `postgres``,
 * across a correction to the repository secret that was supposed to add the
 * `.kdqnfruwgocfqwpbpuxo` suffix Supavisor needs to resolve a tenant. Prisma echoes the
 * username in full — a dotted username comes back dotted, checked directly — so the value
 * the runner received still lacks it. But that is a reading of an error message about a
 * value nobody has looked at, and the surviving hypotheses (repository versus organization
 * scope, an edit that did not persist, a reserved character shifting the fields) are
 * indistinguishable from outside the runner.
 *
 * WHAT IT PRINTS
 * --------------
 * Presence, scheme, username, whether that username carries the project ref, host, port,
 * database, and the NAMES of any query parameters. A project ref appears in every Supabase
 * URL and a role name is not a credential; both are safe to name.
 *
 * WHAT IT NEVER PRINTS
 * --------------------
 * The password — not its value, not its length, and not a digest. A truncated hash of the
 * whole URL was the obvious way to answer "did this value change between runs" and is
 * deliberately absent: every other field is already in the log, so the password would be
 * the digest's only unknown, and anyone holding the log could brute-force it offline.
 * Whether one is present is the only thing recorded.
 *
 * These values are not registered GitHub secrets in the log-masking sense once decomposed,
 * so nothing here is printed because a filter would catch a mistake. It is printed because
 * it was chosen to be safe.
 */

const label = process.argv[2] ?? "connection string";
const raw = process.env["DATABASE_URL"];
const say = (k, v) => console.error(`  ${k.padEnd(30)} ${v}`);

console.error(`── ${label}, structure only ──`);

if (raw === undefined || raw === "") {
  say("present", "NO — unset or empty");
  console.error("\n  The secret did not reach this step at all.");
  process.exit(0);
}
say("present", "yes");

let url;
try {
  url = new URL(raw);
} catch {
  say("parseable as a URL", "NO");
  console.error("\n  Present but not decomposable. An unencoded reserved character in the");
  console.error("  password (@ : / ? # %) will do this, and can shift every field after it.");
  process.exit(0);
}
say("parseable as a URL", "yes");

// decodeURIComponent: a percent-encoded username would otherwise read here as something
// different from what the server is actually offered.
const username = decodeURIComponent(url.username);
const REF = ".kdqnfruwgocfqwpbpuxo";

say("scheme", url.protocol.replace(":", ""));
say("username", username === "" ? "(empty)" : username);
say(`username carries ${REF}`, username.includes(REF) ? "YES" : "NO");
say("password", url.password === "" ? "ABSENT" : "present (never printed)");
say("hostname", url.hostname);
say("port", url.port === "" ? "(default)" : url.port);
say("database", url.pathname.replace(/^\//, "") || "(none)");
const names = [...url.searchParams.keys()];
say("query parameter names", names.length > 0 ? names.join(", ") : "(none)");
