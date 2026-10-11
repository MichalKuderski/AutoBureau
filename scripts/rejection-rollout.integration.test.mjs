// Opt-in, disposable-loopback-only integration. No hosted target or credentials accepted.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {runRollout,loadInventory,stagePrefix,reader,snapshot} from './rejection-rollout-core.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const input=process.env.ROLLOUT_TEST_DATABASE_URL;
assert.ok(input,'Explicit disposable local fixture URL required');
const url=new URL(input);
assert.ok(url.protocol==='postgresql:' && ['127.0.0.1','localhost'].includes(url.hostname) && url.pathname==='/rollout_baseline' && url.username==='autobureau','Refusing non-local/non-fixture DB');
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {PrismaClient}=require('@prisma/client');
const client=u=>new PrismaClient({datasourceUrl:u,log:[]});
const controlUrl=new URL(input);controlUrl.pathname='/postgres';const control=client(controlUrl.toString());
const baseline=client(input),manifest=JSON.parse(await readFile(join(root,'scripts/rejection-rollout-manifest.json'),'utf8'));
const databases=[];let index=0;
const integration=(name,fn)=>test(name,{timeout:120000},fn);
export function prisma(schema,databaseUrl) {
  return new Promise((resolve,reject)=>{
    const child=spawn('pnpm',['--filter','@autobureau/db','exec','prisma','migrate','deploy','--schema',schema],{cwd:root,env:{...process.env,DATABASE_URL:databaseUrl},stdio:['ignore','pipe','pipe'],timeout:90000});
    let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
    child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(Error(`Local fixture Prisma failure: ${log.replaceAll(databaseUrl,'[local fixture]')}`)));
  });
}
before(async()=>{
  const [{count}]=await baseline.$queryRawUnsafe("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(count,0,'Baseline must be a fresh disposable database');
  const {files}=await loadInventory(root,manifest),stage=await stagePrefix(root,files,manifest.baseline);
  try{await prisma(join(stage,'schema.prisma'),input);}finally{await rm(stage,{recursive:true,force:true});await baseline.$disconnect();}
}, {timeout:120000});
after(async()=>{
  for(const name of databases)await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await control.$disconnect();
});
async function fixture(fn){
  const name=`rollout_case_${++index}`;databases.push(name);
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE rollout_baseline`);
  const u=new URL(input);u.pathname='/'+name;const db=client(u.toString());
  let calls=0;
  const context=phase=>({event:'workflow_dispatch',ref:'refs/heads/main',actor:'MichalKuderski',triggeringActor:'MichalKuderski',sha:'a'.repeat(40),approval:`${phase}:${'a'.repeat(40)}:${manifest.project}`,evidence:'https://github.com/MichalKuderski/AutoBureau/pull/16#issuecomment-123',runtimeSha:'b'.repeat(40),runtimeUrl:'https://autobureau-staging-fixture-data-analyst-mike.vercel.app',acceptance:'https://github.com/MichalKuderski/AutoBureau/actions/runs/123'});
  const migrate=async schema=>{calls++;await prisma(schema,u.toString());};
  const run=(phase,overrides={})=>runRollout({root,db,phase,context:context(phase),migrate,...overrides});
  const ledger=()=>db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at');
  try{return await fn({db,run,migrate,context,ledger,url:u.toString(),calls:()=>calls});}finally{await db.$disconnect();}
}
integration('full real Prisma pause -> reason -> resume, postchecks and replay refusal',()=>fixture(async f=>{
  assert.deepEqual(await f.run('pause'),{phase:'pause',completed:49});
  assert.deepEqual(await f.run('reason'),{phase:'reason',completed:50});
  assert.deepEqual(await f.run('resume'),{phase:'resume',completed:51});
  assert.equal(f.calls(),3);await assert.rejects(f.run('resume'));assert.equal(f.calls(),3);
  const rows=await f.ledger();assert.equal(rows.length,51);assert.ok(rows.every(r=>r.finished_at&&!r.rolled_back_at));
}));
integration('out-of-order, wrong owner approval and ledger drift refuse before a command',()=>fixture(async f=>{
  await assert.rejects(f.run('reason'));
  await assert.rejects(f.run('pause',{context:{...f.context('pause'),actor:'someone-else'}}));
  await f.db.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum='bad' WHERE migration_name='20260728000000_init'");
  await assert.rejects(f.run('pause'));assert.equal(f.calls(),0);
}));
integration('disabled RLS or trigger refuses before a migration',()=>fixture(async f=>{
  await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions DISABLE ROW LEVEL SECURITY');
  await assert.rejects(f.run('pause'));assert.equal(f.calls(),0);
  await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions ENABLE ROW LEVEL SECURITY');
  await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions DISABLE TRIGGER privacy_write_fence');
  await assert.rejects(f.run('pause'));assert.equal(f.calls(),0);
}));
integration('transport failure after commit leaves persistent pause and refuses blind retry',()=>fixture(async f=>{
  await assert.rejects(f.run('pause',{migrate:async schema=>{await f.migrate(schema);throw Error('synthetic lost response');}}));
  assert.equal((await f.ledger()).length,49);assert.ok((await snapshot(reader(f.db))).constraints.some(c=>c.conname==='document_rejection_rollout_paused'));
  await assert.rejects(f.run('pause'));assert.equal(f.calls(),1);
}));
integration('postcheck drift fails without automatically resuming or repairing',()=>fixture(async f=>{
  await assert.rejects(f.run('pause',{migrate:async schema=>{await f.migrate(schema);await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions DISABLE TRIGGER privacy_write_fence');}}));
  assert.ok((await snapshot(reader(f.db))).constraints.some(c=>c.conname==='document_rejection_rollout_paused'));
  await assert.rejects(f.run('reason'));assert.equal(f.calls(),1);
}));
integration('injected pre-COMMIT error rolls back DDL, leaves failed Prisma row and prevents next phase',()=>fixture(async f=>{
  await assert.rejects(f.run('pause',{migrate:async schema=>{
    const path=join(dirname(schema),'migrations',manifest.phases.pause.name,'migration.sql');
    // Fault only in disposable staged fixture, never in a checked-in migration.
    await writeFile(path,(await readFile(path,'utf8')).replace('COMMIT;','SELECT 1/0; COMMIT;'));
    await f.migrate(schema);
  }}));
  const rows=await f.ledger();assert.equal(rows.length,49);assert.equal(rows.filter(r=>!r.finished_at).length,1);
  assert.ok(!(await snapshot(reader(f.db))).constraints.some(c=>c.conname==='document_rejection_rollout_paused'));
  await assert.rejects(f.run('reason'));assert.equal(f.calls(),1);
}));
integration('lock arriving after precheck times out once and leaves no active pause',()=>fixture(async f=>{
  const blocker=client(f.url);let release,locked;
  const acquired=new Promise(r=>locked=r);
  let holding;
  try {
    await assert.rejects(f.run('pause',{migrate:async schema=>{
      holding=blocker.$transaction(async tx=>{
        await tx.$executeRawUnsafe('LOCK TABLE document_period_decisions IN ACCESS SHARE MODE');locked();
        await new Promise(r=>release=r);
      },{timeout:20000});
      await acquired;
      try{await f.migrate(schema);}finally{release();await holding;}
    }}));
    assert.equal(f.calls(),1);assert.equal((await f.ledger()).filter(r=>!r.finished_at).length,1);
    assert.ok(!(await snapshot(reader(f.db))).constraints.some(c=>c.conname==='document_rejection_rollout_paused'));
    await assert.rejects(f.run('pause'));assert.equal(f.calls(),1);
  }finally{release?.();await holding;await blocker.$disconnect();}
}));
integration('weakened reason constraint cannot pass resume readiness',()=>fixture(async f=>{
  await f.run('pause');await f.run('reason');
  await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions DROP CONSTRAINT document_rejection_reason_valid');
  await f.db.$executeRawUnsafe('ALTER TABLE document_period_decisions ADD CONSTRAINT document_rejection_reason_valid CHECK(true) NOT VALID');
  await assert.rejects(f.run('resume'));assert.equal(f.calls(),2);
}));
