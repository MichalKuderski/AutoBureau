/** Optional loopback-only regression using the real form with synthetic auth/data.
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
const fixture = await mkdtemp(join(tmpdir(), "pellum-sign-in-browser-"));
const web = join(repo, "apps/web"), next = join(web, "node_modules/next/dist/bin/next");
const files = {
  "package.json": JSON.stringify({ private: true }),
  "next.config.js": "module.exports={experimental:{cpus:1}};",
  "jsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: join(web, "src"), paths: { "@/*": ["*"] } } }),
  "app/layout.jsx": `import {Providers} from './providers';export default function Root({children}){return <html><body><Providers>{children}</Providers></body></html>}`,
  "app/providers.jsx": `"use client";
import {useState,useEffect} from 'react';import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
export function Providers({children}){const [client]=useState(()=>new QueryClient());useEffect(()=>{window.__probeBoot=crypto.randomUUID()},[]);return <QueryClientProvider client={client}>{children}</QueryClientProvider>}
export function Cached(){const q=useQuery({queryKey:['fixture-session'],queryFn:()=>fetch('/identity').then(r=>r.json()),staleTime:Infinity});return <p data-testid="cached">{q.data?.marker??'loading'}</p>}`,
  "app/page.jsx": `import Link from 'next/link';export default function Page(){return <><h1>Anchor</h1><Link href="/sign-in?next=%2Fdashboard%3Fview%3Dupcoming" prefetch={false}>Open sign-in</Link></>}`,
  "app/sign-in/page.jsx": `import {SignInForm} from '@/app/(auth)/sign-in/sign-in-form';import {Cached} from '../providers';export default async function Page({searchParams}){const p=await searchParams;return <><SignInForm next={p.next??'/dashboard'}/><Cached/></>}`,
  "app/forgot-password/page.jsx": `export default function Page(){return <h1>Away from sign-in</h1>}`,
  "app/(app)/loading.jsx": `export default function Loading(){return <p>Loading synthetic dashboard</p>}`,
  "app/(app)/layout.jsx": `import {cookies} from 'next/headers';export const dynamic='force-dynamic';export default async function Layout({children}){const marker=(await cookies()).get('probe')?.value??'signed-out';const id=crypto.randomUUID();console.log('PROBE',JSON.stringify({event:'start',id,marker,time:Date.now()}));await new Promise(r=>setTimeout(r,1200));console.log('PROBE',JSON.stringify({event:'end',id,time:Date.now()}));return <><p data-testid="server">{marker}</p>{children}</>}`,
  "app/(app)/dashboard/page.jsx": `import Link from 'next/link';import {Cached} from '../../providers';export default function Page(){return <><h1>Fixture dashboard</h1><Cached/><Link href="/sign-in" prefetch={false}>Open sign-in</Link></>}`,
  "app/identity/route.js": `import {cookies} from 'next/headers';export async function GET(){return Response.json({marker:(await cookies()).get('probe')?.value??'signed-out'},{headers:{'cache-control':'no-store'}})}`,
  "app/v1/auth/sign-in/route.js": `export async function POST(request){const body=await request.json();await new Promise(r=>setTimeout(r,body.email.startsWith('slow')?1600:200));if(body.email.startsWith('fail'))return Response.json({type:'https://example.test/failure',title:'Unavailable',status:503,detail:'Synthetic refusal'},{status:503,headers:{'cache-control':'no-store'}});return new Response(null,{status:204,headers:{'set-cookie':'probe=fresh; HttpOnly; Secure; SameSite=Lax; Path=/','cache-control':'no-store'}})}`,
  "app/v1/auth/magic-link/route.js": `export async function POST(){return new Response(null,{status:204,headers:{'cache-control':'no-store'}})}`,
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
  async function fill(page, email = "fresh@example.test") {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  }
  async function dashboard(page) {
    await page.getByRole("heading", { name: "Fixture dashboard" }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="cached"]')?.textContent === 'fresh');
    assert.equal(await page.getByTestId("server").textContent(), "fresh");
  }
  const renderCount = () => serverLog.split('\n').filter(l => l.startsWith('PROBE ') && l.includes('"start"')).length;
  for (const initial of ["signed-out", "prior-user"]) {
    await scenario(`discard cached ${initial} state; one fresh document`, async ({ context, page, requests }) => {
      if (initial === "prior-user") await context.addCookies([{ name: "probe", value: "prior-user", url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      await page.goto(`${origin}/dashboard`);
      await page.waitForFunction(v => document.querySelector('[data-testid="cached"]')?.textContent === v, initial);
      const boot = await page.evaluate(() => window.__probeBoot);
      await page.getByRole("link", { name: "Open sign-in" }).click();
      await page.getByLabel("Email", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("cached").textContent(), initial);
      assert.equal(await page.evaluate(() => window.__probeBoot), boot, "Old caches must exist before submission");
      requests.length = 0;
      const before = renderCount();
      await fill(page);
      await page.locator("form").evaluate(form => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await dashboard(page);
      await page.waitForTimeout(300);
      assert.notEqual(await page.evaluate(() => window.__probeBoot), boot);
      assert.equal(requests.filter(r => r.path === '/v1/auth/sign-in').length, 1);
      assert.deepEqual(requests.filter(r => r.path === '/dashboard').map(r => r.type), ['document']);
      assert.equal(renderCount() - before, 1, "One server layout after sign-in");
      assert.equal(await page.evaluate(() => document.cookie.includes('probe=')), false);
    });
  }
  await scenario("replace preserves Back history and query destination", async ({ page, requests }) => {
    await page.goto(origin);
    await page.getByRole('link', { name: 'Open sign-in' }).click();
    await fill(page);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await dashboard(page);
    assert.equal(new URL(page.url()).search, '?view=upcoming');
    await page.goBack();
    await page.getByRole('heading', { name: 'Anchor', exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path === '/v1/auth/sign-in').length, 1);
  });
  await scenario("failed destination load can be reloaded without another sign-in", async ({ page, requests }) => {
    await page.goto(`${origin}/sign-in`);
    await page.route(`${origin}/dashboard`, route => route.fulfill({
      status: 503, contentType: 'text/html', body: '<h1>Destination unavailable</h1>',
    }), { times: 1 });
    await fill(page);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('heading', { name: 'Destination unavailable' }).waitFor();
    await page.reload();
    await dashboard(page);
    assert.equal(requests.filter(r => r.path === '/v1/auth/sign-in').length, 1);
    assert.deepEqual(requests.filter(r => r.path === '/dashboard').map(r => r.type), ['document', 'document']);
  });
  await scenario("unmount pending sign-in suppresses late navigation", async ({ page, requests }) => {
    await page.goto(`${origin}/sign-in`);
    await fill(page, 'slow@example.test');
    const started = page.waitForRequest(r => new URL(r.url()).pathname === '/v1/auth/sign-in');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await started;
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByRole('heading', { name: 'Away from sign-in' }).waitFor();
    await page.waitForTimeout(1900);
    assert.equal(new URL(page.url()).pathname, '/forgot-password');
    assert.equal(requests.filter(r => r.path === '/dashboard').length, 0);
    assert.equal(requests.filter(r => r.path === '/v1/auth/sign-in').length, 1);
  });
  await scenario("refusal permits retry; magic link never navigates", async ({ page, requests }) => {
    await page.goto(`${origin}/sign-in`);
    await fill(page, 'fail@example.test');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByText('Synthetic refusal', { exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path === '/dashboard').length, 0);
    await page.getByRole('button', { name: /email me a one-time link instead/i }).click();
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    assert.equal(requests.filter(r => r.path === '/v1/auth/magic-link').length, 1);
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await fill(page);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await dashboard(page);
    assert.equal(requests.filter(r => r.path === '/v1/auth/sign-in').length, 2);
  });
} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await writeFile(join(fixture, 'server.log'), serverLog);
  await writeFile(join(fixture, 'results.json'), JSON.stringify(results, null, 2));
  console.warn(`Synthetic evidence: ${fixture}`);
}
assert.equal(results.length, 6);
const nextVersion = JSON.parse(await readFile(join(web, 'node_modules/next/package.json'), 'utf8')).version;
console.warn(`All ${results.length} scenarios passed with Next ${nextVersion}; not hosted auth/DB acceptance.`);
