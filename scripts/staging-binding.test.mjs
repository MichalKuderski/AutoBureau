import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {authority,connection,project} from './staging-binding-policy.mjs';
import {supervise} from './staging-binding-supervisor.mjs';
import {stages,reasons,structuredReason,formatResults,blankResults} from './staging-binding-protocol.mjs';
import {executeDiagnostic} from './staging-binding-core.mjs';
const sha='a'.repeat(40),root=new URL('..',import.meta.url).pathname;
const authorized={GITHUB_REPOSITORY:'MichalKuderski/AutoBureau',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'MichalKuderski',GITHUB_TRIGGERING_ACTOR:'MichalKuderski',
  GITHUB_SHA:sha,DIAGNOSTIC_APPROVAL:`diagnostic:${sha}:${project}`};
const direct=`postgresql://postgres:synthetic%21value@db.${project}.supabase.co:5432/postgres`;
const fixedCodes={P1000:'AUTH_REJECTED',P1001:'UNREACHABLE',P1002:'SERVER_TIMEOUT',P1003:'DATABASE_MISSING',
  P1008:'OPERATION_TIMEOUT',P1010:'ACCESS_DENIED',P1011:'TLS_FAILURE',P1017:'CONNECTION_CLOSED',
  P2024:'POOL_TIMEOUT',P2028:'TRANSACTION_FAILURE'};
