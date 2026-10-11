// Hosted entrypoint. There is no local-target override or arbitrary checkout/SQL input.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runRollout} from './rejection-rollout-core.mjs';
import {migrationConnection} from './staging-migration-trust.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),env=process.env;
let databaseUrl;
function command(args) {
  // Same reconstructed URL for target validation and the native migration engine.
  const r=spawnSync(args[0],args.slice(1),{cwd:root,env:{...env,DATABASE_URL:databaseUrl},stdio:'pipe',timeout:120000});
  // Never print raw provider/Prisma errors, stdout, connection material or child env.
  if(r.error || r.status!==0) throw Error('Command failed; read back ledger before any next action');
}
let db;
let stopped=false;
const stop=()=>{if(!stopped)process.stderr.write('Rollout stopped. Keep the hold/pause; read back ledger/schema before a separately approved next action. No automatic retry.\n');stopped=true;process.exitCode=1;};
try {
  databaseUrl=migrationConnection(env.DATABASE_URL);
  command(['node','scripts/verify-staging-migration-target.mjs']);
  const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
  const {PrismaClient}=require('@prisma/client');db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  const context={event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,actor:env.GITHUB_ACTOR,triggeringActor:env.GITHUB_TRIGGERING_ACTOR,sha:env.GITHUB_SHA,
    approval:env.ROLLOUT_APPROVAL,evidence:env.ROLLOUT_EVIDENCE,runtimeSha:env.ROLLOUT_RUNTIME_SHA,
    runtimeUrl:env.ROLLOUT_RUNTIME_URL,acceptance:env.ROLLOUT_ACCEPTANCE};
  const result=await runRollout({root,db,context,phase:env.ROLLOUT_PHASE,
    migrate:async schema=>command(['pnpm','--filter','@autobureau/db','exec','prisma','migrate','deploy','--schema',schema])});
  const completedDb=db;db=undefined;await completedDb.$disconnect();
  process.stdout.write(`Verified ${result.phase}; completed ledger entries: ${result.completed}. No deployment performed.\n`);
} catch {
  stop();
} finally {try{await db?.$disconnect();}catch{stop();}}
