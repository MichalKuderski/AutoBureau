/** Capture all test output in memory; emit only an allow-listed synthetic receipt. */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
export function safeReceipt(value) {
  const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (!value || !['stg','preview'].includes(value.scope) || value.bucket!=='pellum-stg-quarantine-792394000571-us-east-2'
    || value.roleArn!==`arn:aws:iam::792394000571:role/pellum-${value.scope}-upload-signer`
    || value.intakeEnabled!==false || value.realTenantData!==false || value.productionApplicationAccessed!==false
    || !new RegExp(`^${uuid}$`).test(value.fixture?.household) || !new RegExp(`^${uuid}$`).test(value.fixture?.upload)
    || value.fixture.incoming!==`hh/${value.fixture.household}/upload/${value.fixture.upload}/incoming`
    || value.fixture.sealed?.length!==2 || !value.fixture.sealed.every(k=>new RegExp(`^hh/${value.fixture.household}/upload/${value.fixture.upload}/sealed/${uuid}$`).test(k))
    || !Array.isArray(value.results) || !value.results.every(r=>/^[a-z-]+$/.test(r.name) && ['PASS','FAIL'].includes(r.status))) throw new Error('Invalid synthetic receipt');
  return {evidenceSource:'vercel-native-build',scope:value.scope,bucket:value.bucket,roleArn:value.roleArn,
    intakeEnabled:false,realTenantData:false,productionApplicationAccessed:false,
    fixture:{household:value.fixture.household,upload:value.fixture.upload,incoming:value.fixture.incoming,sealed:value.fixture.sealed},
    results:value.results.map(({name,status})=>({name,status})),
    incomingCleanup:'requires-exact-operator-cleanup',sealedCleanup:value.sealedCleanup===true};
}
async function silent(args) {
  return new Promise(resolve=>{
    const child=spawn('pnpm',args,{stdio:['ignore','pipe','pipe']});let size=0;
    const discard=chunk=>{size+=chunk.length;if(size>5_000_000)child.kill();};
    child.stdout.on('data',discard);child.stderr.on('data',discard);
    child.on('error',()=>resolve(false));child.on('close',code=>resolve(code===0));
  });
}
export async function runStorageProbe(emit=console.log) {
  if (!await silent(['--filter','@autobureau/contracts','build'])) throw new Error('Synthetic probe prerequisite build failed');
  const ok=await silent(['--filter','@autobureau/web','exec','vitest','run','--config','vitest.storage-probe.config.ts']);
  let receipt;
  try { receipt=safeReceipt(JSON.parse(await readFile(new URL('../apps/web/staging-storage-native-receipt.json',import.meta.url),'utf8'))); }
  catch { throw new Error('Synthetic probe receipt unavailable; provider output withheld'); }
  emit(`PELLUM_STORAGE_PROBE ${JSON.stringify(receipt)}`);
  if(!ok || receipt.results.some(r=>r.status==='FAIL'))throw new Error('Synthetic storage probe failed; details limited to result names');
}
