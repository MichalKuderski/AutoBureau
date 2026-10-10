/** Optional loopback-only hydration regression using unchanged real dashboard components and synthetic reads.
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
const require = createRequire(join(repo, "package.json"));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(join(tmpdir(), "pellum-hydration-"));
const web = join(repo, "apps/web"), next = join(web, "node_modules/next/dist/bin/next");
const files = {
  "package.json": JSON.stringify({ private: true }),
  "next.config.js": "module.exports={experimental:{cpus:1}};",
  "jsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: join(web, "src"), paths: { "@/*": ["*"] } } }),
  "app/layout.jsx": `export const dynamic="force-dynamic";export default function Root({children}){return <html><body>{children}</body></html>}`,
  "app/page.jsx": `"use client";
import {useState,useEffect} from 'react';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/components/layout/app-shell';import {DashboardScreen} from '@/app/(app)/dashboard/dashboard-screen';
import {CommandPalette} from '@/components/patterns/command-palette';import {BillingSettings} from '@/app/(app)/settings/billing/billing-settings';
import {HouseholdProvider} from '@/providers/household-provider';import {ThemeProvider} from '@/providers/theme-provider';import {ToastProvider} from '@/components/ui/toast';import {HOUSEHOLD,VIEWER} from '@/lib/domain/fixtures';
export default function Page(){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:30000,retry:2,retryDelay:0,refetchOnWindowFocus:false}}}));useEffect(()=>{window.__fixtureClient=client},[client]);return <QueryClientProvider client={client}><ThemeProvider><HouseholdProvider household={{...HOUSEHOLD,id:'synthetic-household',role:'owner'}} viewer={VIEWER}><ToastProvider><AppShell><DashboardScreen/></AppShell><CommandPalette/></ToastProvider></HouseholdProvider></ThemeProvider></QueryClientProvider>}`,
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(dirname(join(fixture, path)), { recursive: true });
  await writeFile(join(fixture, path), content);
}
await symlink(join(web, "node_modules"), join(fixture, "node_modules"), "dir");
const clockPath=join(fixture,'clock.cjs');
await writeFile(clockPath, `const RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-10T11:59:59Z']));}};`);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", TZ:"UTC", NODE_OPTIONS:`--require=${clockPath}` };
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
const server = spawn(process.execPath, [next, process.env.HYDRATION_MODE === "development" ? "dev" : "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
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
  const cases=[
    {name:'same_timezone_same_clock',zone:'UTC',instant:'2026-10-10T11:59:59Z',heading:'Hello',mismatch:false},
    {name:'different_timezone_different_greeting',zone:'Asia/Tokyo',instant:'2026-10-10T11:59:59Z',heading:'Hello',mismatch:false},
    {name:'different_timezone_same_greeting',zone:'America/Los_Angeles',instant:'2026-10-10T11:59:59Z',heading:'Hello',mismatch:false},
    {name:'same_timezone_across_noon_boundary',zone:'UTC',instant:'2026-10-10T12:00:00Z',heading:'Hello',mismatch:false},
  ];
  for(const c of cases){
    const context=await browser.newContext({timezoneId:c.zone,locale:'en-US'}),blocked=[],errors=[];
    await context.addInitScript(instant=>{const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}};},c.instant);
    await context.route('**/*', async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){blocked.push(url.origin);return route.abort();}
      if(url.pathname.startsWith('/v1/')){
        assert.equal(route.request().method(),'GET');
        const body=url.pathname==='/v1/dashboard'?{action_needed:0,upcoming_30d:0,needs_review:0,items_tracked:0,coverage:{expected:null,captured:0},next_digest_at:null}:{data:[],next_cursor:null};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      }
      return route.continue();
    });
    const page=await context.newPage();
    page.on('console',msg=>{if(msg.type()==='error')errors.push({type:'console',message:msg.text()});});
    page.on('pageerror',err=>errors.push({type:'pageerror',message:err.message,stack:err.stack}));
    try{
      const response=await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__fixtureClient?.isFetching()===0);
      const html=await response.text(),serverHeading=html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1],clientHeading=await page.locator('h1').first().textContent();
      const hydration=errors.filter(e=>/418|hydration|server rendered/i.test(e.message));
      const result={...c,mode:process.env.HYDRATION_MODE??'production',status:response.status(),serverZone:'UTC',serverInstant:'2026-10-10T11:59:59Z',serverHeading,clientHeading,errors,hydrationCount:hydration.length,blocked};
      results.push(result);
      await writeFile(join(fixture,c.name+'.html'),html);
      assert.equal(response.status(),200);assert.equal(serverHeading,"Hello, Dana");assert.equal(clientHeading,serverHeading);assert.equal(hydration.length,0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
      console.warn(JSON.stringify(result));
    }finally{await context.close();}
  }

} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await writeFile(join(fixture, 'server.log'), serverLog);
  await writeFile(join(fixture, 'results.json'), JSON.stringify(results, null, 2));
  console.warn(`Synthetic evidence: ${fixture}`);
}
assert.equal(results.length, 4);
const nextVersion = JSON.parse(await readFile(join(web, 'node_modules/next/package.json'), 'utf8')).version;
console.warn(`All ${results.length} scenarios passed with Next ${nextVersion}; not hosted auth/DB acceptance.`);
