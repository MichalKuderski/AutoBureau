// Opt-in disposable loopback database only. No hosted credentials accepted.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readOnly,inspectBinding} from './staging-binding-core.mjs';
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
  assert.deepEqual(reports,[0,1,2,3]);
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
test('real driver authentication errors cannot escape isolated worker stdout/stderr',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'binding-driver-'));
  try {
    const bad=new URL(input);bad.password='CANARY_SYNTHETIC_BAD_PASSWORD';
    const path=join(dir,'worker.mjs');
    await writeFile(path,`import {createRequire} from 'node:module';
      const require=createRequire(${JSON.stringify(join(root,'packages/db/package.json'))});
      const {PrismaClient}=require('@prisma/client');
      const db=new PrismaClient({datasourceUrl:process.env.DATABASE_URL,log:['error']});
      try{await db.$connect();process.exit(0);}catch(e){
        console.error(e);console.log(process.env.DATABASE_URL);
        if(e.errorCode==='P1000')process.send(0,()=>process.exit(1));else process.exit(1);
      }`);
    const supervisor=new URL('./staging-binding-supervisor.mjs',import.meta.url).href;
    const source=`import {supervise} from ${JSON.stringify(supervisor)};
      console.log(JSON.stringify(await supervise(${JSON.stringify(path)},{DATABASE_URL:process.env.LOCAL_FIXTURE_URL},5000)));`;
    const r=spawnSync(process.execPath,['--input-type=module','-e',source],
      {env:{LOCAL_FIXTURE_URL:bad.toString()},encoding:'utf8',timeout:8000});
    assert.equal(r.status,0);assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{ok:false,count:1});
    assert.ok(!r.stdout.includes('CANARY'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
