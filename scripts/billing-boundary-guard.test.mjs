// ADR-020 hosted amendment: the Stripe TEST credentials and SDK live only in the dedicated
// billing runtime; the web runtime reaches it only through the signed internal client.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const files = dir => readdirSync(resolve(root, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' ? [] : files(`${dir}/${e.name}`)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const read = p => readFileSync(resolve(root, p), 'utf8');
const source = p => !/\.test\.[jt]sx?$/.test(p) && !p.includes('/test/');
const imports = s => [...s.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);

test('the web runtime holds no Stripe SDK and imports only the signing subpath of the billing boundary', () => {
  const pkg = JSON.parse(read('apps/web/package.json'));
  assert.equal(pkg.dependencies?.stripe, undefined); assert.equal(pkg.devDependencies?.stripe, undefined);
  const hits = files('apps/web/src').filter(source).flatMap(p => imports(read(p))
    .filter(i => i === 'stripe' || i.startsWith('stripe/') || i.startsWith('@autobureau/billing-boundary')).map(i => `${p} -> ${i}`));
  assert.deepEqual(hits, ['apps/web/src/server/billing/runtime-client.ts -> @autobureau/billing-boundary/internal-signature']);
});

test('the signing subpath imports nothing but node:crypto, so it can never pull the SDK into the web bundle', () => {
  assert.deepEqual(imports(read('services/billing/src/internal-signature.ts')), ['node:crypto']);
  const pkg = JSON.parse(read('services/billing/package.json'));
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './internal-signature']);
});

test('only the reviewed billing-boundary modules construct the Stripe SDK', () => {
  const sdk = files('services/billing/src').filter(source).filter(p => imports(read(p)).includes('stripe'));
  assert.deepEqual(sdk.sort(), ['services/billing/src/hosted.ts', 'services/billing/src/stripe-test-provider.ts', 'services/billing/src/stripe-test-refetch.ts']);
  for (const p of sdk) assert.doesNotMatch(read(p), /sk_live|rk_live|livemode:\s*true|maxNetworkRetries:\s*[1-9]/);
  for (const p of ['services/billing/src/stripe-test-provider.ts', 'services/billing/src/stripe-test-refetch.ts'])
    assert.match(read(p), /maxNetworkRetries:0|maxNetworkRetries: 0/);
});

test('the billing app is route handlers only, each through the gated runtime', () => {
  const routes = files('apps/billing/src/app').sort();
  assert.deepEqual(routes, ['apps/billing/src/app/v1/stripe-test/health/route.ts', 'apps/billing/src/app/v1/stripe-test/internal/[op]/route.ts',
    'apps/billing/src/app/v1/stripe-test/recheck/route.ts', 'apps/billing/src/app/v1/stripe-test/webhook/route.ts']);
  for (const p of routes) {
    const s = read(p);
    assert.deepEqual(imports(s).filter(i => !i.startsWith('.')), []);
    if (!p.includes('/health/')) assert.match(s, /serve\(rt => rt\.(webhook|internal|recheck)\(request/);
  }
  assert.deepEqual(imports(read('apps/billing/src/server/runtime.ts')), ['@autobureau/billing-boundary']);
  const pkg = JSON.parse(read('apps/billing/package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@autobureau/billing-boundary', '@prisma/client', 'next', 'react', 'react-dom']);
  assert.equal(existsSync(resolve(root, 'apps/billing/src/app/page.tsx')), false);
  const cron = JSON.parse(read('apps/billing/vercel.json')).crons;
  assert.deepEqual(cron.map(c => c.path), ['/v1/stripe-test/recheck']);
});

test('the hosted billing gate refuses web authority beside it and a live key', () => {
  const s = read('services/billing/src/config.ts');
  assert.match(s, /env\.DATABASE_URL !== undefined \|\| env\.AUTH_API_URL !== undefined/);
  assert.match(s, /\^\(sk\|rk\)_test_/);
  assert.match(s, /BILLING_TEST_DISABLED === "1"/);
  assert.match(read('packages/db/src/test-billing-runtime.ts'), /BILLING_RUNTIME!=="stripe-test"/);
});

test('owner web billing routes keep their reviewed capabilities and the mount check', () => {
  const expect = { checkout: 'billing.manage', portal: 'billing.manage', confirm: 'settings.manage' };
  for (const [action, capability] of Object.entries(expect)) {
    const s = read(`apps/web/src/app/v1/households/[id]/billing/${action}/route.ts`);
    assert.match(s, new RegExp(`authenticated\\(\\{ requires: "${capability.replace('.', '\\.')}" \\}`));
    assert.match(s, /const client = billingClientConfig\(\);\n\s+if \(!client\) throw billingProblem\("unmounted"\);/);
  }
  const client = read('apps/web/src/server/billing/runtime-client.ts');
  assert.match(client, /redirect: "error"/); assert.match(client, /STRIPE_CREDENTIAL = \/\^STRIPE_\.\*\(SECRET\|KEY\)\//);
  assert.doesNotMatch(client, /for\s*\(|while\s*\(|setTimeout\(/);
});

test('a checkout return or webhook arrival never grants: only reconciliation writes state', () => {
  const flow = read('apps/web/src/server/billing/checkout-flow.ts') + read('services/billing/src/runtime.ts');
  assert.doesNotMatch(flow, /stripe_test_states|entitlement|local_plan_activation|test_enabled/);
  const ui = read('apps/web/src/app/(app)/settings/billing/billing-settings.tsx');
  assert.doesNotMatch(ui, /tier\s*=\s*["']premium|setPlan|plan:\s*["']premium/);
  assert.match(ui, /u\.origin !== origin/);
});
