import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { verifyGithub } from './staging-github-oidc-proof.mjs';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { SignJWT, generateKeyPair } = await import(require.resolve('jose'));
const keys = await generateKeyPair('RS256');
const now = Math.floor(Date.now()/1000);
const claims = { iss:'https://token.actions.githubusercontent.com', aud:'sts.amazonaws.com',
  sub:'repo:MichalKuderski/AutoBureau:environment:staging', repository:'MichalKuderski/AutoBureau',
  repository_id:'1336298759',repository_owner_id:'177895094',environment:'staging',ref:'refs/pull/5/merge',
  workflow_ref:'MichalKuderski/AutoBureau/.github/workflows/staging-proof-inspection.yml@refs/pull/5/merge',iat:now,exp:now+300 };
const signed = (value, key=keys.privateKey) => new SignJWT(value).setProtectedHeader({alg:'RS256'}).sign(key);
test('signed staging identity returns only the trust evidence', async () => {
  const token = await signed({...claims, unneeded:'must-not-export'});
  const result = await verifyGithub(token, keys.publicKey);
  assert.equal(result.signatureVerified,true);
  assert.equal(result.sub,claims.sub);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(!JSON.stringify(result).includes('must-not-export'));
});
test('wrong issuer, audience, repository identity, scope, ref or workflow is rejected', async () => {
  for (const field of ['iss','aud','repository','repository_id','repository_owner_id','environment','ref','workflow_ref'])
    await assert.rejects(verifyGithub(await signed({...claims,[field]:'wrong'}),keys.publicKey));
});
test('bad signatures, expired and future-issued tokens fail closed', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyGithub(await signed(claims,other.privateKey),keys.publicKey));
  await assert.rejects(verifyGithub(await signed({...claims,exp:now-1}),keys.publicKey));
  await assert.rejects(verifyGithub(await signed({...claims,iat:now+120}),keys.publicKey));
});
