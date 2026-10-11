// Imported by the existing isolated rollout CI job. All engine connections are
// synthetic, disposable loopback PostgreSQL fixtures; no hosted inputs accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {migrationConnection} from './staging-migration-trust.mjs';
import {diagnosticCaPath} from './staging-binding-ca.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const cli=require.resolve('prisma/build/index.js');
const client=require.resolve('@prisma/client');
const raw='postgresql://postgres:CANARY@db.kdqnfruwgocfqwpbpuxo.supabase.co:5432/postgres';
const stopped='Rollout stopped. Keep the hold/pause; read back ledger/schema before a separately approved next action. No automatic retry.\n';
function command(binary,args,options={}) {
  const r=spawnSync(binary,args,{cwd:root,stdio:'pipe',timeout:30000,...options});
  assert.equal(r.status,0,'Synthetic fixture setup failed');return r.stdout.toString().trim();
}
async function certificates(dir) {
  for(const ca of ['ca','other'])command('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',ca+'.key','-out',ca+'.crt','-subj','/CN=Migration synthetic '+ca,'-days','2',
    '-addext','basicConstraints=critical,CA:TRUE'],{cwd:dir});
  command('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost'],{cwd:dir});
  await mkdir(join(dir,'issued'));await writeFile(join(dir,'index'),'');await writeFile(join(dir,'serial'),'01\n');
  await writeFile(join(dir,'ca.conf'),`[ca]
default_ca=local
[local]
database=index
serial=serial
new_certs_dir=issued
certificate=ca.crt
private_key=ca.key
default_md=sha256
default_days=2
policy=subject
unique_subject=no
[subject]
commonName=supplied
`);
  for(const [name,san,dates] of [['trusted','DNS:localhost,IP:127.0.0.1',[]],
    ['mismatch','DNS:wrong.invalid',[]],['expired','DNS:localhost,IP:127.0.0.1',
      ['-startdate','20210101000000Z','-enddate','20210102000000Z']]]) {
    await writeFile(join(dir,'leaf.ext'),`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
    command('openssl',['ca','-config','ca.conf','-batch','-notext','-in','server.csr',
      '-out',name+'.crt','-extfile','leaf.ext',...dates],{cwd:dir});
  }
  await writeFile(join(dir,'tampered.crt'),'invalid synthetic certificate\n');
}
async function postgres(dir,cert,fn) {
  const name='migration-tls-'+randomUUID();
  // Own isolated container, dynamic IPv4 loopback port, no persistent volume.
  command('docker',['create','--name',name,'--publish','127.0.0.1::5432',
    '--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD=ci_only','--env','POSTGRES_DB=tls_fixture',
    '--entrypoint','/bin/bash','pgvector/pgvector:pg16','-c',
    'chown postgres:postgres /tmp/server.key /tmp/server.crt; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key']);
  try {
    command('docker',['cp',join(dir,'server.key'),name+':/tmp/server.key']);
    command('docker',['cp',join(dir,cert+'.crt'),name+':/tmp/server.crt']);command('docker',['start',name]);
    let ready=false;
    for(let i=0;i<100;i++) {
      const r=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','tls_fixture'],{stdio:'pipe',timeout:3000});
      if(r.status===0){ready=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(ready,true,'Synthetic PostgreSQL did not become ready');
    const port=command('docker',['port',name,'5432/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
    assert.ok(port,'Refusing a non-loopback fixture');
    await fn(port);
  } finally {command('docker',['rm','--force','--volumes',name]);}
}
async function schema(dir) {
  const path=join(dir,'schema.prisma');
  await writeFile(path,'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n');
  await mkdir(join(dir,'migrations','20200101000000_tls_probe'),{recursive:true});
  await writeFile(join(dir,'migrations','migration_lock.toml'),'provider = "postgresql"\n');
  await writeFile(join(dir,'migrations','20200101000000_tls_probe','migration.sql'),'CREATE TABLE public.migration_tls_probe (value integer);\n');
  return path;
}
function query(url,sql="SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()") {
  const code=`const {PrismaClient,Prisma}=require(${JSON.stringify(client)});
    if(Prisma.prismaVersion.client!=='6.19.3'||Prisma.prismaVersion.engine!=='c2990dca591cba766e3b7ef5d9e8a84796e47ab7')process.exit(2);
    const db=new PrismaClient({datasourceUrl:process.env.DATABASE_URL,log:[]});
    (async()=>{try{await db.$connect();const rows=await db.$queryRawUnsafe(${JSON.stringify(sql)});process.stdout.write(JSON.stringify(rows));}
      catch(e){const code=e.errorCode??e.code;process.stdout.write(typeof code==='string' && /^P[0-9]{4}$/.test(code)?code:'UNKNOWN');process.exitCode=1;}
      finally{try{await db.$disconnect();}catch{process.exitCode=1;}}})();`;
  return spawnSync(process.execPath,['-e',code],{cwd:root,env:{DATABASE_URL:url,NODE_ENV:'production'},encoding:'utf8',timeout:10000});
}
function migrate(url,path) {
  return spawnSync(process.execPath,[cli,'migrate','deploy','--schema',path],{
    cwd:root,env:{DATABASE_URL:url,PATH:process.env.PATH,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'},encoding:'utf8',timeout:30000});
}
test('migration routing rejects security/routing overrides and uses the reviewed fixed CA',()=>{
  for(const value of [raw,raw.replace('postgres:CANARY@db.kdqnfruwgocfqwpbpuxo.supabase.co',
    'postgres.kdqnfruwgocfqwpbpuxo:CANARY@aws-0-us-west-2.pooler.supabase.com')]) {
    const u=new URL(migrationConnection(value));assert.equal(u.searchParams.get('sslcert'),diagnosticCaPath);
    assert.equal(u.searchParams.get('sslmode'),'require');assert.equal(u.searchParams.get('sslaccept'),'strict');
    assert.equal(u.searchParams.get('connect_timeout'),'5');assert.equal(u.searchParams.get('pool_timeout'),'5');
    assert.equal(migrationConnection(u.toString()),u.toString());
  }
  for(const options of ['sslmode=disable','sslmode=verify-full','sslaccept=accept_invalid_certs','sslcert=/tmp/arbitrary.crt',
    'sslrootcert=/tmp/arbitrary.crt','sslidentity=/tmp/arbitrary.p12','host=127.0.0.1','options=-c%20role%3Dapp_user',
    'schema=public&schema=public','pgbouncer=true','sslcert='+encodeURIComponent(diagnosticCaPath)+'&sslcert='+encodeURIComponent(diagnosticCaPath)])
    assert.throws(()=>migrationConnection(raw+'?'+options));
  for(const value of [raw.replace(':5432',':6543'),raw.replace('/postgres','/other'),raw.replace('CANARY',''),
    raw.replace('db.kdqnfruwgocfqwpbpuxo.supabase.co','other.pooler.supabase.com'),raw+'#fragment'])assert.throws(()=>migrationConnection(value));
});
test('actual query and migration engines enforce strict TLS against disposable PostgreSQL',{timeout:180000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'migration-native-tls-'));
  try {
    await certificates(dir);const path=await schema(dir);
    const version=command(process.execPath,[cli,'--version'],{env:{PATH:process.env.PATH,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'}});
    assert.match(version,/prisma\s+: 6\.19\.3/);assert.match(version,/Schema Engine\s+: schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7/);
    for(const [leaf,ca,expectPass] of [['trusted','ca.crt',true],['trusted','other.crt',false],
      ['expired','ca.crt',false],['mismatch','ca.crt',false],['trusted','missing.crt',false],['trusted','tampered.crt',false]])
      await postgres(dir,leaf,async port=>{
        // Adapt routing and CA only inside this test; all TLS settings come from
        // the production normalizer. No hosted local-target/trust input is added.
        const u=new URL(migrationConnection(raw));u.hostname='localhost';u.port=port;u.pathname='/tls_fixture';u.password='ci_only';
        u.searchParams.set('sslcert',join(dir,ca));
        const q=query(u.toString()),m=migrate(u.toString(),path),label=leaf+'/'+ca;
        assert.equal(q.stderr.length,0,label);assert.equal(q.signal,null,label);assert.equal(m.signal,null,label);
        if(expectPass) {
          assert.equal(q.status,0,label);assert.equal(q.stdout,'[{"ssl":true}]',label);assert.equal(m.status,0,label);
          const ledger=query(u.toString(),"SELECT count(*)::int AS completed FROM public._prisma_migrations WHERE finished_at IS NOT NULL");
          assert.equal(ledger.status,0,label);assert.equal(ledger.stdout,'[{"completed":1}]',label);
        } else {assert.notEqual(q.status,0,label);assert.notEqual(m.status,0,label);
          if(['expired','mismatch'].includes(leaf)||ca==='other.crt') {
            assert.equal(q.stdout,'P1011',label);assert.equal((m.stdout+m.stderr).includes('P1011'),true,label);
          }}
        if(leaf==='mismatch') {
          // Negative control proves hostname refusal; permissive settings are test-only.
          u.searchParams.set('sslaccept','accept_invalid_certs');
          const permissive=query(u.toString()),permissiveMigration=migrate(u.toString(),path);
          assert.equal(permissive.status,0,'Hostname negative control');assert.equal(permissiveMigration.status,0,'Migration hostname negative control');
        }
      });
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('packaged runner rejects unsafe URLs and missing/tampered CA before either engine starts',async()=>{
  for(const fault of ['missing','tampered','symlink','pem-pin','der-pin','missing-pin','unsafe-tls','arbitrary-ca','routing-override','valid-control']) {
    const dir=await mkdtemp(join(tmpdir(),'migration-trust-refusal-'));
    try {
      await cp(join(root,'scripts'),join(dir,'scripts'),{recursive:true});
      const cert=join(dir,'scripts/certificates/supabase-prod-ca-2021.crt');
      if(fault==='missing')await rm(cert);
      if(fault==='tampered')await writeFile(cert,(await readFile(cert)).toString().replace('MII','NII'));
      if(fault==='symlink'){await rm(cert);await symlink(diagnosticCaPath,cert);}
      const caModule=join(dir,'scripts/staging-binding-ca.mjs');
      if(fault==='pem-pin')await writeFile(caModule,(await readFile(caModule,'utf8')).replace('70072358','00072358'));
      if(fault==='der-pin')await writeFile(caModule,(await readFile(caModule,'utf8')).replace('807025ad','007025ad'));
      if(fault==='missing-pin')await writeFile(caModule,(await readFile(caModule,'utf8')).replace(/const pemSha256='[^']+';/,"const pemSha256='';"));
      await mkdir(join(dir,'packages/db/node_modules/@prisma/client'),{recursive:true});
      await writeFile(join(dir,'packages/db/package.json'),'{}');const marker=join(dir,'engine-started');
      await writeFile(join(dir,'packages/db/node_modules/@prisma/client/index.js'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'CANARY');throw Error('CANARY');`);
      let url=raw;
      if(fault==='unsafe-tls')url+='?sslaccept=accept_invalid_certs';
      if(fault==='arbitrary-ca')url+='?sslcert=/tmp/arbitrary.crt';
      if(fault==='routing-override')url+='?host=127.0.0.1';
      const r=spawnSync(process.execPath,[join(dir,'scripts/rejection-rollout.mjs')],{cwd:dir,env:{DATABASE_URL:url,PATH:process.env.PATH},encoding:'utf8',timeout:5000});
      assert.equal(r.status,1,fault);assert.equal(r.stdout,'',fault);assert.equal(r.stderr,stopped,fault);
      if(fault==='valid-control')assert.equal(await readFile(marker,'utf8'),'CANARY');
      else await assert.rejects(readFile(marker),{code:'ENOENT'});
    } finally {await rm(dir,{recursive:true,force:true});}
  }
});
test('packaged runner forwards one strict URL to both actual engines and suppresses CLI/cleanup errors',{timeout:60000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'migration-forwarding-'));
  try {
    await certificates(dir);const path=await schema(dir);
    await postgres(dir,'trusted',async port=>{
      for(const cleanupFailure of [false,true]) {
        const pkg=await mkdtemp(join(dir,'package-'));
        await cp(join(root,'scripts'),join(pkg,'scripts'),{recursive:true});
        await mkdir(join(pkg,'packages/db/node_modules/@prisma/client'),{recursive:true});
        await writeFile(join(pkg,'packages/db/package.json'),'{}');
        const queryMarker=join(pkg,'query-url'),cliMarker=join(pkg,'migration-url');
        const adapt=`const u=new URL(input);
          if(u.searchParams.get('sslmode')!=='require'||u.searchParams.get('sslaccept')!=='strict')throw Error('CANARY_TLS');
          u.hostname='localhost';u.port=${JSON.stringify(port)};u.pathname='/tls_fixture';u.password='ci_only';
          u.searchParams.set('sslcert',${JSON.stringify(join(dir,'ca.crt'))});return u.toString();`;
        await writeFile(join(pkg,'packages/db/node_modules/@prisma/client/index.js'),
          `const {PrismaClient}=require(${JSON.stringify(client)}),fs=require('node:fs');
          function local(input){fs.writeFileSync(${JSON.stringify(queryMarker)},input);${adapt}}
          module.exports.PrismaClient=class extends PrismaClient {
            constructor(options){super({...options,datasourceUrl:local(options.datasourceUrl)});}
            async $disconnect(){await super.$disconnect();if(${JSON.stringify(cleanupFailure)})throw Error('CANARY_CLEANUP');}
          };`);
        await writeFile(join(pkg,'scripts/rejection-rollout-core.mjs'),
          `export async function runRollout({db,migrate,phase}) {
            const [{ssl}]=await db.$queryRawUnsafe('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
            if(!ssl)throw Error('CANARY_PLAIN');await migrate(${JSON.stringify(path)});
            const [{completed}]=await db.$queryRawUnsafe('SELECT count(*)::int AS completed FROM public._prisma_migrations WHERE finished_at IS NOT NULL');
            if(completed!==1)throw Error('CANARY_LEDGER');return {phase,completed:49};
          }`);
        await mkdir(join(pkg,'bin'));
        await writeFile(join(pkg,'bin/pnpm'),`#!${process.execPath}
          const fs=require('node:fs'),{spawnSync}=require('node:child_process');
          const input=process.env.DATABASE_URL;fs.writeFileSync(${JSON.stringify(cliMarker)},input);
          function local(input){${adapt}}
          const args=process.argv.slice(2),rest=args.slice(args.indexOf('prisma')+1);
          const r=spawnSync(process.execPath,[${JSON.stringify(cli)},...rest],
            {env:{DATABASE_URL:local(input),PATH:process.env.PATH,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'},stdio:'pipe',timeout:30000});
          process.stdout.write('CANARY_NATIVE_OUTPUT');process.stderr.write('CANARY_NATIVE_ERROR');process.exit(r.status??1);
        `,{mode:0o755});
        const sha='a'.repeat(40);
        const r=spawnSync(process.execPath,[join(pkg,'scripts/rejection-rollout.mjs')],{
          cwd:pkg,encoding:'utf8',timeout:45000,env:{DATABASE_URL:raw,PATH:join(pkg,'bin')+':'+process.env.PATH,
            GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'MichalKuderski',
            GITHUB_TRIGGERING_ACTOR:'MichalKuderski',GITHUB_SHA:sha,ROLLOUT_PHASE:'pause',
            ROLLOUT_APPROVAL:`pause:${sha}:kdqnfruwgocfqwpbpuxo`,
            ROLLOUT_EVIDENCE:'https://github.com/MichalKuderski/AutoBureau/pull/17#issuecomment-123'}});
        assert.equal(r.signal,null);assert.equal(r.status,cleanupFailure?1:0);
        assert.equal(r.stdout,cleanupFailure?'':'Verified pause; completed ledger entries: 49. No deployment performed.\n');
        assert.equal(r.stderr,cleanupFailure?stopped:'');
        const q=await readFile(queryMarker,'utf8'),m=await readFile(cliMarker,'utf8');assert.equal(q,m);
        const u=new URL(q);assert.equal(u.searchParams.get('sslcert'),join(pkg,'scripts/certificates/supabase-prod-ca-2021.crt'));
        assert.equal(u.searchParams.get('sslaccept'),'strict');assert.equal(u.searchParams.get('sslmode'),'require');
      }
    });
  } finally {await rm(dir,{recursive:true,force:true});}
});
