// Hosted entrypoint. There is no local-target override or arbitrary checkout/SQL input.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runRollout} from './rejection-rollout-core.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),env=process.env;
function command(args) {
  const r=spawnSync(args[0],args.slice(1),{cwd:root,env,stdio:'pipe',timeout:120000});
  // Never print raw provider/Prisma errors, stdout, connection material or child env.
  if(r.error || r.status!==0) throw Error('Command failed; read back ledger before any next action');
}
let db;
try {
  command(['node','scripts/verify-staging-migration-target.mjs']);
  const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
  const {PrismaClient}=require('@prisma/client');db=new PrismaClient({log:[]});
  const context={event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,actor:env.GITHUB_ACTOR,triggeringActor:env.GITHUB_TRIGGERING_ACTOR,sha:env.GITHUB_SHA,
    approval:env.ROLLOUT_APPROVAL,evidence:env.ROLLOUT_EVIDENCE,runtimeSha:env.ROLLOUT_RUNTIME_SHA,
    runtimeUrl:env.ROLLOUT_RUNTIME_URL,acceptance:env.ROLLOUT_ACCEPTANCE};
  const result=await runRollout({root,db,context,phase:env.ROLLOUT_PHASE,
    migrate:async schema=>command(['pnpm','--filter','@autobureau/db','exec','prisma','migrate','deploy','--schema',schema])});
  process.stdout.write(`Verified ${result.phase}; completed ledger entries: ${result.completed}. No deployment performed.\n`);
} catch {
  process.stderr.write('Rollout stopped. Keep the hold/pause; read back ledger/schema before a separately approved next action. No automatic retry.\n');
  process.exitCode=1;
} finally {await db?.$disconnect();}