test('authority binds repository, owner, rerun actor, main and exact approved SHA',()=>{
  assert.equal(authority(authorized),true);
  for(const key of Object.keys(authorized))assert.equal(authority({...authorized,[key]:'wrong'}),false,key);
});
test('routing accepts only pinned direct/session target and imposes strict TLS and bounded pool',()=>{
  for(const raw of [direct,`postgres://postgres.${project}:synthetic@aws-0-us-west-2.pooler.supabase.com/postgres?schema=public&connection_limit=9`]) {
    const u=new URL(connection(raw));assert.equal(u.port,'5432');
    assert.equal(u.searchParams.get('sslaccept'),'strict');assert.equal(u.searchParams.get('sslmode'),'require');
    assert.equal(u.searchParams.get('connection_limit'),'1');assert.equal(u.searchParams.get('connect_timeout'),'5');
    assert.equal(u.searchParams.get('pool_timeout'),'5');
  }
});
test('routing rejects alternate targets and unsafe option overrides',()=>{
  for(const raw of ['',direct.replace(project,'other'),direct.replace(':5432',':6543'),
    direct.replace('/postgres','/other'),direct.replace('postgres:synthetic','app_user:synthetic'),
    direct.replace('.supabase.co','.supabase.co.attacker.invalid'),direct+'#fragment',
    direct+'?host=127.0.0.1',direct+'?sslmode=disable',direct+'?sslaccept=accept_invalid_certs',
    direct+'?schema=public&schema=other',direct+'?options=-c%20default_transaction_read_only%3Doff',
    direct+'?pgbouncer=true',direct.replace('synthetic%21value',''),
    `postgresql://postgres.${project}:synthetic@aws-1-us-west-2.pooler.supabase.com:5432/postgres`])assert.throws(()=>connection(raw));
});
test('only validated structured data codes map; messages, getters, inherited codes and meta never do',()=>{
  for(const [code,reason] of Object.entries(fixedCodes))for(const field of ['code','errorCode'])
    assert.equal(structuredReason({[field]:code,message:'CANARY',meta:{password:'CANARY'}}),reason);
  for(const e of [null,undefined,'P1000',{},Object.create({code:'P1000'}),{code:'CANARY'},
    {code:'P1000',errorCode:'P1001'},{message:'P1000'},{meta:{code:'P1000'}},
    Object.defineProperty({},'code',{get(){throw Error('CANARY');}}),
    Object.defineProperty({code:'P1000'},'errorCode',{get(){throw Error('CANARY');}})])assert.equal(structuredReason(e),'UNKNOWN');
});
test('CLI refusal prints only fixed statuses; unstarted work is NOT_RUN',()=>{
  for(const [env,auth,route] of [[{...authorized,DATABASE_URL:'CANARY'},'PASS','FAIL'],
    [{...authorized,GITHUB_ACTOR:'wrong',DATABASE_URL:direct},'FAIL','NOT_RUN']]) {
    const r=spawnSync(process.execPath,['scripts/staging-binding-diagnostic.mjs'],{env,encoding:'utf8'});
    assert.equal(r.status,1);assert.equal(r.stderr,'');
    assert.equal(r.stdout,formatResults(auth,route,{ok:false,reason:'NOT_RUN',results:blankResults()}));
    assert.ok(!r.stdout.includes('CANARY'));
  }
});
async function worker(source,fn) {
  const dir=await mkdtemp(join(tmpdir(),'binding-stages-'));
  try{const path=join(dir,'worker.mjs');await writeFile(path,source);return await fn(path);}
  finally{await rm(dir,{recursive:true,force:true});}
}
const send="const send=x=>new Promise(r=>process.send(x,()=>r()));";
const successful=`${send}for(let i=0;i<${stages.length};i++){await send([i,0,0]);await send([i,1,0]);}process.disconnect();`;
test('complete ordered protocol and successful process exit are both required',async()=>{
  await worker(successful,async path=>{
    const r=await supervise(path,{},2000);assert.equal(r.ok,true);assert.ok(r.results.every(s=>s.status==='PASS'));
  });
  await worker(successful.replace('process.disconnect();','process.exit(1);'),async path=>{
    const r=await supervise(path,{},2000);assert.equal(r.ok,false);assert.equal(r.reason,'WORKER_FAILURE');
    assert.ok(r.results.every(s=>s.status==='PASS'));
  });
});
test('reported structured failure retains completed stages and later NOT_RUN',async()=>{
  await worker(`${send}await send([0,0,0]);await send([0,1,0]);await send([1,0,0]);await send([1,2,3]);process.exit(1);`,async path=>{
    const r=await supervise(path,{},2000);assert.equal(r.reason,'REPORTED_FAILURE');
    assert.equal(r.results[0].status,'PASS');assert.deepEqual(r.results[1],{status:'FAIL',reason:'AUTH_REJECTED'});
    assert.ok(r.results.slice(2).every(s=>s.status==='NOT_RUN'));
  });
});
test('invalid, duplicate, skipped, extra-field and post-terminal IPC are rejected',async()=>{
  for(const events of [["CANARY"],[[0,1,0]],[[1,0,0]],[[0,0,0],[0,0,0]],[[0,0,0],[0,2,999]],
    [[0,0,0],[0,1,3]],[[0,0,0,0]],[{stage:0,secret:'CANARY'}],[[0,0,0],[0,2,3],[1,0,0]]])
    await worker(`${send}for(const e of ${JSON.stringify(events)})await send(e);setInterval(()=>{},1000);`,async path=>{
      const r=await supervise(path,{},2000);assert.equal(r.ok,false);assert.equal(r.reason,'PROTOCOL_FAILURE');
      assert.ok(!JSON.stringify(r).includes('CANARY'));
    });
});
test('crash before startup, during stage, and between stages keeps accurate progress',async()=>{
  for(const [source,pass,fail] of [["throw Error('CANARY')",0,null],
    [`${send}await send([0,0,0]);process.kill(process.pid,'SIGKILL');`,0,0],
    [`${send}await send([0,0,0]);await send([0,1,0]);process.exit(1);`,1,null]])
    await worker(source,async path=>{
      const r=await supervise(path,{},2000);assert.equal(r.reason,'WORKER_FAILURE');
      r.results.forEach((s,i)=>assert.equal(s.status,i<pass?'PASS':i===fail?'FAIL':'NOT_RUN'));
    });
});
test('watchdog preserves completed stages and marks only active stage failed',async()=>{
  await worker(`${send}await send([0,0,0]);await send([0,1,0]);await send([1,0,0]);setInterval(()=>{},1000);`,async path=>{
    const start=Date.now(),r=await supervise(path,{},300);assert.ok(Date.now()-start<3000);
    assert.equal(r.reason,'WATCHDOG_TIMEOUT');assert.equal(r.results[0].status,'PASS');
    assert.deepEqual(r.results[1],{status:'FAIL',reason:'WATCHDOG_TIMEOUT'});
    assert.ok(r.results.slice(2).every(s=>s.status==='NOT_RUN'));
  });
});
test('native output, exception strings, IPC garbage and inherited env never reach parent logs',async()=>{
  await worker("console.log('CANARY-URL');console.error('CANARY-ERROR');throw Error('CANARY-PASSWORD');",async path=>{
    const module=new URL('./staging-binding-supervisor.mjs',import.meta.url).href;
    const r=spawnSync(process.execPath,['--input-type=module','-e',`import {supervise} from ${JSON.stringify(module)};console.log(JSON.stringify(await supervise(${JSON.stringify(path)},{},2000)));`],{encoding:'utf8'});
    assert.equal(r.status,0);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).reason,'WORKER_FAILURE');
    assert.ok(!r.stdout.includes('CANARY'));
  });
  await worker(`if(process.env.CANARY || process.execArgv.length)throw Error('CANARY');${successful}`,async path=>{
    process.env.CANARY='synthetic';
    try{assert.equal((await supervise(path,{},2000)).ok,true);}finally{delete process.env.CANARY;}
  });
});
async function execute(overrides={}) {
  const events=[];
  const ok=await executeDiagnostic({root,createClient:()=>{throw Error('CANARY');},report:async e=>events.push(e),...overrides});
  return {ok,events};
}
test('missing/malformed inventory and actual constructor failures remain LOCAL_SETUP failures',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'binding-inventory-'));
  try {
    for(const value of [null,'{broken']) {
      if(value){await mkdir(join(dir,'scripts'),{recursive:true});await writeFile(join(dir,'scripts/rejection-rollout-manifest.json'),value);}
      let created=false;
      const r=await execute({root:dir,createClient:()=>{created=true;}});
      assert.equal(created,false);assert.deepEqual(r.events,[[0,0,0],[0,2,reasons.indexOf('LOCAL_SETUP_FAILURE')]]);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
  const r=await execute();assert.equal(r.ok,false);assert.equal(r.events.at(-1)[0],0);
});
test('each structured connect error stays CONNECT, never a fabricated read-only/role failure',async()=>{
  for(const [code,reason] of Object.entries(fixedCodes)) {
    const r=await execute({createClient:()=>({$connect:async()=>{throw {errorCode:code,message:'CANARY'};},$disconnect:async()=>{}})});
    assert.deepEqual(r.events,[[0,0,0],[0,1,0],[1,0,0],[1,2,reasons.indexOf(reason)]]);
  }
});
test('transaction acquisition error is READ_ONLY_CONFIRMATION after CONNECT passes',async()=>{
  const r=await execute({createClient:()=>({$connect:async()=>{},$transaction:async()=>{throw {code:'P2028'};},$disconnect:async()=>{}})});
  assert.deepEqual(r.events.slice(-3),[[1,1,0],[2,0,0],[2,2,reasons.indexOf('TRANSACTION_FAILURE')]]);
});
test('server read-only mode must actually confirm before any identity read',async()=>{
  let queries=0;
  const r=await execute({createClient:()=>({$connect:async()=>{},$disconnect:async()=>{},
    $transaction:async fn=>fn({$executeRawUnsafe:async()=>{},$queryRawUnsafe:async()=>{queries++;return [{readonly:false}];}})})});
  assert.equal(queries,1);assert.deepEqual(r.events.at(-1),[2,2,reasons.indexOf('READ_ONLY_FAILURE')]);
});
test('manual workflow and secret boundaries remain unchanged',async()=>{
  const require=createRequire(new URL('../ops/package.json',import.meta.url)),{parse}=require('yaml');
  const load=async path=>parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
  const w=await load('.github/workflows/staging-binding-diagnostic.yml'),j=w.jobs.diagnostic;
  assert.deepEqual(Object.keys(w.on),['workflow_dispatch']);assert.deepEqual(w.permissions,{contents:'read'});
  assert.equal(j.if,"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == 'MichalKuderski' && github.triggering_actor == 'MichalKuderski'");
  assert.equal(j.environment,'staging');assert.equal(j['timeout-minutes'],5);
  assert.deepEqual(j.steps[0].with,{ref:'${{ github.sha }}','persist-credentials':false});
  assert.equal(j.steps.filter(s=>JSON.stringify(s).includes('secrets.')).length,1);
  assert.deepEqual(j.steps.at(-1).env,{DATABASE_URL:'${{ secrets.STAGING_MIGRATION_DATABASE_URL }}',DIAGNOSTIC_APPROVAL:'${{ inputs.approval }}'});
  assert.equal(j.steps.at(-1).run,'node scripts/staging-binding-diagnostic.mjs');
  assert.ok(!/upload-artifact|migrate deploy|vercel|production/i.test(JSON.stringify(w)));
  assert.equal((await load('.github/workflows/deploy.yml')).jobs.staging.if,'${{ false }}');
});
