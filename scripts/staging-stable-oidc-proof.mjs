/** Founder-authorized proof in autobureau-staging's production HOSTING scope.
 * No API/CLI target is configurable to the separate Production application.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const PROJECT = 'prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR';
export const TEAM = 'team_CNQd2ynmaV1xtRhB6NMMeYBs';
export const STABLE = 'autobureau-staging.vercel.app';
const generatedHost = /^autobureau-staging-[a-z0-9-]+-data-analyst-mike\.vercel\.app$/;

export function stagingApi(env, request = fetch) {
  if (env.VERCEL_PROJECT_ID !== PROJECT || env.VERCEL_STAGING_PROJECT_ID !== PROJECT || env.VERCEL_ORG_ID !== TEAM || !env.VERCEL_TOKEN) throw new Error('STOP: staging deployment identity mismatch');
  return async (path, method = 'GET') => {
    const url = new URL(path, 'https://api.vercel.com'); url.searchParams.set('teamId', TEAM);
    let response;
    try { response = await request(url, { method, headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error('Staging provider transport failed'); }
    if (method === 'GET' && [404, 410].includes(response.status)) return null;
    if (!response.ok) throw new Error(`Staging provider ${method} returned HTTP ${response.status}`);
    if (response.status === 204) return {};
    try { return await response.json(); } catch { throw new Error('Staging provider returned invalid JSON'); }
  };
}

export async function snapshot(api) {
  const project = await api(`/v9/projects/${PROJECT}`);
  const team = await api(`/v2/teams/${TEAM}`);
  if (project?.id !== PROJECT || project.name !== 'autobureau-staging' || project.accountId !== TEAM
    || team?.id !== TEAM || team.slug !== 'data-analyst-mike' || team.name !== 'Data Analyst Mike'
    || project.oidcTokenConfig?.issuerMode !== 'team' || project.oidcTokenConfig?.enabled !== true) throw new Error('STOP: live staging project/team/OIDC mismatch');
  const alias = await api(`/v4/aliases/${STABLE}`);
  if (alias?.alias !== STABLE || alias.projectId !== PROJECT || !alias.deploymentId || alias.redirect) throw new Error('STOP: stable staging alias is not verified');
  const deployment = await api(`/v13/deployments/${encodeURIComponent(alias.deploymentId)}`);
  if (deployment?.projectId !== PROJECT || deployment.name !== 'autobureau-staging' || deployment.target !== 'production') throw new Error('STOP: current stable deployment identity mismatch');
  return { team: team.name, teamSlug: team.slug, teamId: TEAM, project: project.name, projectId: PROJECT,
    issuerMode: 'team', oidcEnabled: true,
    protection: { sso: project.ssoProtection?.deploymentType ?? null,
      passwordEnabled: project.passwordProtection != null,
      passwordScope: project.passwordProtection?.deploymentType ?? null,
      trustedIpsEnabled: project.trustedIps != null },
    stable: { alias: alias.alias, aliasId: alias.uid, projectId: alias.projectId, deploymentId: alias.deploymentId,
      deploymentUrl: deployment.url, target: deployment.target, readyState: deployment.readyState } };
}

export function assertUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('STOP: stable staging assignment or protection drift');
}

export function assertProofDeployment(deployment, before) {
  if (!deployment || deployment.projectId !== PROJECT || deployment.name !== 'autobureau-staging'
    || deployment.target !== 'production' || deployment.id === before.stable.deploymentId
    || !/^dpl_[A-Za-z0-9]+$/.test(deployment.id) || !generatedHost.test(deployment.url)) throw new Error('STOP: proof deployment is not an isolated staging deployment');
}

export function canRemoveProof(deployment, before, after, aliases) {
  assertUnchanged(before, after); assertProofDeployment(deployment, before);
  return aliases.every(alias => alias !== STABLE && generatedHost.test(alias));
}

async function publicProbe(host, request = fetch) {
  if (!generatedHost.test(host)) throw new Error('STOP: refusing non-proof host probe');
  const response = await request(`https://${host}/`, { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const location = response.headers.get('location');
  const redirect = location ? new URL(location, `https://${host}`) : null;
  const vercelLogin = redirect?.hostname === 'vercel.com' && /sso|login|auth/.test(redirect.pathname);
  return { host, status: response.status, redirectOrigin: redirect?.origin ?? null,
    externallyReachable: response.status < 400 && !vercelLogin };
}

async function nativeBuild(env) {
  const args = ['deploy', '--yes', '--logs', '--prod', '--skip-domain',
    '--build-env', 'PELLUM_STAGING_OIDC_PROOF=1', '--build-env', 'PELLUM_STAGING_OIDC_SCOPE=production',
    '--build-env', `VERCEL_PROJECT_ID=${PROJECT}`, '--build-env', `VERCEL_ORG_ID=${TEAM}`, `--token=${env.VERCEL_TOKEN}`];
  // Logs are consumed in memory, never emitted or saved wholesale. The build verifier
  // emits only allow-listed claims after cryptographic and environment checks.
  const output = await new Promise((resolve, reject) => {
    const child = spawn('vercel', args, { env: { ...env, VERCEL_PROJECT_ID: PROJECT, VERCEL_ORG_ID: TEAM }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const capture = (name, chunk) => { if (name === 'out') stdout += chunk; else stderr += chunk; if (stdout.length + stderr.length > 10_000_000) child.kill(); };
    child.stdout.on('data', chunk => capture('out', chunk)); child.stderr.on('data', chunk => capture('err', chunk));
    child.on('error', () => reject(new Error('Staging proof CLI did not start')));
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error('Staging proof build failed; raw provider output withheld')));
  });
  const host = output.stdout.trim().split(/\s+/).map(value => value.replace(/^https:\/\//, '')).find(value => generatedHost.test(value));
  const marker = 'PELLUM_OIDC_PROOF ';
  const line = `${output.stdout}\n${output.stderr}`.split('\n').find(value => value.includes(marker));
  if (!host || !line) throw new Error('Proof build did not return a deployment and verified claims');
  let claims; try { claims = JSON.parse(line.slice(line.indexOf(marker) + marker.length)); } catch { throw new Error('Invalid proof record'); }
  const expectedSub = 'owner:data-analyst-mike:project:autobureau-staging:environment:production';
  if (claims.signatureVerified !== true || claims.environment !== 'production' || claims.project_id !== PROJECT
    || claims.owner_id !== TEAM || claims.iss !== 'https://oidc.vercel.com/data-analyst-mike'
    || claims.aud !== 'https://vercel.com/data-analyst-mike' || claims.sub !== expectedSub) throw new Error('Signed stable-scope proof mismatch');
  return { host, claims };
}

export async function run(env = process.env) {
  const api = stagingApi(env);
  await mkdir('.vercel', { recursive: true });
  await writeFile('.vercel/project.json', JSON.stringify({ orgId: TEAM, projectId: PROJECT, projectName: 'autobureau-staging' }));
  const linked = JSON.parse(await readFile('.vercel/project.json', 'utf8'));
  if (linked.orgId !== TEAM || linked.projectId !== PROJECT || linked.projectName !== 'autobureau-staging') throw new Error('Linked project mismatch');
  const before = await snapshot(api);
  await writeFile('staging-proof-before.json', JSON.stringify(before, null, 2));
  process.stdout.write(`Verified staging-only target and protection: ${JSON.stringify(before)}\n`);
  const built = await nativeBuild(env);
  const after = await snapshot(api); assertUnchanged(before, after);
  const deployment = await api(`/v13/deployments/${encodeURIComponent(built.host)}`); assertProofDeployment(deployment, before);
  const assigned = await api(`/v2/deployments/${deployment.id}/aliases`);
  if (!Array.isArray(assigned?.aliases)) throw new Error('Deployment aliases unverified');
  const aliases = assigned.aliases.map(value => value.alias);
  const safeToRemove = canRemoveProof(deployment, before, after, aliases);
  if (!safeToRemove) throw new Error('STOP: proof has an unexpected alias; no deletion performed');
  const probes = [];
  for (const host of new Set([deployment.url, ...aliases])) probes.push(await publicProbe(host));
  const evidence = { capturedAt: new Date().toISOString(), before, after, claims: built.claims,
    deploymentId: deployment.id, deploymentUrl: deployment.url, aliases, probes,
    stableUnchanged: true, productionApplicationAccessed: false, removedProofDeployment: false };
  await writeFile('staging-stable-oidc-proof.json', JSON.stringify(evidence, null, 2));
  if (probes.some(probe => probe.externallyReachable)) {
    // The user explicitly permits removing only this disposable proof deployment.
    const latest = await snapshot(api);
    const latestAliases = await api(`/v2/deployments/${deployment.id}/aliases`);
    if (!Array.isArray(latestAliases?.aliases) || !canRemoveProof(deployment, before, latest, latestAliases.aliases.map(value => value.alias))) throw new Error('STOP: proof cleanup safety check failed');
    await api(`/v13/deployments/${deployment.id}`, 'DELETE');
    if (await api(`/v13/deployments/${deployment.id}`)) throw new Error('Proof deletion not confirmed');
    assertUnchanged(before, await snapshot(api)); evidence.removedProofDeployment = true;
    await writeFile('staging-stable-oidc-proof.json', JSON.stringify(evidence, null, 2));
  }
  process.stdout.write(JSON.stringify(evidence) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await run(); } catch (error) { console.error(error instanceof Error ? error.message : 'Staging proof failed'); process.exitCode = 1; }
}
