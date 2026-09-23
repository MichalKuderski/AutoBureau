import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyArtifact } from './adr016-saved-plan.mjs';
import { reviewDeploymentGrant, grantNegativeControls } from './adr016-plan-review.mjs';
const grant=JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-reviewed-grant.json',import.meta.url),'utf8'));
const bootstrap=JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-state-bootstrap.json',import.meta.url),'utf8'));
test('grant stays within live immutable boundary and expires',()=>{
  assert.equal(reviewDeploymentGrant(grant,bootstrap).status,'PASS');
  assert.equal(grantNegativeControls(grant,bootstrap),6);
});
test('unreviewed, corrupt or substituted artifact is refused before parsing',()=>{
  for(const binary of [Buffer.from('different plan'),Buffer.alloc(0)]) {
    assert.throws(()=>verifyArtifact({binary,json:Buffer.from('{}'),sourceSha:'wrong',run:{}}),/STOP/);
  }
});
