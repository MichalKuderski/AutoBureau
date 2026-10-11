/** Optional public UI regression. Uses installed Playwright and a loopback-only Next dev
 * server with no app credentials. Blocks external browser requests; never accepts a
 * hosted target. Run after installing workspace dependencies. Screenshots/evidence
 * are written to a temporary directory. */
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {writeFile,mkdir,mkdtemp,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo=resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Next loads dotenv files automatically. Refuse them by filename, never read values.
for (const directory of [repo, join(repo,'apps/web')]) {
 for (const name of ['.env','.env.local','.env.development','.env.development.local']) {
  const exists=await lstat(join(directory,name)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  assert.equal(exists,false,'Browser regression refuses local dotenv files');
 }
}
const out=await mkdtemp(join(tmpdir(), 'pellum-help-browser-'));
const reservation=createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
const port=reservation.address().port; await new Promise(r=>reservation.close(r));
const origin=`http://127.0.0.1:${port}`;
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,[repo+'/apps/web/node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{cwd:repo+'/apps/web',env:{PATH:process.env.PATH,HOME:process.env.HOME,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
let browser; const results=[],errors=[],blocked=[];
try{
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/help',{signal:AbortSignal.timeout(3000)})).ok;}catch{/* loopback startup */}if(ready)break;await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'local server available');
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox','--disable-background-networking']});
 for(const mode of [{name:'desktop',width:1440,height:1000,colorScheme:'light'},{name:'mobile',width:390,height:844,colorScheme:'light'},{name:'dark',width:390,height:844,colorScheme:'dark'},{name:'reflow',width:320,height:900,colorScheme:'light'}]){
  const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},colorScheme:mode.colorScheme,reducedMotion:'reduce'});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const path of ['/help','/privacy','/security','/terms','/']){
   const response=await page.goto(origin+path);assert.equal(response.status(),200);
   await page.getByRole('heading',{level:1}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${mode.name} ${path} horizontal overflow`);
   assert.equal(await page.getByRole('navigation',{name:'Help and trust'}).getByRole('link').count(),4);
   if(path==='/help'){
    const question=page.locator('summary').first();await question.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('details').first().getAttribute('open'),'');
    await page.keyboard.press('Space');assert.equal(await page.locator('details').first().getAttribute('open'),null);
    await page.getByRole('navigation',{name:'FAQ topics'}).getByRole('link',{name:'Documents and readings'}).click();
    assert.ok(page.url().endsWith('#documents'));
    await page.goto(origin+'/help');
   }
   await page.screenshot({path:`${out}/${mode.name}-${path==='/'?'landing':path.slice(1)}.png`,fullPage:true});
   results.push({mode:mode.name,path,status:response.status(),overflow:false});
  }
  await page.goto(origin+'/help');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to main content');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
  for(const path of ['/help/private','/privacy/export','/security/admin','/terms/accept']){const r=await context.request.get(origin+path,{maxRedirects:0});assert.equal(r.status(),307);assert.ok(r.headers().location.includes('/sign-in'));}
  await context.close();
 }
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
 await writeFile(out+'/evidence.json',JSON.stringify({results,keyboard:'native disclosure, anchor, skip focus passed in four modes',nestedRoutes:'four paths redirect to sign-in in four modes',errors,blocked,limits:'Local Next development server, static public pages only. No hosted authentication, DB, real uploads or full E2E.'},null,2));
 console.warn(JSON.stringify({passed:results.length,errors,blocked,evidence:out}));
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(out+'/server.log',log);}
