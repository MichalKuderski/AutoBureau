import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoke, CHECKS } from './smoke-billing-runtime.mjs';

const headers = { 'cache-control': 'no-store' };
const healthy = async (url) => {
  const p = new URL(url).pathname, map = { '/v1/stripe-test/health': [200, { runtime: 'billing-test', ready: true }], '/v1/stripe-test/webhook': [400, {}],
    '/v1/stripe-test/internal/portal': [401, {}], '/v1/stripe-test/internal/nope': [404, {}], '/v1/stripe-test/recheck': [404, {}], '/': [404, {}] };
  const [status, body] = map[p]; return new Response(JSON.stringify(body), { status, headers });
};
test('a correctly refusing runtime passes every check', async () => {
  const r = await smoke('https://billing.example.test', healthy);
  assert.equal(r.length, CHECKS.length); assert.ok(r.every(x => x.ok));
});
test('not-ready, an accepted unsigned call, a cacheable answer or a powered-by header each fail', async () => {
  const variants = [
    async u => new URL(u).pathname === '/v1/stripe-test/health' ? new Response(JSON.stringify({ runtime: 'billing-test', ready: false }), { status: 503, headers }) : healthy(u),
    async u => new URL(u).pathname === '/v1/stripe-test/internal/portal' ? new Response('{}', { status: 200, headers }) : healthy(u),
    async u => { const r = await healthy(u); return new Response(await r.text(), { status: r.status }); },
    async u => { const r = await healthy(u); return new Response(await r.text(), { status: r.status, headers: { ...headers, 'x-powered-by': 'Next.js' } }); },
  ];
  for (const f of variants) assert.ok((await smoke('https://billing.example.test', f)).some(x => !x.ok));
});
test('refuses a non-https or path-bearing base', async () => {
  for (const b of ['http://billing.example.test', 'https://billing.example.test/x', 'not a url']) await assert.rejects(smoke(b, healthy));
});
