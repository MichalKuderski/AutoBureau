/** Staging-only migration evidence. Hashes rows in Postgres; never emits row contents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
await import('./verify-staging-migration-target.mjs');
if(process.exitCode) process.exit(process.exitCode);
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({log:[]});
const file='staging-jobs-migration-before.json';
const added=['20260913000000_job_delivery_inbox','20260913000001_job_worker_scope_read','20260913000002_api_role_table_privileges'];
async function snapshot(){
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const tables=await tx.$queryRawUnsafe("SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname");
  const rows={};
  for(const {name} of tables){
   if(['_prisma_migrations','auth_rate_limits'].includes(name))continue;
   assert(/^[a-z_]+$/.test(name));
   const data=name==='outbox_events' ? "to_jsonb(t)-'transport_scope'-'routed_at'" : 'to_jsonb(t)';
   rows[name]=(await tx.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5((${data})::text),'' ORDER BY md5((${data})::text)),'')) AS fingerprint FROM public."${name}" t`))[0];
  }
  const migrations=await tx.$queryRawUnsafe('SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY migration_name');
  const roles=await tx.$queryRawUnsafe("SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass, rolcreaterole AS create_role, rolcreatedb AS create_db, rolcanlogin AS login, rolinherit AS inherit FROM pg_roles WHERE rolname LIKE 'app_%' ORDER BY rolname");
  const policies=await tx.$queryRawUnsafe("SELECT tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname");
  const fks=await tx.$queryRawUnsafe("SELECT c.conname AS name, c.conrelid::regclass::text AS table_name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public' ORDER BY c.conname");
  const apiGrants=await tx.$queryRawUnsafe("SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role') ORDER BY table_name,grantee,privilege_type");
  const applicationGrants=await tx.$queryRawUnsafe("SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND grantee LIKE 'app_%' ORDER BY table_name,grantee,privilege_type");
  const [security]=await tx.$queryRawUnsafe("SELECT (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname='ensure_rls') AS ensure_rls,pg_total_relation_size('public.outbox_events')::int AS outbox_bytes");
  return {capturedAt:new Date().toISOString(),project:'kdqnfruwgocfqwpbpuxo',tables,rows,migrations,roles,policies,fks,apiGrants,applicationGrants,security};
 },{timeout:60000,isolationLevel:'RepeatableRead'});
}
try{
 const now=await snapshot();
 assert.equal(now.security.ensure_rls,0);
 assert(now.migrations.every(m=>m.finished&&!m.rolled_back));
 for(const m of now.migrations){
  assert(/^\d{14}_[a-z0-9_]+$/.test(m.name));
  const source=await readFile(new URL(`../packages/db/prisma/migrations/${m.name}/migration.sql`,import.meta.url));
  assert.equal(m.checksum,createHash('sha256').update(source).digest('hex'));
 }
 if(process.argv[2]==='before'){
  assert.equal(now.migrations.length,10);assert.equal(now.tables.filter(t=>t.forced).length,19);assert.equal(now.policies.length,25);
  assert(!now.tables.some(t=>['job_deliveries','job_inbox'].includes(t.name)));assert(!now.roles.some(r=>r.name==='app_job_worker'));
  assert.equal(now.rows.outbox_events.count,0);assert(now.security.outbox_bytes<16*1024*1024);
  assert(now.apiGrants.every(g=>['TRUNCATE','TRIGGER','REFERENCES'].includes(g.privilege_type)));
  await writeFile(file,JSON.stringify(now,null,2),{mode:0o600});
  process.stdout.write('Staging pre-migration invariants and row fingerprints saved; target and small-table gate passed.\n');
 }else if(process.argv[2]==='after'){
  const before=JSON.parse(await readFile(file,'utf8'));
  assert.equal(before.project,now.project);assert.equal(now.migrations.length,13);
  assert.deepEqual(now.migrations.filter(m=>!added.includes(m.name)),before.migrations);
  assert.deepEqual(now.migrations.filter(m=>added.includes(m.name)).map(m=>m.name),added);
  assert.deepEqual(now.tables.filter(t=>!['job_deliveries','job_inbox'].includes(t.name)),before.tables);
  assert.equal(now.tables.filter(t=>t.forced).length,21);assert.equal(now.policies.length,27);
  assert.deepEqual(now.policies.filter(p=>!['job_deliveries','job_inbox'].includes(p.tablename)),before.policies);
  assert.deepEqual(now.fks.filter(f=>!['job_deliveries','job_inbox'].includes(f.table_name)),before.fks);
  assert.deepEqual(now.roles.filter(r=>r.name!=='app_job_worker'),before.roles);
  assert.deepEqual(now.roles.find(r=>r.name==='app_job_worker'),{name:'app_job_worker',superuser:false,bypass:false,create_role:false,create_db:false,login:false,inherit:false});
  for(const [name,row] of Object.entries(before.rows))assert.deepEqual(now.rows[name],row,`Row drift in ${name}`);
  for(const name of ['job_deliveries','job_inbox'])assert.equal(now.rows[name].count,0);
  assert.deepEqual(now.apiGrants,[]);
  assert.deepEqual(now.applicationGrants.filter(g=>g.grantee!=='app_job_worker'&&!['job_deliveries','job_inbox'].includes(g.table_name)),before.applicationGrants);
  const workerTables={audit_log:['INSERT','SELECT'],household_users:['SELECT'],households:['SELECT'],job_deliveries:['SELECT'],job_inbox:['INSERT','SELECT'],outbox_events:['INSERT','SELECT']};
  assert.deepEqual(now.applicationGrants.filter(g=>g.grantee==='app_job_worker'),Object.entries(workerTables).flatMap(([table_name,privileges])=>privileges.map(privilege_type=>({table_name,grantee:'app_job_worker',privilege_type}))));
  await writeFile('staging-jobs-migration-after.json',JSON.stringify(now,null,2),{mode:0o600});
  process.stdout.write('Staging migration verified: 13 completed, 21 forced RLS, 27 policies, unchanged existing rows/roles/ownership; API table grants removed.\n');
 }else throw new Error('Unknown phase');
}catch{process.stderr.write('Staging migration evidence gate failed; credentials and row contents withheld. Inspect the saved non-secret inventories before proceeding.\n');process.exitCode=1;}
finally{await db.$disconnect();}
