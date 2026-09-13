import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, TEAM, STABLE, stagingApi, snapshot, assertUnchanged, assertProofDeployment, canRemoveProof, buildWithReadback } from './staging-stable-oidc-proof.mjs';
const env = { VERCEL_PROJECT_ID: PROJECT, VERCEL_STAGING_PROJECT_ID: PROJECT, VERCEL_ORG_ID: TEAM, VERCEL_TOKEN: 'synthetic-do-not-export' };
const project = { id: PROJECT, name: 'autobureau-staging', accountId: TEAM, oidcTokenConfig: { enabled: true, issuerMode: 'team' }, ssoProtection: { deploymentType: 'prod_deployment_urls_and_all_previews' }, passwordProtection: { deploymentType: 'preview', password: 'must-not-export' } };
const team = { id: TEAM, name: 'Data Analyst Mike', slug: 'data-analyst-mike' };
const alias = { alias: STABLE, uid: 'alias_test', projectId: PROJECT, deploymentId: 'dpl_stable' };
const stable = { id: 'dpl_stable', projectId: PROJECT, name: 'autobureau-staging', target: 'production', url: 'autobureau-staging-existing-data-analyst-mike.vercel.app', readyState: 'READY' };
const proof = { ...stable, id: 'dpl_proof', url: 'autobureau-staging-proof-data-analyst-mike.vercel.app' };
const api = async path => path.startsWith('/v9/') ? project : path.startsWith('/v2/teams/') ? team : path.startsWith('/v4/') ? alias : stable;

test('wrong linked project or team cannot make even the first provider call', () => {
  for (const altered of [{ VERCEL_PROJECT_ID: 'autobureau-production' }, { VERCEL_STAGING_PROJECT_ID: 'other' }, { VERCEL_ORG_ID: 'other' }, { VERCEL_TOKEN: '' }]) {
    assert.throws(() => stagingApi({ ...env, ...altered }, () => assert.fail('unexpected provider call')));
  }
});
test('snapshot retains protection posture and stable assignment, excluding secret fields', async () => {
  const value = await snapshot(api);
  assert.equal(value.stable.deploymentId, 'dpl_stable');
  assert.equal(value.protection.sso, 'prod_deployment_urls_and_all_previews');
  assert.equal(value.protection.passwordEnabled, true);
  assert.ok(!JSON.stringify(value).includes('must-not-export'));
});
test('live identity or stable alias mismatches stop the proof', async () => {
  for (const [prefix, altered] of [['/v9/', { ...project, id: 'other' }], ['/v2/teams/', { ...team, name: 'Other Team' }],
    ['/v4/', { ...alias, projectId: 'other' }], ['/v13/', { ...stable, name: 'autobureau-production' }]]) {
    await assert.rejects(snapshot(async path => path.startsWith(prefix) ? altered : api(path)));
  }
});
test('cleanup cannot delete stable, unrelated, reassigned or custom-domain deployments', async () => {
  const before = await snapshot(api);
  assert.equal(canRemoveProof(proof, before, before, []), true);
  assert.equal(canRemoveProof(proof, before, before, [proof.url]), true);
  assert.equal(canRemoveProof(proof, before, before, [STABLE]), false);
  assert.equal(canRemoveProof(proof, before, before, ['customer.example.com']), false);
  assert.throws(() => assertProofDeployment(stable, before));
  assert.throws(() => assertProofDeployment({ ...proof, projectId: 'other' }, before));
  const changed = structuredClone(before); changed.stable.deploymentId = proof.id;
  assert.throws(() => canRemoveProof(proof, before, changed, []));
  const protectionChanged = structuredClone(before); protectionChanged.protection.sso = null;
  assert.throws(() => assertUnchanged(before, protectionChanged));
});
test('provider errors never retain credentials or response bodies', async () => {
  const call = stagingApi(env, async () => new Response('private provider response', { status: 403 }));
  await assert.rejects(call(`/v9/projects/${PROJECT}`), { message: 'Staging provider GET returned HTTP 403' });
});
test('failed build still checks stable state and records incomplete alias evidence without raw errors', async () => {
  const before = await snapshot(api); const order = []; let evidence;
  await assert.rejects(buildWithReadback(async () => { order.push('build'); throw new Error('secret-build-output'); },
    async () => { order.push('inspect'); return before; }, before,
    async value => { order.push('record'); evidence = value; }), /alias inventory still required/);
  assert.deepEqual(order, ['build', 'inspect', 'record']);
  assert.equal(evidence.buildFailed, true); assert.equal(evidence.aliasInspectionComplete, false);
  assert.ok(!JSON.stringify(evidence).includes('secret-build-output'));
});
test('stable drift remains fatal even when the build also failed', async () => {
  const before = await snapshot(api); const after = structuredClone(before); after.stable.deploymentId = proof.id;
  await assert.rejects(buildWithReadback(async () => { throw new Error(); }, async () => after, before, async () => {}), /assignment or protection drift/);
});
