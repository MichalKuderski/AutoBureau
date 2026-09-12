import { spawnSync } from "node:child_process";

// Only the deployment created by this Preview job. Never fall back to the project,
// its stable domain or another environment when a URL is missing.
const target = process.argv[2];
const parsed = target && new URL(target);
if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !/^autobureau-staging-[a-z0-9-]+\.vercel\.app$/.test(parsed.hostname) || parsed.pathname !== "/") {
  throw new Error("Expected this job's staging Preview deployment URL");
}
const result = spawnSync("vercel", ["logs", "--deployment", target, "--environment", "preview", "--since", "30m",
  "--query", "auth.sign_up_provider_unavailable", "--json", "--limit", "20", "--token", process.env.VERCEL_TOKEN ?? ""], {
  encoding: "utf8", timeout: 30_000, maxBuffer: 512_000,
  env: { ...process.env, VERCEL_TOKEN: process.env.VERCEL_TOKEN },
});
// Never print CLI stderr or an arbitrary raw log. Output is an allowlisted projection
// of our own structured auth record, with numeric status and an opaque trace only.
let found = 0;
function inspect(value, depth = 0) {
  if (depth > 6) return;
  if (!value || typeof value !== "object") return;
  if (value.event === "auth.sign_up_provider_unavailable") {
    const status = value.meta?.upstream_status;
    process.stdout.write(JSON.stringify({ event: value.event,
      ...(typeof value.trace_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trace_id) ? { trace_id: value.trace_id } : {}),
      ...(Number.isInteger(status) && status >= 100 && status < 600 ? { upstream_status: status } : {}),
    }) + "\n");
    found += 1;
  }
  for (const key of ["message", "logs", "entries"]) {
    const nested = value[key];
    if (typeof nested === "string") { try { inspect(JSON.parse(nested), depth + 1); } catch { /* not an application record */ } }
    else if (Array.isArray(nested)) for (const entry of nested) inspect(entry, depth + 1);
  }
}
for (const line of (result.stdout ?? "").split("\n")) { try { inspect(JSON.parse(line)); } catch { /* CLI progress, not a record */ } }
process.stdout.write(JSON.stringify({ diagnostic: "preview_auth", records: found, cli_succeeded: result.status === 0 }) + "\n");
