/** Optional loopback-only regression using the real dashboard shell with synthetic read responses.
 * Requires installed Playwright/Chromium; never accepts a hosted URL or credentials.
 * See docs/engineering/auth-availability.md for invocation and limitations. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, symlink, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(join(tmpdir(), "pellum-billing-browser-"));
const web = join(repo, "apps/web"), next = join(web, "node_modules/next/dist/bin/next");
const files = {
  "package.json": JSON.stringify({ private: true }),
  "next.config.js": "module.exports={experimental:{cpus:1}};",
  "jsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: join(web, "src"), paths: { "@/*": ["*"] } } }),
  "app/layout.jsx": `export default function Root({children}){return <html><body>{children}</body></html>}`,
  "app/page.jsx": `"use client";
import {useState,useEffect} from 'react';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/components/layout/app-shell';import {DashboardScreen} from '@/app/(app)/dashboard/dashboard-screen';
import {CommandPalette} from '@/components/patterns/command-palette';import {BillingSettings} from '@/app/(app)/settings/billing/billing-settings';
import {HouseholdProvider} from '@/providers/household-provider';import {ThemeProvider} from '@/providers/theme-provider';import {ToastProvider} from '@/components/ui/toast';import {HOUSEHOLD,VIEWER} from '@/lib/domain/fixtures';
export default function Page(){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:30000,retry:2,retryDelay:0,refetchOnWindowFocus:false}}}));useEffect(()=>{window.__fixtureClient=client},[client]);return <QueryClientProvider client={client}><ThemeProvider><HouseholdProvider household={{...HOUSEHOLD,id:'synthetic-household',role:'owner'}} viewer={VIEWER}><ToastProvider><AppShell><DashboardScreen/><BillingSettings/></AppShell><CommandPalette/></ToastProvider></HouseholdProvider></ThemeProvider></QueryClientProvider>}`,
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(dirname(join(fixture, path)), { recursive: true });
  await writeFile(join(fixture, path), content);
}
await symlink(join(web, "node_modules"), join(fixture, "node_modules"), "dir");
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const build = spawn(process.execPath, [next, "build"], { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
let buildLog = "";
build.stdout.on("data", c => { buildLog += c; });
build.stderr.on("data", c => { buildLog += c; });
const [buildCode] = await once(build, "exit");
await writeFile(join(fixture, "build.log"), buildLog);
assert.equal(buildCode, 0, `Fixture build failed; see ${fixture}/build.log`);
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(r => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", c => { serverLog += c; });
server.stderr.on("data", c => { serverLog += c; });
let browser;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* loopback startup */ }
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, "Loopback fixture did not start");
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-background-networking"] });
  async function scenario(name, test) {
    const context = await browser.newContext(), blocked = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blocked.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    const page = await context.newPage(), requests = [];
    page.on("request", r => requests.push({ path: new URL(r.url()).pathname, method: r.method(), type: r.resourceType() }));
    try {
      await test({ context, page, requests });
      assert.deepEqual(blocked, [], "Unexpected non-loopback request");
      results.push({ name, outcome: "passed" });
      console.warn(`PASS ${name}`);
    } finally { await context.close(); }
  }
  await scenario("billing failure, concurrent refresh/search, explicit recovery and billing OFF", async ({page}) => {
    let active = 0, peak = 0, billingCalls = 0, failing = true;
    const reads = [];
    await page.route(`${origin}/v1/**`, async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET');
      assert.equal(request.headers()['x-household-id'], 'synthetic-household');
      reads.push(url.pathname + url.search); active++; peak = Math.max(peak, active);
      const isBilling = url.pathname.endsWith('/billing');
      if (isBilling) billingCalls++;
      const status = isBilling && failing ? 500 : 200;
      const body = status === 500 ? {type:'https://example.test/unavailable',title:'Unavailable',status:500}
        : isBilling ? {tier:'free',state:'none',cadence:null,paidThrough:null,premiumUntil:null,testMode:false,subscribed:false,checkoutOpen:false,paymentUpdateAvailable:false,checkoutAvailable:false}
        : url.pathname === '/v1/dashboard' ? {action_needed:0,upcoming_30d:0,needs_review:0,items_tracked:7,coverage:{expected:null,captured:0},next_digest_at:null}
        : {data:[],next_cursor:null};
      await new Promise(r => setTimeout(r, 150));
      active--;
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(origin);
    await page.getByText('Billing status unavailable', {exact:true}).waitFor();
    await page.waitForFunction(() => window.__fixtureClient?.isFetching() === 0);
    assert.equal(reads.length, 5); assert.equal(billingCalls, 1);
    await page.getByText('No saved deadlines in the next 45 days', {exact:true}).waitFor();
    assert.equal(await page.getByRole('button', {name:/update payment|cancel subscription/i}).count(), 0);
    failing = false;
    await page.evaluate(() => {
      void window.__fixtureClient.refetchQueries({predicate:q=>q.queryKey.at(-1)!=='billing'});
      const button = [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Retry billing status'));
      button.click(); button.click();
      window.dispatchEvent(new CustomEvent('autobureau:open-command-palette'));
    });
    await page.getByRole('combobox').fill('passport');
    await page.waitForFunction(() => window.__fixtureClient.isFetching() === 0);
    assert.equal(billingCalls, 2); assert.equal(reads.length, 11); assert.equal(peak, 1);
    assert.ok(reads.some(p=>p.includes('q=passport')));
    assert.equal(await page.getByText('Billing status unavailable', {exact:true}).count(), 0);
    assert.equal(await page.getByRole('button', {name:/update payment|cancel subscription/i}).count(), 0);
  });
} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await writeFile(join(fixture, 'server.log'), serverLog);
  await writeFile(join(fixture, 'results.json'), JSON.stringify(results, null, 2));
  console.warn(`Synthetic evidence: ${fixture}`);
}
assert.equal(results.length, 1);
const nextVersion = JSON.parse(await readFile(join(web, 'node_modules/next/package.json'), 'utf8')).version;
console.warn(`All ${results.length} scenarios passed with Next ${nextVersion}; not hosted auth/DB acceptance.`);
