/** Read only allow-listed project metadata; never fetch environment variable values. */
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function inspectSettings({ token, teamId, projectId, request = fetch }) {
  if (!token || !teamId || !projectId) throw new Error('Missing staging CI credentials');
  const get = async path => {
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', teamId);
    let response;
    try { response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error('Staging Vercel read failed'); }
    if (!response.ok) throw new Error(`Staging Vercel read returned HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new Error('Staging Vercel response was not JSON'); }
  };
  const project = await get(`/v9/projects/${encodeURIComponent(projectId)}`);
  if (project.name !== 'autobureau-staging' || project.id !== projectId || project.accountId !== teamId) throw new Error('STOP: staging project identity mismatch');
  const owner = await get(`/v2/teams/${encodeURIComponent(teamId)}`);
  if (owner.slug !== 'data-analyst-mike' || owner.id !== teamId) throw new Error('STOP: staging team identity mismatch');
  const config = project.oidcTokenConfig;
  return { capturedAt: new Date().toISOString(), project: project.name, projectId, team: owner.slug, teamId,
    issuerMode: ['team', 'global'].includes(config?.issuerMode) ? config.issuerMode : null,
    oidcEnabled: typeof config?.enabled === 'boolean' ? config.enabled : null,
    plan: typeof owner.billing?.plan === 'string' ? owner.billing.plan : null,
    liveClaimsVerified: false, infrastructureApplied: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await inspectSettings({ token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_ORG_ID, projectId: process.env.VERCEL_STAGING_PROJECT_ID });
    await writeFile('staging-oidc-settings.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(evidence));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Staging settings inspection failed'); process.exitCode = 1; }
}
