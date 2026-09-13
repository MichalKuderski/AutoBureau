/** Authenticate the immutable plan artifact before any Terraform apply. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reviewStoragePlan, negativeControls, reviewDeploymentGrant, grantNegativeControls } from './adr016-plan-review.mjs';
export const expected = Object.freeze({
  repository:'MichalKuderski/AutoBureau',runId:34777452159,
  workflow:'.github/workflows/staging-storage.yml',
  sourceSha:'8ebf4dbd8ff52230b9b2a2d0d89337eee1c1907b',
  binarySha256:'7c553fe2df069921c9cd201f947e0df8a6b54356e4aae02c4edbacbcc1db46c7',
  jsonSha256:'804b2bb84c64309ad0ca85f46caa0001be223b54d5bd3e888e51123c4d52c960',
});
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyArtifact({binary,json,sourceSha,run,now=Date.now()}) {
  try {
    assert.equal(hash(binary),expected.binarySha256);assert.equal(hash(json),expected.jsonSha256);
    assert.equal(sourceSha.trim(),expected.sourceSha);
    assert.equal(run.id,expected.runId);assert.equal(run.conclusion,'success');assert.equal(run.status,'completed');
    assert.equal(run.path,expected.workflow);assert.equal(run.event,'pull_request');
    assert.equal(run.head_sha,expected.sourceSha);assert.equal(run.head_branch,'codex/launch-foundations');
    assert.equal(run.repository.full_name,expected.repository);assert.equal(run.head_repository.full_name,expected.repository);
    assert.ok(now < Date.parse('2026-09-13T21:45:00Z'),'Sufficient time before deployment grant expiry');
    return JSON.parse(json);
  } catch { throw new Error('STOP: saved plan artifact or originating run failed verification'); }
}
export async function stageArtifact(directory,target,runFile) {
  const folder=join(directory,'_temp/adr016-plan');
  const binary=await readFile(join(folder,'storage.tfplan'));
  const json=await readFile(join(folder,'storage-plan.json'));
  const plan=verifyArtifact({binary,json,sourceSha:await readFile(join(folder,'source-sha.txt'),'utf8'),
    run:JSON.parse(await readFile(runFile,'utf8'))});
  const source=await readFile(new URL('../infra/terraform/envs/staging/storage/main.tf',import.meta.url),'utf8');
  const grant=JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-reviewed-grant.json',import.meta.url),'utf8'));
  const bootstrap=JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-state-bootstrap.json',import.meta.url),'utf8'));
  const receipt={...expected,...reviewStoragePlan(plan,source),negativeControls:negativeControls(plan,source),
    grant:{...reviewDeploymentGrant(grant,bootstrap),negativeControls:grantNegativeControls(grant,bootstrap)}};
  await copyFile(join(folder,'storage.tfplan'),target);await chmod(target,0o600);
  console.log(JSON.stringify(receipt));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { await stageArtifact(...process.argv.slice(2)); }
  catch { console.error('Saved plan verification failed; apply is forbidden');process.exitCode=1; }
}
