/** Loopback-only component/navigation regression. Real DocumentStep, security page and CSS;
 * synthetic onboarding draft; no auth middleware, hosted session, DB or upload coverage. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=join(repo,'apps/web');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(join(tmpdir(),'pellum-onboarding-security-'));
const files={
 'package.json':JSON.stringify({private:true,type:'module'}),
 'next.config.mjs':'export default {experimental:{cpus:1},devIndicators:false};',
 'postcss.config.mjs':'export default {plugins:{"@tailwindcss/postcss":{}}};',
 'jsconfig.json':JSON.stringify({compilerOptions:{baseUrl:join(web,'src'),paths:{'@/*':['*']}}}),
 'app/globals.css':`@import "${web}/src/app/globals.css";\n@source "${web}/src";`,
 'app/layout.jsx':`import './globals.css';export default function Root({children}){return <html lang="en"><body>{children}</body></html>}`,
 'app/onboarding/document/page.jsx':`"use client";
import {useState} from 'react';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DocumentStep} from '@/app/onboarding/document/document-step';import {OnboardingDraftProvider} from '@/app/onboarding/onboarding-provider';
import {EMPTY_ONBOARDING} from '@/test/onboarding-fixture';import {ToastProvider} from '@/components/ui/toast';
export default function Page(){const [client]=useState(()=>new QueryClient());return <QueryClientProvider client={client}><ToastProvider><OnboardingDraftProvider initial={EMPTY_ONBOARDING}><main className="mx-auto max-w-3xl px-4 py-8 sm:px-6"><DocumentStep/></main></OnboardingDraftProvider></ToastProvider></QueryClientProvider>}`,
 'app/security/page.jsx':`import Page from '@/app/(info)/security/page';import Layout from '@/app/(info)/layout';export default function Security(){return <Layout><Page/></Layout>}`,
};
for(const [name,content] of Object.entries(files)){await mkdir(dirname(join(fixture,name)),{recursive:true});await writeFile(join(fixture,name),content);}
await symlink(join(web,'node_modules'),join(fixture,'node_modules'),'dir');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(web,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:fixture,env:{PATH:process.env.PATH,HOME:process.env.HOME,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let log='',browser;server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
const results=[],errors=[],blocked=[];
try{
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/onboarding/document',{signal:AbortSignal.timeout(3000)})).ok;}catch{/* loopback startup */}if(ready)break;await new Promise(r=>setTimeout(r,200));}assert.ok(ready,`Fixture did not start: ${fixture}`);
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-background-networking']});
 for(const mode of [{name:'desktop',width:1440,height:1000,colorScheme:'light'},{name:'mobile',width:390,height:844,colorScheme:'light'},{name:'dark',width:390,height:844,colorScheme:'dark'},{name:'reflow',width:320,height:900,colorScheme:'light'}]){
  const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},colorScheme:mode.colorScheme});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/onboarding/document');await page.getByRole('heading',{name:'Explore without uploading a document'}).waitFor();
  if(mode.colorScheme==='dark')await page.locator('html').evaluate(el=>el.classList.add('dark'));
  const link=page.getByRole('link',{name:"Read about security and what we can't see"});
  assert.equal(await link.getAttribute('href'),'/security');assert.equal(await page.locator('input[type=file]').count(),0);
  await page.keyboard.press('Tab');assert.equal(await link.evaluate(el=>el===document.activeElement),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(fixture,`${mode.name}-onboarding.png`),fullPage:true});
  await page.keyboard.press('Enter');await page.waitForURL(origin+'/security');await page.getByRole('heading',{name:'Security status',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Help and trust'}).getByRole('link',{name:'Security status',exact:true}).count(),1);
  await page.goBack();await page.getByRole('button',{name:'Continue',exact:true}).waitFor();
  results.push({mode:mode.name,keyboardNavigation:'passed',backNavigation:'passed',overflow:false});await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await writeFile(join(fixture,'evidence.json'),JSON.stringify({results,errors,blocked,scope:'Real components/CSS in isolated loopback fixture; synthetic draft; no hosted authentication or full onboarding E2E.'},null,2));
 console.warn(JSON.stringify({passed:results.length,evidence:fixture}));
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(join(fixture,'server.log'),log);}
