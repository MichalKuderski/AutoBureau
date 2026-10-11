// Same orchestration for the guarded hosted entrypoint and isolated local integration.
// Tests supply a local database/command adapter; the hosted entrypoint has no bypass flag.
import {readFile,readdir,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {plan,execute} from './rejection-rollout-plan.mjs';

export async function loadInventory(root,manifest) {
  const local={},files={};
  for(const base of ['packages/db/prisma/migrations','ops/staging-rejection/migrations']) {
    for(const d of await readdir(join(root,base),{withFileTypes:true})) {
      if(!d.isDirectory()) continue;
      const path=`${base}/${d.name}/migration.sql`;
      if(files[d.name] || manifest.paths[d.name]!==path) throw Error('Unregistered/ambiguous migration path');
      files[d.name]=join(root,path);
      local[d.name]=createHash('sha256').update(await readFile(files[d.name])).digest('hex');
    }
  }
  return {local,files};
}
export async function stagePrefix(root,files,inventory) {
  const stage=await mkdtemp(join(tmpdir(),'rejection-phase-'));
  try {
    await mkdir(join(stage,'migrations'));
    await copyFile(join(root,'ops/staging-rejection/schema.prisma'),join(stage,'schema.prisma'));
    await copyFile(join(root,'ops/staging-rejection/migration_lock.toml'),join(stage,'migrations/migration_lock.toml'));
    for(const [name,checksum] of Object.entries(inventory)) {
      if(!files[name] || createHash('sha256').update(await readFile(files[name])).digest('hex')!==checksum)
        throw Error('Migration changed before staging');
      await mkdir(join(stage,'migrations',name));
      await copyFile(files[name],join(stage,'migrations',name,'migration.sql'));
    }
    return stage;
  }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
const PAUSE='document_rejection_rollout_paused',REASON='document_rejection_reason_valid';
const normalize=s=>s.replace(/\s+/g,' ').trim();
const pauseDefinition="CHECK ((decision <> 'discard'::text)) NOT VALID";
const reasonDefinition="CHECK ((((decision = 'discard'::text) AND (rejection_reason IS NOT NULL) AND (rejection_reason = ANY (ARRAY['incorrect-reading'::text, 'wrong-document'::text, 'duplicate'::text, 'not-needed'::text, 'other'::text]))) OR ((decision = 'apply-current-period'::text) AND (rejection_reason IS NULL)))) NOT VALID";
export function assertPhaseSchema(snapshot,phase,after=false) {
  const paused=after?phase!=='resume':phase!=='pause';
  const reason=after?phase!=='pause':phase==='resume';
  const find=n=>snapshot.constraints.find(c=>c.conname===n);
  for(const [name,present,definition] of [[PAUSE,paused,pauseDefinition],[REASON,reason,reasonDefinition]]) {
    const actual=find(name);
    if(Boolean(actual)!==present || (actual && (actual.convalidated || normalize(actual.definition)!==definition)))
      throw Error('Phase constraint definition/state differs');
  }
  const col=snapshot.column;
  if(Boolean(col)!==reason || (col && (col.data_type!=='text'||col.is_nullable!=='YES'||col.column_default!==null||!col.can_insert)))
    throw Error('Reason column/grant differs');
  const p=snapshot.posture;
  if(!p?.relrowsecurity || !p?.relforcerowsecurity || p.app_can_update || p.app_can_delete || p.app_owns_table || p.app_bypass)
    throw Error('Journal authorization posture differs');
  const names=p.triggers?.map(t=>t[0]);
  if(!['period_decision_guard','privacy_write_fence','security_journal_audit'].every(n=>names?.includes(n)) ||
    p.triggers.some(t=>!['O','A'].includes(t[2])) || p.policies?.length!==1 ||
    !p.policies.some(p=>p[0]==='household_scope' && p[1]==='(household_id = app.current_household())' && p[2]===p[1]))
    throw Error('Journal guards/policy differ');
}
export function reader(db) {
  return sql=>db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5s'");
    return tx.$queryRawUnsafe(sql);
  },{maxWait:5000,timeout:10000});
}
export async function snapshot(read) {
  const [posture]=await read(`SELECT c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner)='app_user' AS app_owns_table,
    has_table_privilege('app_user',c.oid,'UPDATE') AS app_can_update,
    has_table_privilege('app_user',c.oid,'DELETE') AS app_can_delete,
    (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='app_user') AS app_bypass,
    (SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
    (SELECT jsonb_agg(jsonb_build_array(polname,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid=c.oid) AS policies
    FROM pg_class c WHERE c.oid='public.document_period_decisions'::regclass`);
  const constraints=await read(`SELECT conname,pg_get_constraintdef(oid) AS definition,convalidated FROM pg_constraint
    WHERE conrelid='public.document_period_decisions'::regclass ORDER BY conname`);
  const [column]=await read(`SELECT data_type,is_nullable,column_default,has_column_privilege('app_user','public.document_period_decisions','rejection_reason','INSERT') AS can_insert FROM information_schema.columns WHERE table_schema='public' AND table_name='document_period_decisions' AND column_name='rejection_reason'`);
  return {posture,constraints,column:column??null};
}
export async function runRollout({root,db,context,phase,migrate}) {
  const manifest=JSON.parse(await readFile(join(root,'scripts/rejection-rollout-manifest.json'),'utf8'));
  const {local,files}=await loadInventory(root,manifest);
  const read=reader(db);
  const ledger=()=>read('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name');
  const p=plan({phase,manifest,local,ledger:await ledger(),context});
  let stage,before;
  try {
    await execute(p,{
      async precheck(){
        const sql=await readFile(join(root,'ops/staging-rejection/upgrade-preflight.sql'),'utf8');
        const [row]=await read(sql.replace(/;\s*$/,''));
        if(Object.values(row)[0]?.ok!==true) throw Error('Upgrade preflight refused');
        before=await snapshot(read);assertPhaseSchema(before,phase);
        // Advisory snapshot. The migration's bounded ACCESS EXCLUSIVE lock is the drain.
        const [locks]=await read(`SELECT count(*)::int AS competing FROM pg_locks WHERE relation='public.document_period_decisions'::regclass AND pid<>pg_backend_pid()`);
        if(locks.competing!==0) throw Error('Competing journal lock; defer without retry');
        stage=await stagePrefix(root,files,p.after);
      },
      async migrate(){await migrate(join(stage,'schema.prisma'));},
      async postcheck(){
        const rows=await ledger();
        if(rows.length!==Object.keys(p.after).length || new Set(rows.map(r=>r.migration_name)).size!==rows.length ||
          rows.some(r=>!r.finished_at||r.rolled_back_at||p.after[r.migration_name]!==r.checksum)) throw Error('Post-migration ledger differs');
        const after=await snapshot(read);assertPhaseSchema(after,phase,true);
        if(JSON.stringify(after.posture)!==JSON.stringify(before.posture)) throw Error('Journal posture changed');
        for(const c of before.constraints) if(c.conname!==PAUSE &&
          !after.constraints.some(a=>JSON.stringify(a)===JSON.stringify(c))) throw Error('Existing constraint changed');
      }
    });
    return {phase,completed:Object.keys(p.after).length};
  }finally{if(stage)await rm(stage,{recursive:true,force:true});}
}
