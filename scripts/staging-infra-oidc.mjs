/** Runner-local, short-lived web identity; no token or credentials in artifacts/logs. */
import { createRequire } from 'node:module';
import { chmod, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.env.PELLUM_OIDC_DEPENDENCIES
  ? `${process.env.PELLUM_OIDC_DEPENDENCIES}/package.json` : new URL('../apps/web/package.json', import.meta.url));
const { createRemoteJWKSet, jwtVerify } = await import(require.resolve('jose'));
const issuer = 'https://token.actions.githubusercontent.com';
const workflow = 'MichalKuderski/AutoBureau/.github/workflows/staging-storage.yml@refs/pull/5/merge';
export async function verifyInfrastructureIdentity(token, key = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`))) {
  try {
    const { payload: p } = await jwtVerify(token, key, { issuer, audience: 'sts.amazonaws.com', algorithms: ['RS256'],
      requiredClaims: ['sub','iat','exp','repository','repository_id','repository_owner_id','environment','ref','workflow_ref'], clockTolerance: 0 });
    if (p.sub !== 'repo:MichalKuderski@177895094/AutoBureau@1336298759:environment:staging'
      || p.repository !== 'MichalKuderski/AutoBureau' || p.repository_id !== '1336298759'
      || p.repository_owner_id !== '177895094' || p.environment !== 'staging'
      || p.ref !== 'refs/pull/5/merge' || p.workflow_ref !== workflow
      || !Number.isInteger(p.iat) || !Number.isInteger(p.exp)
      || p.iat > Math.floor(Date.now()/1000) || p.exp <= p.iat || p.exp - p.iat > 600) throw new Error();
    return { signatureVerified: true,
      ...Object.fromEntries(['iss','aud','sub','repository_id','repository_owner_id','environment','ref','workflow_ref','iat','exp'].map(k => [k,p[k]])) };
  } catch { throw new Error('Infrastructure identity rejected; token withheld'); }
}
export async function issue(env = process.env) {
  if (env.GITHUB_REPOSITORY !== 'MichalKuderski/AutoBureau' || env.GITHUB_REF !== 'refs/pull/5/merge'
    || env.GITHUB_WORKFLOW_REF !== workflow || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    || !env.ACTIONS_ID_TOKEN_REQUEST_URL) throw new Error('Protected staging context required');
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) throw new Error('Unexpected identity endpoint');
  url.searchParams.set('audience', 'sts.amazonaws.com');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Token issuance unavailable');
  const { value } = await response.json();
  const proof = await verifyInfrastructureIdentity(value);
  const path = '/tmp/pellum-adr016-github-oidc.jwt';
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
  await writeFile('staging-infra-oidc-proof.json', JSON.stringify(proof, null, 2), {mode:0o600});
  console.log('Protected staging web identity verified; temporary token stays on runner');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await issue(); } catch { console.error('Staging infrastructure identity failed; token withheld'); process.exitCode = 1; }
}
