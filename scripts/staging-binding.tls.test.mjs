// Real native Prisma engine; synthetic certificates/credentials and loopback only.
// Imported by staging-binding.test.mjs so the existing isolated CI job runs these.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createSecureContext,TLSSocket} from 'node:tls';
import {connection,project} from './staging-binding-policy.mjs';
import {verifyDiagnosticCa,diagnosticCaPath} from './staging-binding-ca.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
function command(args,cwd) {
  const result=spawnSync('openssl',args,{cwd,stdio:'pipe',timeout:15000});
  assert.equal(result.status,0,'Synthetic certificate setup failed');
}
async function certificates(dir) {
  command(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt',
    '-subj','/CN=Diagnostic synthetic root','-days','2','-addext','basicConstraints=critical,CA:TRUE'],dir);
  command(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','other.key','-out','other.crt',
    '-subj','/CN=Diagnostic untrusted root','-days','2','-addext','basicConstraints=critical,CA:TRUE'],dir);
  command(['req','-new','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost'],dir);
  await mkdir(join(dir,'issued'));
  await writeFile(join(dir,'index'),'');await writeFile(join(dir,'serial'),'01\n');
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
  for(const [name,san,dates] of [
    ['trusted','DNS:localhost,IP:127.0.0.1',[]],
    ['mismatch','DNS:wrong.invalid',[]],
    ['expired','DNS:localhost,IP:127.0.0.1',['-startdate','20210101000000Z','-enddate','20210102000000Z']]]) {
    await writeFile(join(dir,'leaf.ext'),`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
    command(['ca','-config','ca.conf','-batch','-notext','-in','server.csr','-out',name+'.crt','-extfile','leaf.ext',...dates],dir);
  }
}
function message(type,payload) {
  const length=Buffer.alloc(4);length.writeInt32BE(payload.length+4);
  return Buffer.concat([Buffer.from(type),length,payload]);
}
// Implements only SSL negotiation and PostgreSQL startup, enough for $connect().
// Negative cases must fail before PostgreSQL startup, in the actual engine.
async function fixture(dir,name) {
  const context=createSecureContext({key:await readFile(join(dir,'server.key')),cert:await readFile(join(dir,name+'.crt'))});
  const sockets=new Set();let startups=0,sslRequests=0;
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let initial=Buffer.alloc(0);
    function negotiate(chunk) {
      initial=Buffer.concat([initial,chunk]);if(initial.length<8)return;
      assert.equal(initial.length,8);assert.equal(initial.readInt32BE(0),8);
      assert.equal(initial.readInt32BE(4),80877103);sslRequests++;
      socket.removeListener('data',negotiate);socket.write('S');
      const tls=new TLSSocket(socket,{isServer:true,secureContext:context});
      sockets.add(tls);tls.on('close',()=>sockets.delete(tls));tls.on('error',()=>{});
      let startup=Buffer.alloc(0);
      function authenticate(data) {
        startup=Buffer.concat([startup,data]);if(startup.length<4 || startup.length<startup.readInt32BE(0))return;
        startups++;tls.removeListener('data',authenticate);
        const auth=Buffer.alloc(4);auth.writeInt32BE(0);
        tls.write(Buffer.concat([message('R',auth),
          ...['server_version\x0016.0\x00','client_encoding\x00UTF8\x00','standard_conforming_strings\x00on\x00','integer_datetimes\x00on\x00'].map(p=>message('S',Buffer.from(p))),
          message('K',Buffer.alloc(8)),message('Z',Buffer.from('I'))]));
      }
      tls.on('data',authenticate);
    }
    socket.on('data',negotiate);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {port:server.address().port,counts:()=>({startups,sslRequests}),
    close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function child(source,env={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,['--input-type=module','-e',source],
      {cwd:root,env:{NODE_ENV:'production',...env},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>p.kill('SIGKILL'),10000);
    p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
    p.on('error',reject);p.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
  });
}
test('native Prisma 6.19.3 validates trusted, untrusted, expired and mismatched server certificates',{timeout:60000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'binding-native-tls-'));
  try {
    await certificates(dir);
    for(const [name,ca,accept,host,expected] of [
      ['trusted','ca.crt','strict','localhost','PASS'],['trusted','ca.crt','strict','127.0.0.1','PASS'],
      ['trusted','other.crt','strict','localhost','TLS_FAILURE'],
      ['expired','ca.crt','strict','localhost','TLS_FAILURE'],['mismatch','ca.crt','strict','localhost','TLS_FAILURE'],
      // Negative control: confirms that the fixture can connect when hostname checks are disabled.
      // This option never enters the hosted policy, which rejects it.
      ['mismatch','ca.crt','accept_invalid_certs','localhost','PASS']]) {
      const server=await fixture(dir,name);
      try {
        // Derive actual production TLS settings, replace only synthetic routing/CA in this test.
        const u=new URL(connection(`postgresql://postgres:CANARY@db.${project}.supabase.co/postgres`));
        u.hostname=host;u.port=String(server.port);u.searchParams.set('sslcert',join(dir,ca));
        u.searchParams.set('sslaccept',accept);
        const result=await child(`import {createRequire} from 'node:module';
          import {createClient} from ${JSON.stringify(new URL('./staging-binding-client.mjs',import.meta.url).href)};
          import {structuredReason} from ${JSON.stringify(new URL('./staging-binding-protocol.mjs',import.meta.url).href)};
          const require=createRequire(${JSON.stringify(new URL('../packages/db/package.json',import.meta.url).href)});
          const {Prisma}=require('@prisma/client');
          if(Prisma.prismaVersion.client!=='6.19.3' || Prisma.prismaVersion.engine!=='c2990dca591cba766e3b7ef5d9e8a84796e47ab7')process.exit(2);
          const db=createClient(process.env.DATABASE_URL);
          try {await db.$connect();process.stdout.write('PASS');}
          catch(e){process.stdout.write(structuredReason(e));}
          finally {await db.$disconnect();}`,{DATABASE_URL:u.toString()});
        assert.equal(result.code,0,name);assert.equal(result.signal,null,name);assert.equal(result.stderr,'',name);
        assert.equal(result.stdout,expected,name);assert.ok(server.counts().sslRequests>0,name);
        assert.equal(server.counts().startups,expected==='PASS'?1:0,name);
      } finally {await server.close();}
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('fixed CA validation rejects missing/tampered files and missing/tampered pins before driver construction',async()=>{
  verifyDiagnosticCa();
  const caModule=await readFile(new URL('./staging-binding-ca.mjs',import.meta.url),'utf8');
  for(const fault of ['missing','tampered','symlink','pem-pin','der-pin','missing-pem-pin','missing-der-pin']) {
    const dir=await mkdtemp(join(tmpdir(),'binding-ca-pin-'));
    try {
      for(const path of ['scripts','ops/staging-rejection','packages/db/prisma/migrations'])
        await cp(join(root,path),join(dir,path),{recursive:true});
      const cert=join(dir,'scripts/certificates/supabase-prod-ca-2021.crt');
      if(fault==='missing')await rm(cert);
      if(fault==='tampered')await writeFile(cert,(await readFile(cert)).toString().replace('MII','NII'));
      if(fault==='symlink'){await rm(cert);await symlink(diagnosticCaPath,cert);}
      if(fault==='pem-pin')await writeFile(join(dir,'scripts/staging-binding-ca.mjs'),caModule.replace('70072358','00072358'));
      if(fault==='der-pin')await writeFile(join(dir,'scripts/staging-binding-ca.mjs'),caModule.replace('807025ad','007025ad'));
      if(fault==='missing-pem-pin')await writeFile(join(dir,'scripts/staging-binding-ca.mjs'),caModule.replace(/const pemSha256='[^']+';/,"const pemSha256='';"));
      if(fault==='missing-der-pin')await writeFile(join(dir,'scripts/staging-binding-ca.mjs'),caModule.replace(/const derSha256='[^']+';/,"const derSha256='';"));
      const preflight=spawnSync(process.execPath,[join(dir,'scripts/staging-binding-ca.mjs')],{env:{},encoding:'utf8',timeout:5000});
      assert.equal(preflight.status,1,fault);assert.equal(preflight.stdout,'DIAGNOSTIC_CA FAIL\n',fault);
      assert.equal(preflight.stderr,'',fault);
      await mkdir(join(dir,'packages/db/node_modules/@prisma/client'),{recursive:true});
      await writeFile(join(dir,'packages/db/package.json'),'{}');
      const marker=join(dir,'constructed');
      await writeFile(join(dir,'packages/db/node_modules/@prisma/client/index.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'CANARY');throw Error('CANARY');`);
      const sha='a'.repeat(40);
      const r=spawnSync(process.execPath,[join(dir,'scripts/staging-binding-diagnostic.mjs')],{
        cwd:dir,encoding:'utf8',timeout:5000,env:{
          GITHUB_REPOSITORY:'MichalKuderski/AutoBureau',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
          GITHUB_ACTOR:'MichalKuderski',GITHUB_TRIGGERING_ACTOR:'MichalKuderski',GITHUB_SHA:sha,
          DIAGNOSTIC_APPROVAL:`diagnostic:${sha}:${project}`,DATABASE_URL:`postgresql://postgres:CANARY@db.${project}.supabase.co/postgres`}});
      assert.equal(r.status,1,fault);assert.equal(r.stderr,'',fault);assert.ok(!r.stdout.includes('CANARY'),fault);
      assert.match(r.stdout,/AUTHORITY PASS\nROUTING PASS\nLOCAL_SETUP FAIL LOCAL_SETUP_FAILURE\nCONNECT NOT_RUN\n/,fault);
      await assert.rejects(readFile(marker),{code:'ENOENT'});
    } finally {await rm(dir,{recursive:true,force:true});}
  }
});
