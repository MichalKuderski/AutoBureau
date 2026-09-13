/** Verify the protected staging job's actual signed claims. No token is persisted. */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.env.PELLUM_OIDC_DEPENDENCIES
  ? `${process.env.PELLUM_OIDC_DEPENDENCIES}/package.json` : new URL('../apps/web/package.json', import.meta.url));
const { createRemoteJWKSet, jwtVerify } = await import(require.resolve('jose'));
const issuer = 'https://token.actions.githubusercontent.com';
export async function verifyGithub(token, key = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`))) {
  try {
    const { payload } = await jwtVerify(token, key, { issuer, audience: 'sts.amazonaws.com', algorithms: ['RS256'],
      requiredClaims: ['sub','iat','exp','repository','repository_id','repository_owner_id','environment','ref','workflow_ref'], clockTolerance: 0 });
    if (payload.repository !== 'MichalKuderski/AutoBureau' || payload.repository_id !== '1336298759'
      || payload.repository_owner_id !== '177895094' || payload.environment !== 'staging'
      || payload.ref !== 'refs/pull/5/merge'
      || payload.workflow_ref !== 'MichalKuderski/AutoBureau/.github/workflows/staging-proof-inspection.yml@refs/pull/5/merge'
      || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
      || payload.iat > Math.floor(Date.now()/1000) || payload.exp <= payload.iat) throw new Error();
    // Observe the actual exact subject before constructing AWS trust, including custom subjects.
    return { signatureVerified: true, evidenceSource: 'github-protected-staging-job',
      ...Object.fromEntries(['iss','aud','sub','repository','repository_id','repository_owner_id','environment','ref','workflow_ref','iat','exp'].map(k => [k,payload[k]])) };
  } catch { throw new Error('GitHub staging OIDC verification failed; token withheld'); }
}
export async function run(env = process.env) {
  if (env.GITHUB_REPOSITORY !== 'MichalKuderski/AutoBureau' || env.GITHUB_REF !== 'refs/pull/5/merge'
    || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || !env.ACTIONS_ID_TOKEN_REQUEST_URL) throw new Error('Staging job identity unavailable');
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) throw new Error('Unexpected GitHub issuer endpoint');
  url.searchParams.set('audience', 'sts.amazonaws.com');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect:'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('GitHub token issuance failed');
  const body = await response.json();
  const evidence = await verifyGithub(body.value);
  await writeFile('staging-github-oidc-proof.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await run(); } catch { console.error('GitHub staging OIDC proof failed; no token exported'); process.exitCode = 1; }
}
