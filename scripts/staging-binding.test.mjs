import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {authority,connection,project} from './staging-binding-policy.mjs';
import {supervise} from './staging-binding-supervisor.mjs';
const sha='a'.repeat(40);
const authorized={GITHUB_REPOSITORY:'MichalKuderski/AutoBureau',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'MichalKuderski',GITHUB_TRIGGERING_ACTOR:'MichalKuderski',
  GITHUB_SHA:sha,DIAGNOSTIC_APPROVAL:`diagnostic:${sha}:${project}`};
const direct=`postgresql://postgres:synthetic%21value@db.${project}.supabase.co:5432/postgres`;
test('authority binds repository, owner, rerun actor, main and exact approved SHA',()=>{
  assert.equal(authority(authorized),true);
  for(const key of Object.keys(authorized))assert.equal(authority({...authorized,[key]:'wrong'}),false,key);
  assert.equal(authority({...authorized,DIAGNOSTIC_APPROVAL:`diagnostic:${'b'.repeat(40)}:${project}`}),false);
});
test('routing accepts only pinned direct/session target and enforces TLS and bounded pool',()=>{
  for(const raw of [direct,`postgres://postgres.${project}:synthetic@aws-0-us-west-2.pooler.supabase.com/postgres?schema=public&connection_limit=9`]) {
    const parsed=new URL(connection(raw));
    assert.equal(parsed.port,'5432');assert.equal(parsed.searchParams.get('sslaccept'),'strict');
    assert.equal(parsed.searchParams.get('sslmode'),'require');assert.equal(parsed.searchParams.get('connection_limit'),'1');
    assert.equal(parsed.searchParams.get('connect_timeout'),'5');assert.equal(parsed.searchParams.get('pool_timeout'),'5');
  }
});
test('routing fails closed for other projects, hosts, identities, ports and parameter overrides',()=>{
  for(const raw of ['',direct.replace(project,'anotherproject'),direct.replace(':5432',':6543'),
    direct.replace('/postgres','/other'),direct.replace('postgres:synthetic','app_user:synthetic'),
    direct.replace('.supabase.co','.supabase.co.attacker.invalid'),direct+'#fragment',
    direct+'?host=127.0.0.1',direct+'?sslmode=disable',direct+'?sslaccept=accept_invalid_certs',
    direct+'?schema=public&schema=other',direct+'?options=-c%20default_transaction_read_only%3Doff',
    direct+'?pgbouncer=true',direct.replace('synthetic%21value',''),
    `postgresql://postgres.${project}:synthetic@aws-1-us-west-2.pooler.supabase.com:5432/postgres`])
    assert.throws(()=>connection(raw));
});
test('CLI refuses before connecting and reports only fixed results for hostile inputs',()=>{
  for(const env of [{...authorized,DATABASE_URL:'postgresql://CANARY-secret@bad.invalid/postgres'},
    {...authorized,GITHUB_ACTOR:'bad',DATABASE_URL:direct}]) {
    const result=spawnSync(process.execPath,['scripts/staging-binding-diagnostic.mjs'],{env,encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(result.stderr,'');
    assert.match(result.stdout,/^AUTHORITY (PASS|FAIL)\nROUTING FAIL\nAUTHENTICATION FAIL\nDATABASE_ROLE FAIL\nMIGRATION_CHECKSUMS FAIL\nSCHEMA_POSTURE FAIL\nTRANSACTION_COMPLETED FAIL\n$/);
    assert.ok(!result.stdout.includes('CANARY'));
  }
});
async function worker(source,fn) {
  const dir=await mkdtemp(join(tmpdir(),'binding-test-'));
  try{const path=join(dir,'worker.mjs');await writeFile(path,source);return await fn(path);}
  finally{await rm(dir,{recursive:true,force:true});}
}
test('supervisor accepts only complete ordered protocol and successful process exit',async()=>{
  await worker('for(let i=0;i<4;i++)process.send(i);process.disconnect();',async path=>{
    assert.deepEqual(await supervise(path,{},2000),{ok:true,count:4});
  });
  for(const source of ["process.send('CANARY-secret');",'process.send(1);','process.send(0);process.exit(1);',
    'for(let i=0;i<4;i++)process.send(i);process.exit(1);'])await worker(source,async path=>{
      assert.equal((await supervise(path,{},2000)).ok,false);
    });
});
test('supervisor suppresses stdout, stderr, unhandled errors and inherited preload/debug env',async()=>{
  await worker("console.log('CANARY-URL');console.error('CANARY-PASSWORD');throw Error('CANARY-RAW-ERROR');",async path=>{
    const supervisor=new URL('./staging-binding-supervisor.mjs',import.meta.url).href;
    const source=`import {supervise} from ${JSON.stringify(supervisor)}; console.log(JSON.stringify(await supervise(${JSON.stringify(path)},{},2000)));`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});
    assert.equal(result.status,0);assert.equal(result.stderr,'');
    assert.deepEqual(JSON.parse(result.stdout),{ok:false,count:0});
    assert.ok(!result.stdout.includes('CANARY'));
  });
  await worker("if(process.env.CANARY || process.execArgv.length)throw Error('Inherited');for(let i=0;i<4;i++)process.send(i);process.disconnect();",async path=>{
    process.env.CANARY='synthetic';
    try{assert.equal((await supervise(path,{},2000)).ok,true);}finally{delete process.env.CANARY;}
  });
});
test('supervisor kills a hanging worker and reports fixed failure within wall limit',async()=>{
  await worker('setInterval(()=>{},1000)',async path=>{
    const start=Date.now();assert.deepEqual(await supervise(path,{},200),{ok:false,count:0});
    assert.ok(Date.now()-start<3000);
  });
});
test('manual workflow has one final secret step, immutable checkout and unchanged migration hold',async()=>{
  const require=createRequire(new URL('../ops/package.json',import.meta.url));
  const {parse}=require('yaml');
  const load=async path=>parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
  const w=await load('.github/workflows/staging-binding-diagnostic.yml');
  assert.deepEqual(Object.keys(w.on),['workflow_dispatch']);assert.deepEqual(Object.keys(w.jobs),['diagnostic']);
  assert.deepEqual(w.permissions,{contents:'read'});
  const j=w.jobs.diagnostic;
  assert.equal(j.if,"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == 'MichalKuderski' && github.triggering_actor == 'MichalKuderski'");
  assert.equal(j.environment,'staging');assert.equal(j['timeout-minutes'],5);
  assert.deepEqual(j.steps[0].with,{ref:'${{ github.sha }}','persist-credentials':false});
  assert.equal(j.steps.filter(s=>JSON.stringify(s).includes('secrets.')).length,1);
  assert.deepEqual(j.steps.at(-1).env,{DATABASE_URL:'${{ secrets.STAGING_MIGRATION_DATABASE_URL }}',DIAGNOSTIC_APPROVAL:'${{ inputs.approval }}'});
  assert.equal(j.steps.at(-1).run,'node scripts/staging-binding-diagnostic.mjs');
  assert.ok(!/upload-artifact|migrate deploy|vercel|production/i.test(JSON.stringify(w)));
  assert.equal((await load('.github/workflows/deploy.yml')).jobs.staging.if,'${{ false }}');
  const ci=(await load('.github/workflows/ci.yml')).jobs.staging_binding;
  assert.ok(ci && !/secrets\.|environment|workflow_dispatch/.test(JSON.stringify(ci)));
});
