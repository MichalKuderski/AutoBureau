import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredSignInRefusal, authSmokeEvidence } from './smoke-auth-evidence.mjs';
const body = { status: 401, type: 'https://autobureau.com/problems/unauthorized' };
test('configured invalid credentials must receive the application problem+json 401', () => {
  assert.equal(configuredSignInRefusal(Response.json(body, { status: 401, headers: { 'content-type': 'application/problem+json' } }), body), true);
});
for (const status of [200, 204, 302, 403, 429, 500, 502, 503, 504]) {
  test(`configured smoke refuses HTTP ${status} rather than counting a negative comparison as health`, () => {
    assert.equal(configuredSignInRefusal(new Response(null, { status }), body), false);
  });
}
test('a proxy HTML 401 or unrelated JSON 401 is not an auth proof', () => {
  assert.equal(configuredSignInRefusal(new Response('unauthorized', { status: 401 }), body), false);
  const response = new Response(null, { status: 401, headers: { 'content-type': 'application/problem+json' } });
  assert.equal(configuredSignInRefusal(response, { status: 401, type: 'other' }), false);
});
test('smoke diagnostics never retain arbitrary body, headers or echoed identifiers', () => {
  const response = new Response(null, { status: 503, headers: { 'x-request-id': 'PRIVATE_CANARY', 'retry-after': 'PRIVATE_CANARY', 'set-cookie': 'PRIVATE_CANARY' } });
  const result = authSmokeEvidence(response, { detail: 'PRIVATE_CANARY', token: 'PRIVATE_CANARY' }, '2026-09-13T22:00:00.000Z', 19.9);
  assert.deepEqual(result, { status: 503, startedAt: '2026-09-13T22:00:00.000Z', durationMs: 20, reason: 'unclassified-unavailable' });
});
test('a transient 503 is distinguished from missing configuration without asserting upstream cause', () => {
  const response = new Response(null, { status: 503, headers: { 'x-request-id': '01a09b5f-3e1e-7c9e-9cac-69dc18be392b', 'retry-after': '15' } });
  const result = authSmokeEvidence(response, { detail: 'Sign-in is briefly unavailable.' }, '2026-09-13T22:00:00.000Z', 100);
  assert.equal(result.reason, 'temporary-auth-unavailable');
  assert.equal(result.retryAfterSeconds, 15);
  assert.equal(result.requestId, response.headers.get('x-request-id'));
  assert.equal(authSmokeEvidence(response, { detail: 'Authentication is not configured on this deployment.' }, '', 0).reason, 'configuration-unavailable');
});
