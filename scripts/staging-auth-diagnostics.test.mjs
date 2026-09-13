import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAuthRecords, readStableAuthDiagnostics } from './staging-auth-diagnostics.mjs';
import { PROJECT, TEAM, STABLE } from './staging-stable-oidc-proof.mjs';
const trace = '01a09b5f-3e1e-7c9e-9cac-69dc18be392b';
const env = { VERCEL_TOKEN: 'PRIVATE_CANARY', VERCEL_PROJECT_ID: PROJECT, VERCEL_STAGING_PROJECT_ID: PROJECT, VERCEL_ORG_ID: TEAM };
function provider(path) {
  const url = new URL(path);
  assert.equal(url.searchParams.get('teamId'), TEAM);
  if (url.pathname === `/v9/projects/${PROJECT}`) return Response.json({ id: PROJECT, name: 'autobureau-staging', accountId: TEAM, oidcTokenConfig: { enabled: true, issuerMode: 'team' } });
  if (url.pathname === `/v2/teams/${TEAM}`) return Response.json({ id: TEAM, slug: 'data-analyst-mike', name: 'Data Analyst Mike' });
  if (url.pathname === `/v4/aliases/${STABLE}`) return Response.json({ alias: STABLE, projectId: PROJECT, deploymentId: 'dpl_stable', uid: 'alias_stable' });
  if (url.pathname === '/v13/deployments/dpl_stable') return Response.json({ projectId: PROJECT, name: 'autobureau-staging', target: 'production', url: 'autobureau-staging-example.vercel.app', readyState: 'READY' });
  throw new Error('Unexpected provider request');
}
test('only fixed auth diagnostics survive, with duplicate wrapper logs collapsed', () => {
  const record = { event: 'auth.sign_in_provider_unavailable', trace_id: trace, status: 503, secret: 'PRIVATE_CANARY', meta: { upstream_status: 504, upstream_failure: 'http', upstream_duration_ms: 5000, url: 'PRIVATE_CANARY' } };
  const result = projectAuthRecords([JSON.stringify(record), JSON.stringify({ message: JSON.stringify(record) }), JSON.stringify({ event: 'unrelated', secret: 'PRIVATE_CANARY' })].join('\n'));
  assert.deepEqual(result, [{ event: record.event, traceId: trace, status: 503, upstreamStatus: 504, upstreamFailure: 'http', upstreamDurationMs: 5000 }]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});
test('invalid traces and arbitrary diagnostic values are discarded', () => {
  assert.deepEqual(projectAuthRecords(JSON.stringify({ event: 'auth.sign_in_error', trace_id: 'PRIVATE_CANARY' })), []);
  assert.deepEqual(projectAuthRecords(JSON.stringify({ event: 'auth.sign_in_error', trace_id: trace, status: 'PRIVATE_CANARY', meta: { upstream_failure: 'PRIVATE_CANARY', upstream_status: 999, upstream_duration_ms: -1, upstream_request_id: 'PRIVATE_CANARY' } })), [{ event: 'auth.sign_in_error', traceId: trace }]);
});
test('fixed staging identity and alias are verified before and after the bounded read', async () => {
  const methods = [], calls = [];
  const result = await readStableAuthDiagnostics({ env, request: async (url, init) => { methods.push(init.method); return provider(url); }, runCli: (command, args, options) => {
    calls.push({ command, args });
    assert.equal(options.timeout, 45000);
    assert.equal(options.env.VERCEL_TOKEN, env.VERCEL_TOKEN);
    return { status: 0, stdout: '', stderr: 'PRIVATE_CANARY' };
  } });
  assert.equal(methods.length, 8); assert.ok(methods.every(method => method === 'GET'));
  assert.deepEqual(calls[0].args.slice(0, 9), ['logs', '--project', PROJECT, '--deployment', 'dpl_stable', '--scope', TEAM, '--environment', 'production']);
  assert.equal(result.stableAssignmentUnchanged, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});
test('wrong team/project stops before any API or CLI call', async () => {
  for (const invalid of [{ VERCEL_ORG_ID: 'wrong' }, { VERCEL_PROJECT_ID: 'production' }, { VERCEL_STAGING_PROJECT_ID: 'production' }]) {
    await assert.rejects(readStableAuthDiagnostics({ env: { ...env, ...invalid }, request: () => { assert.fail('unexpected network'); }, runCli: () => { assert.fail('unexpected CLI'); } }), /identity mismatch/);
  }
});
test('an alias outside staging stops without reading any logs', async () => {
  await assert.rejects(readStableAuthDiagnostics({ env, request: async url => new URL(url).pathname.includes('/aliases/') ? Response.json({ alias: STABLE, projectId: 'production', deploymentId: 'dpl_other' }) : provider(url), runCli: () => { assert.fail('unexpected CLI'); } }), /alias is not verified/);
});
test('CLI failure is retained as incomplete evidence, never raw stderr', async () => {
  const result = await readStableAuthDiagnostics({ env, request: async url => provider(url), runCli: () => ({ status: 1, stdout: '', stderr: 'PRIVATE_CANARY' }) });
  assert.equal(result.cliSucceeded, false); assert.deepEqual(result.records, []);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});
