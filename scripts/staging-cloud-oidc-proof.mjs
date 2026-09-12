/** Runs inside a native Vercel build; only the provider-injected OIDC token is read.
 * Never exports a token, credentials, or arbitrary environment values.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createRemoteJWKSet, jwtVerify } = await import(require.resolve('jose'));
export const issuer = 'https://oidc.vercel.com/data-analyst-mike';
const audience = 'https://vercel.com/data-analyst-mike';
const projectId = 'prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR';
const ownerId = 'team_CNQd2ynmaV1xtRhB6NMMeYBs';

export async function proveClaims({ token, environment, key = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`)) }) {
  try {
    if (!['production', 'preview'].includes(environment) || !token) throw new Error();
    const subject = `owner:data-analyst-mike:project:autobureau-staging:environment:${environment}`;
    const { payload } = await jwtVerify(token, key, {
      issuer, audience, subject, requiredClaims: ['iat', 'exp', 'owner_id', 'project_id', 'environment'],
      clockTolerance: 0,
    });
    if (payload.owner_id !== ownerId || payload.project_id !== projectId || payload.environment !== environment
      || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
      || payload.exp <= payload.iat || payload.iat > Math.floor(Date.now() / 1000)) throw new Error();
    return { evidenceSource: 'vercel-native-build', signatureVerified: true,
      iss: payload.iss, aud: payload.aud, sub: payload.sub,
      owner_id: payload.owner_id, project_id: payload.project_id, environment: payload.environment,
      iat: payload.iat, exp: payload.exp, lifetimeSeconds: payload.exp - payload.iat,
      runtimeRoleAssumptionProven: false };
  } catch { throw new Error('Staging OIDC proof failed; token and provider details withheld'); }
}

export async function runProof(env, emit = console.log) {
  if (env.PELLUM_STAGING_OIDC_PROOF !== '1') return;
  if (env.VERCEL !== '1' || env.VERCEL_PROJECT_ID !== projectId || env.VERCEL_ORG_ID !== ownerId
    || env.VERCEL_ENV !== env.PELLUM_STAGING_OIDC_SCOPE) throw new Error('Staging build identity mismatch');
  const evidence = await proveClaims({ token: env.VERCEL_OIDC_TOKEN, environment: env.PELLUM_STAGING_OIDC_SCOPE });
  emit(`PELLUM_OIDC_PROOF ${JSON.stringify(evidence)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runProof(process.env); }
  catch { console.error('Staging OIDC proof failed; no token or credentials exported'); process.exitCode = 1; }
}
