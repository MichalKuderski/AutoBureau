#!/usr/bin/env node
/**
 * Billing-runtime smoke (ADR-020 hosted amendment). Proves the deployed TEST billing runtime
 * is ready and refuses everything unauthenticated, without any credential of its own:
 * readiness 200, an unsigned webhook 400, an unsigned internal call 401, a recheck without the
 * cron bearer 404, and no other path served. It sends no provider data and creates nothing.
 *
 *   node scripts/smoke-billing-runtime.mjs https://<billing-host>
 */
export const CHECKS = [
  { name: "readiness", path: "/v1/stripe-test/health", method: "GET", expect: 200, body: b => b?.runtime === "billing-test" && b?.ready === true },
  { name: "unsigned webhook refused", path: "/v1/stripe-test/webhook", method: "POST", expect: 400, payload: "{}" },
  { name: "unsigned internal call refused", path: "/v1/stripe-test/internal/portal", method: "POST", expect: 401, payload: "{}" },
  { name: "unknown internal operation", path: "/v1/stripe-test/internal/nope", method: "POST", expect: 404, payload: "{}" },
  { name: "recheck without bearer", path: "/v1/stripe-test/recheck", method: "GET", expect: 404 },
  { name: "no page is served", path: "/", method: "GET", expect: 404 },
];

export async function smoke(base, fetchImpl = fetch) {
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("https origin only");
  const results = [];
  for (const c of CHECKS) {
    let ok, status = 0;
    try {
      const r = await fetchImpl(new URL(c.path, origin), { method: c.method, redirect: "manual", signal: AbortSignal.timeout(15000),
        headers: c.payload ? { "content-type": "application/json" } : {}, ...(c.payload ? { body: c.payload } : {}) });
      status = r.status;
      const text = await r.text();
      let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
      ok = status === c.expect && (!c.body || c.body(body)) && r.headers.get("x-powered-by") === null && r.headers.get("cache-control")?.includes("no-store") === true;
    } catch { ok = false; }
    results.push({ name: c.name, expect: c.expect, status, ok });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await smoke(process.argv[2] ?? "");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (expected ${r.expect}, got ${r.status})`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} billing-runtime checks passed`);
  process.exit(failed ? 1 : 0);
}
