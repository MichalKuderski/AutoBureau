import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { proveClaims, runProof, issuer } from './staging-cloud-oidc-proof.mjs';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { generateKeyPair, SignJWT } = await import(require.resolve('jose'));
const { privateKey, publicKey } = await generateKeyPair('RS256');
async function signed(overrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: 'https://vercel.com/data-analyst-mike',
    sub: 'owner:data-analyst-mike:project:autobureau-staging:environment:preview',
    owner_id: 'team_CNQd2ynmaV1xtRhB6NMMeYBs', project_id: 'prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR',
    environment: 'preview', iat: now, exp: now + 3600,
    unexpected_sensitive_claim: 'must-not-be-exported', ...overrides,
  }).setProtectedHeader({ alg: 'RS256' }).sign(signingKey);
}
test('verifies the signature and emits only allow-listed claims', async () => {
  const token = await signed();
  const proof = await proveClaims({ token, environment: 'preview', key: publicKey });
  assert.equal(proof.signatureVerified, true);
  assert.equal(proof.runtimeRoleAssumptionProven, false);
  assert.equal(proof.lifetimeSeconds, 3600);
  assert.ok(!JSON.stringify(proof).includes(token));
  assert.ok(!JSON.stringify(proof).includes('must-not-be-exported'));
});
test('rejects wrong issuer, team, project, environment, audience, expiry and future issuance', async () => {
  for (const override of [{ iss: 'https://oidc.vercel.com/other' }, { owner_id: 'other' },
    { project_id: 'production-app-project' }, { environment: 'production' }, { aud: 'other' },
    { exp: 1 }, { iat: Math.floor(Date.now() / 1000) + 100 }, { sub: 'wrong-project' }]) {
    await assert.rejects(proveClaims({ token: await signed(override), environment: 'preview', key: publicKey }),
      { message: 'Staging OIDC proof failed; token and provider details withheld' });
  }
});
test('rejects a valid-looking token signed by an unrelated key', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(proveClaims({ token: await signed({}, other.privateKey), environment: 'preview', key: publicKey }));
});
test('normal builds do not read the token; explicit proof fails closed outside the verified project', async () => {
  await runProof({ get VERCEL_OIDC_TOKEN() { throw new Error('must not read'); } }, () => assert.fail());
  await assert.rejects(runProof({ PELLUM_STAGING_OIDC_PROOF: '1', VERCEL: '1', VERCEL_PROJECT_ID: 'other' }));
});
