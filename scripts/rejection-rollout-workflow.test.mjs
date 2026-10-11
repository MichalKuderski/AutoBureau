import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const yaml=createRequire(require.resolve('eslint/package.json'))('js-yaml');
const load=p=>yaml.load(readFileSync(join(root,p),'utf8'));
const deploy=load('.github/workflows/deploy.yml'),only=load('.github/workflows/staging-rejection-migration.yml');
const frozen=JSON.parse(readFileSync(join(root,'ops/staging-rejection/main-boundary-hashes.json')));
const manifest=JSON.parse(readFileSync(join(root,'scripts/rejection-rollout-manifest.json')));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('main push/merge cannot invoke a staging deployment or alias promotion',()=>{
  assert.equal(deploy.jobs.staging.if,'${{ false }}');
  for(const [name,digest] of Object.entries(frozen.jobs))assert.equal(hash(deploy.jobs[name]),digest,name);
  for(const [name,digest] of Object.entries(frozen.top))assert.equal(hash(deploy[name]),digest,name);
  assert.deepEqual(Object.keys(deploy.jobs).sort(),[...Object.keys(frozen.jobs),'staging'].sort());
});
test('production Prisma directory and application schema remain exact main',()=>{
  assert.equal(createHash('sha256').update(readFileSync(join(root,'packages/db/prisma/schema.prisma'))).digest('hex'),frozen.schema);
  const dirs=readdirSync(join(root,'packages/db/prisma/migrations'),{withFileTypes:true}).filter(d=>d.isDirectory());
  assert.equal(dirs.length,7);
  for(const d of dirs)assert.equal(createHash('sha256').update(readFileSync(join(root,manifest.paths[d.name]))).digest('hex'),manifest.baseline[d.name]);
  for(const phase of Object.values(manifest.phases))assert.ok(manifest.paths[phase.name].startsWith('ops/staging-rejection/'));
});
test('migration workflow is manual, main-only and owner-only including reruns',()=>{
  assert.deepEqual(Object.keys(only.on),['workflow_dispatch']);assert.deepEqual(Object.keys(only.jobs),['migrate']);
  assert.equal(only.jobs.migrate.if,"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == 'MichalKuderski' && github.triggering_actor == 'MichalKuderski'");
  assert.equal(only.jobs.migrate.environment,'staging');assert.deepEqual(only.permissions,{contents:'read'});
  assert.equal(only.concurrency['cancel-in-progress'],false);
});
test('migration workflow has no deployment/promotion command or credential',()=>{
  const steps=only.jobs.migrate.steps;
  assert.deepEqual(steps.filter(s=>s.run).map(s=>s.run),['pnpm install --frozen-lockfile','node scripts/staging-migration-trust.mjs','pnpm --filter @autobureau/db exec prisma generate','node scripts/rejection-rollout.mjs']);
  assert.equal(steps.find(s=>s.run==='node scripts/staging-migration-trust.mjs').env,undefined);
  assert.deepEqual(steps.filter(s=>s.uses).map(s=>s.uses),['actions/checkout@v4','pnpm/action-setup@v4','actions/setup-node@v4']);
  for(const s of steps){if(s.run)assert.ok(!s.run.includes('${{'));if(s.uses==='actions/checkout@v4'){assert.equal(s.with['persist-credentials'],false);assert.equal(s.with.ref,undefined);}}
  const text=readFileSync(join(root,'.github/workflows/staging-rejection-migration.yml'),'utf8');
  assert.deepEqual(text.match(/secrets\.[A-Z_]+/g),['secrets.STAGING_MIGRATION_DATABASE_URL']);
  assert.ok(!/vercel|--prod|PRODUCTION_/i.test(text));
  for(const file of ['rejection-rollout.mjs','rejection-rollout-core.mjs'])assert.ok(!/vercel|--prod|PRODUCTION_|fetch\(/i.test(readFileSync(join(root,'scripts',file),'utf8')));
});
test('hosted entrypoint refuses loopback and exposes no local override',()=>{
  const r=spawnSync(process.execPath,['scripts/rejection-rollout.mjs'],{cwd:root,env:{PATH:process.env.PATH,DATABASE_URL:'postgresql://autobureau:synthetic_only@127.0.0.1:1/rollout_baseline'},encoding:'utf8',timeout:10000});
  assert.equal(r.status,1);assert.match(r.stderr,/Rollout stopped/);assert.doesNotMatch(r.stderr,/synthetic_only/);
});
test('new CI integration job has only a local fixture and no hosted environment or secrets',()=>{
  const job=load('.github/workflows/ci.yml').jobs.rejection_rollout;
  assert.equal(job.environment,undefined);assert.equal(job.services.postgres.env.POSTGRES_DB,'rollout_baseline');
  assert.equal(job.steps.at(-1).env.ROLLOUT_TEST_DATABASE_URL,'postgresql://autobureau:ci_only@127.0.0.1:5432/rollout_baseline');
  assert.ok(!/secrets\.|vercel|--prod|workflow_dispatch/.test(JSON.stringify(job)));
  assert.deepEqual(job.steps.filter(s=>s.run).map(s=>s.run),['pnpm install --frozen-lockfile','pnpm --filter @autobureau/db exec prisma generate','node scripts/rejection-rollout.test.mjs','node scripts/rejection-rollout-workflow.test.mjs','node scripts/rejection-rollout.integration.test.mjs']);
});
test('secret-scan exceptions pin only the three verified migration checksum fingerprints',()=>{
  const prefix='bda2584078b1c8b9ab44f7199982ea1a78c4b6fd:scripts/rejection-rollout-manifest.json:generic-api-key:';
  const exceptions=readFileSync(join(root,'.gitleaksignore'),'utf8').trim().split('\n').filter(line=>line.startsWith('bda2584078b1c8b9ab44f7199982ea1a78c4b6fd:'));
  assert.deepEqual(exceptions,[8,9,46].map(line=>prefix+line));
  const lines=readFileSync(join(root,'scripts/rejection-rollout-manifest.json'),'utf8').split('\n');
  for(const [line,name] of [[8,'20260823000000_idempotency_keys'],[9,'20260825000000_auth_rate_limits'],[46,'20261001000003_plaid_credential_envelope_v2']]){
    assert.ok(lines[line-1].includes(`"${name}"`));
    assert.equal(manifest.baseline[name],createHash('sha256').update(readFileSync(join(root,manifest.paths[name]))).digest('hex'));
  }
});
