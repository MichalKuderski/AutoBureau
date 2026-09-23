import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSettings } from './staging-oidc-settings.mjs';
const project = { id: 'prj_staging', accountId: 'team_staging', name: 'autobureau-staging', oidcTokenConfig: { enabled: true, issuerMode: 'team' }, unrelatedSecret: 'never-export-this' };
const owner = { id: 'team_staging', slug: 'data-analyst-mike', billing: { plan: 'hobby', other: 'never-export-this' } };
const inputs = { token: 'synthetic-secret', teamId: owner.id, projectId: project.id };
test('only validated staging project metadata is exported', async () => {
  const paths = [];
  const result = await inspectSettings({ ...inputs, request: async url => { paths.push(url.pathname); return Response.json(paths.length === 1 ? project : owner); } });
  assert.deepEqual(paths, ['/v9/projects/prj_staging', '/v2/teams/team_staging']);
  assert.equal(result.issuerMode, 'team');
  assert.equal(result.liveClaimsVerified, false);
  assert.ok(!JSON.stringify(result).includes('never-export-this'));
  assert.ok(!JSON.stringify(result).includes(inputs.token));
});
test('wrong project stops before any further read', async () => {
  let calls = 0;
  await assert.rejects(inspectSettings({ ...inputs, request: async () => { calls++; return Response.json({ ...project, name: 'autobureau' }); } }), /identity mismatch/);
  assert.equal(calls, 1);
});
test('wrong team and absent OIDC mode are never accepted as evidence', async () => {
  let calls = 0;
  await assert.rejects(inspectSettings({ ...inputs, request: async () => Response.json(++calls === 1 ? project : { ...owner, slug: 'another-team' }) }), /identity mismatch/);
  calls = 0;
  const result = await inspectSettings({ ...inputs, request: async () => Response.json(++calls === 1 ? { ...project, oidcTokenConfig: undefined } : owner) });
  assert.equal(result.issuerMode, null);
  assert.equal(result.liveClaimsVerified, false);
});
test('transport failures and error bodies cannot expose credentials', async () => {
  for (const request of [async () => { throw new Error(inputs.token); }, async () => new Response(inputs.token, { status: 403 })]) {
    await assert.rejects(inspectSettings({ ...inputs, request }), error => !String(error).includes(inputs.token));
  }
});
