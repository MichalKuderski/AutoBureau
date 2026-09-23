/** Native Vercel storage probes: exact staging project; no stable alias promotion. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { stagingApi, snapshot, assertUnchanged, PROJECT, TEAM, STABLE } from './staging-stable-oidc-proof.mjs';
import { safeReceipt } from './staging-storage-probe-runner.mjs';
const generated=/^autobureau-staging-(?:[a-z0-9-]+-)?data-analyst-mike\.vercel\.app$/;
export function verifyProofDeployment(deployment,before,scope) {
  if(!['production','preview'].includes(scope) || deployment?.projectId!==PROJECT || deployment.name!=='autobureau-staging'
    || !/^dpl_[A-Za-z0-9]+$/.test(deployment.id) || deployment.id===before.stable.deploymentId || !generated.test(deployment.url)
    || (scope==='production'?deployment.target!=='production':![null,undefined,'preview'].includes(deployment.target))) throw new Error('Unexpected storage proof deployment');
}
async function build(env,scope) {
  const args=['deploy','--yes','--logs',...(scope==='production'?['--prod','--skip-domain']:[]),
    '--build-env','PELLUM_STAGING_OIDC_PROOF=1','--build-env','PELLUM_STAGING_STORAGE_PROBE=1',
    '--build-env',`PELLUM_STAGING_OIDC_SCOPE=${scope}`,'--build-env',`VERCEL_PROJECT_ID=${PROJECT}`,
    '--build-env',`VERCEL_ORG_ID=${TEAM}`,`--token=${env.VERCEL_TOKEN}`];
  return new Promise((resolve,reject)=>{
    const child=spawn('vercel',args,{env,stdio:['ignore','pipe','pipe']});let out='',err='';
    const capture=(kind,data)=>{if(kind==='out')out+=data;else err+=data;if(out.length+err.length>10_000_000)child.kill();};
    child.stdout.on('data',d=>capture('out',d));child.stderr.on('data',d=>capture('err',d));
    child.on('error',()=>reject(new Error('Native storage proof could not start')));
    child.on('close',code=>{
      try {
        const marker='PELLUM_STORAGE_PROBE ';
        const line=`${out}\n${err}`.split('\n').find(l=>l.includes(marker));
        const receipt=line?safeReceipt(JSON.parse(line.slice(line.indexOf(marker)+marker.length))):null;
        const host=out.trim().split(/\s+/).map(s=>s.replace(/^https:\/\//,'')).find(s=>generated.test(s))??null;
        resolve({succeeded:code===0,host,receipt});
      }catch{reject(new Error('Native storage receipt rejected; provider output withheld'));}
    });
  });
}
export async function run(env=process.env) {
  const api=stagingApi(env);await mkdir('.vercel',{recursive:true});
  await writeFile('.vercel/project.json',JSON.stringify({orgId:TEAM,projectId:PROJECT,projectName:'autobureau-staging'}));
  const evidence={capturedAt:new Date().toISOString(),sourceSha:env.GITHUB_SHA,productionApplicationAccessed:false,scopes:[]};
  const save=()=>writeFile('staging-storage-provider-proof.json',JSON.stringify(evidence,null,2));
  for(const scope of ['preview','production']) {
    const before=await snapshot(api);const result=await build(env,scope);const after=await snapshot(api);
    const record={scope,before,after,...result,aliases:[],publicProbes:[],removed:false};evidence.scopes.push(record);await save();
    assertUnchanged(before,after);
    if(!result.succeeded || !result.host || !result.receipt)throw new Error('Native storage probe failed; preserved available fixture receipt');
    const deployment=await api(`/v13/deployments/${encodeURIComponent(result.host)}`);
    verifyProofDeployment(deployment,before,scope);
    record.deploymentId=deployment.id;
    const assigned=await api(`/v2/deployments/${deployment.id}/aliases`);
    if(!Array.isArray(assigned?.aliases))throw new Error('Storage proof aliases unavailable');
    record.aliases=assigned.aliases.map(a=>a.alias);await save();
    if(record.aliases.some(a=>a===STABLE||!generated.test(a)))throw new Error('Unexpected storage proof alias');
    for(const host of new Set([deployment.url,...record.aliases])) {
      const r=await fetch(`https://${host}/`,{redirect:'manual',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15_000)});
      const location=r.headers.get('location');const url=location?new URL(location,`https://${host}`):null;
      await r.arrayBuffer();
      record.publicProbes.push({host,status:r.status,externallyReachable:r.status<400 && !(url?.hostname==='vercel.com' && /sso|login|auth/.test(url.pathname))});
    }
    await save();
    if(record.publicProbes.some(p=>p.externallyReachable)) {
      assertUnchanged(before,await snapshot(api));
      const latest=await api(`/v2/deployments/${deployment.id}/aliases`);
      if(!Array.isArray(latest?.aliases)||latest.aliases.some(a=>a.alias===STABLE||!generated.test(a.alias)))throw new Error('Proof cleanup refused after alias drift');
      await api(`/v13/deployments/${deployment.id}`,'DELETE');
      if(await api(`/v13/deployments/${deployment.id}`))throw new Error('Disposable proof removal not confirmed');
      assertUnchanged(before,await snapshot(api));record.removed=true;await save();
    }
  }
  console.log('Both native staging storage scopes verified; receipts contain no capabilities or credentials');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await run();}catch(error){console.error(error instanceof Error?error.message:'Native storage proof failed');process.exitCode=1;}
}
