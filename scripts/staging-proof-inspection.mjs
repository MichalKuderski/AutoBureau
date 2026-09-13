/** Read-only recovery of the exact failed ADR-016 proof; never creates a deployment. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PROJECT, STABLE, stagingApi, snapshot, assertUnchanged, assertProofDeployment } from './staging-stable-oidc-proof.mjs';

export const since = Date.parse('2026-09-13T14:54:06Z');
export const until = Date.parse('2026-09-13T14:56:14Z');
export function selectCandidates(result) {
  if (!Array.isArray(result?.deployments)) throw new Error('Deployment inventory unavailable');
  return result.deployments.filter(d => d.name === 'autobureau-staging' && d.target === 'production'
    && (d.createdAt ?? d.created) >= since && (d.createdAt ?? d.created) <= until);
}
export function claimEvidence(events) {
  if (!Array.isArray(events)) throw new Error('Build evidence unavailable');
  const marker = 'PELLUM_OIDC_PROOF ';
  const lines = events.map(e => e.payload?.text ?? '').filter(s => typeof s === 'string' && s.includes(marker));
  if (lines.length !== 1) throw new Error('Expected one native claim record');
  let value;
  try { value = JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length)); }
  catch { throw new Error('Invalid native claim record'); }
  if (value.signatureVerified !== true || value.environment !== 'production' || value.project_id !== PROJECT
    || value.owner_id !== 'team_CNQd2ynmaV1xtRhB6NMMeYBs'
    || value.iss !== 'https://oidc.vercel.com/data-analyst-mike'
    || value.aud !== 'https://vercel.com/data-analyst-mike'
    || value.sub !== 'owner:data-analyst-mike:project:autobureau-staging:environment:production') throw new Error('Native claims mismatch');
  // Never serialize arbitrary log fields, even if a provider response adds them.
  return Object.fromEntries(['evidenceSource','signatureVerified','iss','aud','sub','owner_id','project_id','environment','iat','exp','lifetimeSeconds','runtimeRoleAssumptionProven'].map(k => [k, value[k]]));
}

export async function inspect(env = process.env) {
  const provider = stagingApi(env);
  const api = path => provider(path, 'GET');
  const before = JSON.parse(await readFile('docs/engineering/evidence/staging-proof-before-34763982905.json', 'utf8'));
  const after = await snapshot(api);
  assertUnchanged(before, after);
  const candidates = selectCandidates(await api(`/v6/deployments?projectId=${PROJECT}&target=production&since=${since}&until=${until}&limit=100`));
  const evidence = { capturedAt: new Date().toISOString(), before, after, stableUnchanged: true,
    productionApplicationAccessed: false, readOnly: true, deployments: [] };
  await writeFile('staging-proof-inspection.json', JSON.stringify(evidence, null, 2));
  if (candidates.length !== 1) throw new Error(`Expected one proof deployment; found ${candidates.length}`);
  const deployment = await api(`/v13/deployments/${candidates[0].uid ?? candidates[0].id}`);
  assertProofDeployment(deployment, before);
  const assigned = await api(`/v2/deployments/${deployment.id}/aliases`);
  if (!Array.isArray(assigned?.aliases)) throw new Error('Aliases unavailable');
  const aliases = assigned.aliases.map(a => ({ alias: a.alias, uid: a.uid ?? null, deploymentId: a.deploymentId ?? null, projectId: a.projectId ?? null }));
  const record = { id: deployment.id, url: deployment.url, projectId: deployment.projectId,
    target: deployment.target, readyState: deployment.readyState, createdAt: deployment.createdAt,
    aliases, probes: [] };
  evidence.deployments.push(record);
  await writeFile('staging-proof-inspection.json', JSON.stringify(evidence, null, 2));
  for (const host of new Set([deployment.url, ...aliases.map(a => a.alias)])) {
    // Inspect only provider-generated names attached to this exact staging deployment.
    if (host === STABLE || !/^autobureau-staging(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host)) continue;
    const response = await fetch(`https://${host}/`, { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const location = response.headers.get('location');
    const redirect = location ? new URL(location, `https://${host}`) : null;
    const vercelLogin = redirect?.hostname === 'vercel.com' && /sso|login|auth/.test(redirect.pathname);
    record.probes.push({ host, status: response.status, redirectOrigin: redirect?.origin ?? null, externallyReachable: response.status < 400 && !vercelLogin });
  }
  await writeFile('staging-proof-inspection.json', JSON.stringify(evidence, null, 2));
  record.claims = claimEvidence(await api(`/v3/deployments/${deployment.id}/events?builds=1&follow=0&limit=-1`));
  assertUnchanged(before, await snapshot(api));
  await writeFile('staging-proof-inspection.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await inspect(); } catch (error) { console.error(error instanceof Error ? error.message : 'Read-only proof inspection failed'); process.exitCode = 1; }
}
