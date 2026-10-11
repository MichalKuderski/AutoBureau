// Opt-in disposable loopback database only. No hosted credentials accepted.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readOnly,executeDiagnostic} from './staging-binding-core.mjs';
import {stages} from './staging-binding-protocol.mjs';
import {createClient} from './staging-binding-client.mjs';
import {cp,mkdir} from 'node:fs/promises';
import {loadInventory,stagePrefix} from './rejection-rollout-core.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const input=process.env.DIAGNOSTIC_TEST_DATABASE_URL;
assert.ok(input,'Explicit local disposable fixture required');
const url=new URL(input);
assert.ok(url.protocol==='postgresql:' && ['127.0.0.1','localhost'].includes(url.hostname) &&
  url.pathname==='/postgres' && url.username==='postgres' && !url.search && !url.hash,
  'Refusing non-local/non-fixture target');
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({datasourceUrl:input,log:[]});
const other=new PrismaClient({datasourceUrl:input,log:[]});
async function inspectBinding({report=()=>{}}={}) {
  const ok=await executeDiagnostic({root,createClient:()=>createClient(input),report:async event=>{if(event[1]===1)report(event[0]);}});
  if(!ok)throw Error('Synthetic diagnostic failed');
}
const manifest=JSON.parse(await readFile(join(root,'scripts/rejection-rollout-manifest.json'),'utf8'));
before(async()=>{
  const [{count}]=await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(count,0,'Use a fresh disposable PostgreSQL service');
  const {files}=await loadInventory(root,manifest),stage=await stagePrefix(root,files,manifest.baseline);
  try {
    const r=spawnSync('pnpm',['--filter','@autobureau/db','exec','prisma','migrate','deploy','--schema',join(stage,'schema.prisma')],
      {cwd:root,env:{...process.env,DATABASE_URL:input},stdio:'pipe',timeout:90000});
    assert.equal(r.status,0,'Local synthetic baseline failed');
  } finally {await rm(stage,{recursive:true,force:true});}
  await db.$executeRawUnsafe('CREATE TABLE public.diagnostic_write_probe (value integer)');
},{timeout:120000});
after(async()=>{await db.$disconnect();await other.$disconnect();});
test('real 48-migration baseline authenticates and matches identity, ledger and schema',async()=>{
  const reports=[];
  await inspectBinding({root,db,report:n=>reports.push(n)});
  assert.deepEqual(reports,[0,1,2,3,4,5,6,7]);
});
test('PostgreSQL rejects persistent DML and DDL even for this superuser; negative control can write',async()=>{
  const [{superuser}]=await db.$queryRawUnsafe('SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user');
  assert.equal(superuser,true);
  await db.$executeRawUnsafe('INSERT INTO diagnostic_write_probe VALUES (1)');
  for(const sql of ['INSERT INTO diagnostic_write_probe VALUES (2)',
    'UPDATE diagnostic_write_probe SET value=2','DELETE FROM diagnostic_write_probe',
    'CREATE TABLE public.diagnostic_forbidden (value integer)',
    'ALTER TABLE diagnostic_write_probe ADD COLUMN forbidden integer'])
    await assert.rejects(readOnly(db,read=>read(sql)),e=>e.meta?.code==='25006');
  assert.deepEqual(await db.$queryRawUnsafe('SELECT value FROM diagnostic_write_probe'),[{value:1}]);
  const [{absent}]=await db.$queryRawUnsafe("SELECT to_regclass('public.diagnostic_forbidden') IS NULL AS absent");
  assert.equal(absent,true);
});
test('statement timeout cancels a slow query without writes',async()=>{
  const start=Date.now();
  await assert.rejects(readOnly(db,read=>read('SELECT pg_sleep(7)::text')),e=>e.meta?.code==='57014');
  assert.ok(Date.now()-start>=4500 && Date.now()-start<10000);
});
test('lock timeout bounds blocked reads',async()=>{
  let locked,release;
  const ready=new Promise(r=>{locked=r;}),hold=new Promise(r=>{release=r;});
  const blocker=other.$transaction(async tx=>{
    await tx.$executeRawUnsafe('LOCK TABLE diagnostic_write_probe IN ACCESS EXCLUSIVE MODE');
    locked();await hold;
  },{timeout:10000});
  await ready;
  try {
    const start=Date.now();
    await assert.rejects(readOnly(db,read=>read('SELECT value FROM diagnostic_write_probe')),e=>e.meta?.code==='55P03');
    assert.ok(Date.now()-start>=1500 && Date.now()-start<7000);
  } finally {release();await blocker;}
});
test('interactive transaction wall budget prevents repeated short reads from running indefinitely',async()=>{
  const start=Date.now();
  await assert.rejects(readOnly(db,async read=>{
    for(let i=0;i<5;i++)await read('SELECT pg_sleep(4)::text');
  }));
  assert.ok(Date.now()-start>=14000 && Date.now()-start<22000);
});
test('checksum drift, rolled-back ledger and weakened RLS fail closed',async()=>{
  const name=Object.keys(manifest.baseline)[0],checksum=manifest.baseline[name];
  await db.$executeRawUnsafe('UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name=$2','bad',name);
  await assert.rejects(inspectBinding({root,db,report:()=>{}}));
  await db.$executeRawUnsafe('UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name=$2',checksum,name);
  await db.$executeRawUnsafe('UPDATE _prisma_migrations SET rolled_back_at=now() WHERE migration_name=$1',name);
  await assert.rejects(inspectBinding({root,db,report:()=>{}}));
  await db.$executeRawUnsafe('UPDATE _prisma_migrations SET rolled_back_at=NULL WHERE migration_name=$1',name);
  await db.$executeRawUnsafe('ALTER TABLE document_period_decisions DISABLE ROW LEVEL SECURITY');
  await assert.rejects(inspectBinding({root,db,report:()=>{}}));
  await db.$executeRawUnsafe('ALTER TABLE document_period_decisions ENABLE ROW LEVEL SECURITY');
  await inspectBinding({root,db,report:()=>{}});
});
// A local-only dependency adapter redirects the unchanged packaged entrypoint's
// approved-shape synthetic URL to this disposable database. No hosted override
// exists, and every real driver connection made by these tests is loopback.
async function packaged(fn,{databaseUrl=input,clientSource}={}) {
  const dir=await mkdtemp(join(tmpdir(),'binding-package-'));
  try {
    for(const path of ['scripts','ops/staging-rejection','packages/db/prisma/migrations'])
      await cp(join(root,path),join(dir,path),{recursive:true});
    await mkdir(join(dir,'packages/db/node_modules/@prisma/client'),{recursive:true});
    await writeFile(join(dir,'packages/db/package.json'),'{}');
    const realClient=require.resolve('@prisma/client');
    await writeFile(join(dir,'packages/db/node_modules/@prisma/client/index.js'),clientSource ??
      `const {PrismaClient}=require(${JSON.stringify(realClient)});
       module.exports.PrismaClient=class extends PrismaClient {
         constructor(options){super({...options,datasourceUrl:${JSON.stringify(databaseUrl)}});}
       };`);
    const sha='a'.repeat(40),project='kdqnfruwgocfqwpbpuxo';
    const env={GITHUB_REPOSITORY:'MichalKuderski/AutoBureau',GITHUB_EVENT_NAME:'workflow_dispatch',
      GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'MichalKuderski',GITHUB_TRIGGERING_ACTOR:'MichalKuderski',
      GITHUB_SHA:sha,DIAGNOSTIC_APPROVAL:`diagnostic:${sha}:${project}`,
      DATABASE_URL:`postgresql://postgres:CANARY_SYNTHETIC@db.${project}.supabase.co:5432/postgres`};
    const run=()=>spawnSync(process.execPath,['scripts/staging-binding-diagnostic.mjs'],
      {cwd:dir,env,encoding:'utf8',timeout:35000});
    return await fn({dir,run});
  }finally{await rm(dir,{recursive:true,force:true});}
}
function fixedOutput(r) {
  assert.equal(r.stderr,'');assert.ok(!r.stdout.includes('CANARY'));
  const lines=r.stdout.trim().split('\n');assert.equal(lines.length,stages.length+3);
  for(const line of lines)assert.match(line,/^[A-Z_]+ (?:PASS|NOT_RUN|FAIL(?: [A-Z_]+)?)$/);
  return lines;
}
test('actual packaged CLI and worker complete every stage with the real local driver and stripped env',async()=>{
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,0);
    assert.ok(lines.every(l=>l.endsWith(' PASS')));
  });
});
test('actual packaged startup, inventory and driver import/constructor failures classify LOCAL_SETUP',async()=>{
  for(const source of ["throw Error('CANARY_IMPORT')",
    "module.exports.PrismaClient=class{constructor(){console.log('CANARY');console.error('CANARY');throw Error('CANARY_INIT')}}"])
    await packaged(async({run})=>{
      const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
      assert.ok(lines.includes('LOCAL_SETUP FAIL LOCAL_SETUP_FAILURE'));
      assert.ok(lines.includes('CONNECT NOT_RUN'));
    },{clientSource:source});
  await packaged(async({dir,run})=>{
    await rm(join(dir,'scripts/rejection-rollout-manifest.json'));
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('LOCAL_SETUP FAIL LOCAL_SETUP_FAILURE'));
    assert.ok(lines.includes('CONNECT NOT_RUN'));
  });
});
test('actual packaged P1000 authentication rejection is distinct and leaks no raw error or URL',async()=>{
  const bad=new URL(input);bad.password='CANARY_SYNTHETIC_BAD_PASSWORD';
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('LOCAL_SETUP PASS'));
    assert.ok(lines.includes('CONNECT FAIL AUTH_REJECTED'));
    assert.ok(lines.includes('READ_ONLY_CONFIRMATION NOT_RUN'));
  },{databaseUrl:bad.toString()});
});
test('actual packaged identity mismatch is after successful connection/read-only confirmation',async()=>{
  const otherDatabase=new URL(input);otherDatabase.pathname='/template1';
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('CONNECT PASS'));assert.ok(lines.includes('READ_ONLY_CONFIRMATION PASS'));
    assert.ok(lines.includes('DATABASE_ROLE FAIL IDENTITY_MISMATCH'));
    assert.ok(lines.includes('MIGRATION_CHECKSUMS NOT_RUN'));
  },{databaseUrl:otherDatabase.toString()});
});
test('actual packaged post-transaction disconnect failure retains transaction pass but overall fails',async()=>{
  const realClient=require.resolve('@prisma/client');
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('TRANSACTION_COMPLETED PASS'));
    assert.ok(lines.includes('DISCONNECT FAIL UNKNOWN'));
    assert.ok(lines.includes('PROCESS_COMPLETION FAIL REPORTED_FAILURE'));
  },{clientSource:`const {PrismaClient}=require(${JSON.stringify(realClient)});
    module.exports.PrismaClient=class extends PrismaClient {
      constructor(options){super({...options,datasourceUrl:${JSON.stringify(input)}});}
      async $disconnect(){await super.$disconnect();throw Error('CANARY_DISCONNECT');}
    };`});
});
test('actual packaged TLS refusal is CONNECT failure without exposing provider text',async()=>{
  const tls=new URL(input);tls.search='sslmode=require&sslaccept=strict';
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('CONNECT FAIL TLS_FAILURE'));
    assert.ok(lines.includes('READ_ONLY_CONFIRMATION NOT_RUN'));
  },{databaseUrl:tls.toString()});
});
test('actual packaged transaction completion error retains read stages and fails completion',async()=>{
  const realClient=require.resolve('@prisma/client');
  await packaged(async({run})=>{
    const r=run(),lines=fixedOutput(r);assert.equal(r.status,1);
    assert.ok(lines.includes('SCHEMA_POSTURE PASS'));
    assert.ok(lines.includes('TRANSACTION_COMPLETED FAIL TRANSACTION_FAILURE'));
    assert.ok(lines.includes('DISCONNECT NOT_RUN'));
  },{clientSource:`const {PrismaClient}=require(${JSON.stringify(realClient)});
    module.exports.PrismaClient=class extends PrismaClient {
      constructor(options){super({...options,datasourceUrl:${JSON.stringify(input)}});}
      async $transaction(...args){await super.$transaction(...args);throw {code:'P2028',message:'CANARY_TX'};}
    };`});
});
