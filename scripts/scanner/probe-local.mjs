import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {scannerSpec,verifyScannerContainer,localDockerRuntime,runSandboxScanner} from '../scanner-sandbox.mjs';
const docker='/usr/local/bin/docker',socket=process.argv[2];
const base=JSON.parse(readFileSync(new URL('./local-release.json',import.meta.url)));
const observedBase=JSON.parse(execFileSync(docker,['--host',socket,'image','inspect','pellum-local-scanner:adr018-20260920']).toString())[0].Id;
if(observedBase!==base.image || !process.argv[3])throw new Error('Pinned local proof image/output required');
const modes={ controls:`#!/bin/sh
id -u
awk '/CapEff|NoNewPrivs|Seccomp:/{print}' /proc/self/status
cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max
ulimit -n
if touch /root-write-test 2>/dev/null; then echo ROOT_WRITABLE; else echo ROOT_READONLY; fi
cp /bin/busybox /tmp/probe
if /tmp/probe true 2>/dev/null; then echo TMP_EXEC; else echo TMP_NOEXEC; fi
if dd if=/dev/zero of=/tmp/full bs=1048576 count=80 2>/dev/null; then echo TMP_UNBOUNDED; else echo TMP_BOUNDED; fi
rm -f /tmp/full
cat /proc/net/route
if wget -q -T 1 -O /tmp/net http://1.1.1.1/ 2>/dev/null; then echo NETWORK_ALLOWED; else echo NETWORK_DENIED; fi
`,hang:'#!/bin/sh\nsleep 300 &\nwait\n',crash:'#!/bin/sh\nexit 70\n',overflow:'#!/bin/sh\nyes INVALID\n'};
const results=[];
for (const [mode,script] of Object.entries(modes)) {
 const dir=mkdtempSync('/private/tmp/pellum-scanner-proof-');
 try{
 writeFileSync(dir+'/probe',script);writeFileSync(dir+'/Dockerfile','FROM pellum-local-scanner:adr018-20260920\nCOPY --chmod=0555 probe /scanner/scan\n');
 const image=execFileSync(docker,['--host',socket,'build','--quiet','--platform','linux/amd64','--network=none','--pull=false',dir],{stdio:['ignore','pipe','ignore'],timeout:60000}).toString().trim();
 const release={...base,image},runtime=localDockerRuntime(socket),spec=scannerSpec(release,randomUUID());const result={mode,image};const start=Date.now();
 if(mode==='controls'){
 try{await runtime.create(spec,AbortSignal.timeout(5000));verifyScannerContainer(await runtime.inspect(spec,AbortSignal.timeout(5000)),spec);
 result.observed=(await runtime.run(spec,Buffer.from('PUBLIC'),AbortSignal.timeout(5000))).toString();}
 catch(e){result.error=e.message;}finally{await runtime.destroy(spec,AbortSignal.timeout(5000));}
 }else{
 try{await runSandboxScanner(runtime,release,{nonce:randomUUID(),bytes:Buffer.from('%PDF-1.4\nPUBLIC\n%%EOF\n')},new AbortController().signal);result.unexpectedSuccess=true;}
 catch(e){result.error=e.message;}
 }
 result.seconds=(Date.now()-start)/1000;result.remaining=execFileSync(docker,['--host',socket,'ps','--all','--filter','ancestor='+image,'--format','{{.Names}}']).toString().trim();results.push(result);process.stdout.write(JSON.stringify(result)+'\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
 writeFileSync(process.argv[3],JSON.stringify(results,null,2));
}

const controls=results.find(x=>x.mode==='controls');
const expected=['65532','CapEff:\t0000000000000000','NoNewPrivs:\t1','Seccomp:\t2','3221225472','100000 100000','16','64','ROOT_READONLY','TMP_NOEXEC','TMP_BOUNDED','NETWORK_DENIED'];
if(!expected.every(x=>controls?.observed?.includes(x)) || results.some(x=>x.remaining || x.unexpectedSuccess)
 || results.find(x=>x.mode==='hang')?.error!=='scanner deadline'
 || results.find(x=>x.mode==='crash')?.error!=='scanner runtime failed')process.exitCode=1;
