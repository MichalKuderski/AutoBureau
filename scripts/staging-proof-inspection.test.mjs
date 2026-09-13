import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates, since, until, claimEvidence } from './staging-proof-inspection.mjs';
import { PROJECT } from './staging-stable-oidc-proof.mjs';
test('recovery selects only the staging production-scope deployment from the failed run window', () => {
  const good = { name: 'autobureau-staging', target: 'production', createdAt: since + 1 };
  assert.deepEqual(selectCandidates({ deployments: [good, { ...good, name: 'autobureau-production' },
    { ...good, target: 'preview' }, { ...good, createdAt: since - 1 }, { ...good, createdAt: until + 1 }] }), [good]);
  assert.throws(() => selectCandidates({}));
});
const claims = { signatureVerified: true, environment: 'production', project_id: PROJECT,
  owner_id: 'team_CNQd2ynmaV1xtRhB6NMMeYBs', iss: 'https://oidc.vercel.com/data-analyst-mike',
  aud: 'https://vercel.com/data-analyst-mike', sub: 'owner:data-analyst-mike:project:autobureau-staging:environment:production' };
const event = value => ({ payload: { text: `PELLUM_OIDC_PROOF ${JSON.stringify(value)}` } });
test('native evidence refuses wrong scope, project, team, issuer, audience, subject and unverified claims', () => {
  for (const key of Object.keys(claims)) assert.throws(() => claimEvidence([event({ ...claims, [key]: 'wrong' })]));
  assert.throws(() => claimEvidence([]));
  assert.throws(() => claimEvidence([event(claims), event(claims)]));
});
test('recovered evidence excludes unrelated log content and unknown claim fields', () => {
  const result = claimEvidence([{ payload: { text: 'private build output' } }, event({ ...claims, token: 'must-not-export' })]);
  assert.equal(result.project_id, PROJECT);
  assert.ok(!JSON.stringify(result).includes('must-not-export'));
  assert.ok(!JSON.stringify(result).includes('private build output'));
});
