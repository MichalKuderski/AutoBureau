import { it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createReadScheduler } from '@/lib/domain/read-scheduler';
import { Database } from '@autobureau/db';
import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { domainHarness } from './integration/domain-harness';
import * as dbModule from '@/server/db';
import { resetBoundaryCache } from '@/server/http/route';
import { GET as summary } from '@/app/v1/dashboard/route';
import { GET as obligations } from '@/app/v1/obligations/route';

const destination='/workspace/scratch/pellum-verification/contention-ed8-results.json';
const all:any[]=[];
const ctx=new AsyncLocalStorage<string>();
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const round=(n:number)=>Math.round(n*10)/10;
const base=process.env.DATABASE_URL!;
for(const name of ['DATABASE_URL','DATABASE_ADMIN_URL']){
 const u=new URL(process.env[name]!);if(u.hostname!=='127.0.0.1'||u.port!=='55439'||u.pathname!=='/pellum_diagnostic')throw Error('Disposable endpoint guard refused');
}
function measured(pool:number, holdMs=0){
 const u=new URL(base);u.searchParams.set('connection_limit',String(pool));u.searchParams.set('pool_timeout','10');u.searchParams.set('connect_timeout','5');
 const raw=new PrismaClient({datasourceUrl:u.toString()});const original=raw.$transaction.bind(raw);const events:any[]=[];
 (raw as any).$transaction=async(fn:any,opts:any)=>{
  const start=performance.now();let acquired:number|undefined;const e:any={request:ctx.getStore()??'control',maxWait:opts?.maxWait,timeout:opts?.timeout};events.push(e);
  try{return await original(async(tx:any)=>{acquired=performance.now();e.acquire_ms=round(acquired-start);const value=await fn(tx);if(holdMs)await tx.$queryRaw`SELECT 1 FROM pg_sleep(${holdMs/1000})`;return value;},opts);}
  catch(error:any){e.code=error.code??error.name;e.reason=String(error.message).includes('Unable to start a transaction')?'acquisition_timeout':String(error.message).includes('expired')?'execution_timeout':'other';throw error;}
  finally{e.total_ms=round(performance.now()-start);if(acquired!==undefined)e.held_ms=round(performance.now()-acquired);else e.acquire_failed_ms=e.total_ms;}
 };
 const observed:any[]=[]; return {db:new Database(raw,e=>observed.push(e)),raw,events,observed};
}
const paths=[
 '/v1/dashboard',
 '/v1/obligations?status=action_needed',
 '/v1/obligations?status=upcoming&status=action_needed&status=in_progress&status=waiting&due_within_days=45',
 '/v1/obligations?direction=owed_to_household&status=upcoming&status=action_needed&status=in_progress&status=waiting&status=missed',
];
function save(value:any){all.push(value);writeFileSync(destination,JSON.stringify(all,null,2));console.log(JSON.stringify({case:value.case,rep:value.rep,duration_ms:value.duration_ms,statuses:value.requests?.map((r:any)=>r.status),transactions:value.transactions?.length,errors:value.transactions?.filter((t:any)=>t.code).map((t:any)=>t.code),max_advisory_waiters:value.max_advisory_waiters}));}
async function monitor(admin:PrismaClient){let done=false;const samples:any[]=[];const work=(async()=>{while(!done){const rows=await admin.$queryRaw<any[]>`SELECT count(*) FILTER (WHERE wait_event='advisory')::int AS advisory, count(*) FILTER (WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=current_database() AND usename='app_user'`;samples.push({ms:round(performance.now()),...rows[0]});await delay(100);}})();return {samples,stop:async()=>{done=true;await work;}};}

for(const scenario of [
 {name:'concurrent_no_delay',pool:1,hold:0,scheduled:false,retries:0},
 {name:'scheduled_no_delay',pool:1,hold:0,scheduled:true,retries:0},
 {name:'concurrent_hold750_retries2',pool:1,hold:750,scheduled:false,retries:2},
 {name:'scheduled_hold750_retries2',pool:1,hold:750,scheduled:true,retries:2},
])for(let rep=1;rep<=3;rep++)it(`${scenario.name} repeat ${rep}`,async()=>{
 const h=await domainHarness();const m=measured(scenario.pool,scenario.hold);const logs=vi.spyOn(console,'error').mockImplementation(()=>{});const spy=vi.spyOn(dbModule,'getDatabase').mockReturnValue(m.db);resetBoundaryCache();
 const mon=await monitor(h.admin);const start=performance.now();const requests:any[]=[];
 try{
  const role=await m.raw.$queryRaw<any[]>`SELECT current_user AS role,rolsuper AS superuser,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;expect(role).toEqual([{role:'app_user',superuser:false,bypass:false}]);
  const schedule=createReadScheduler(), signal=new AbortController().signal;
  async function run(path:string,i:number){let status=0;for(let attempt=0;attempt<=scenario.retries;attempt++){
   const req=await h.request(path);const at=performance.now();const task=()=>ctx.run(`${i}:${attempt}`,()=> (i===0?summary:obligations)(req));const res=await (scenario.scheduled?schedule(signal,task):task());status=res.status;requests.push({query:i,attempt,status,ms:round(performance.now()-at)});await res.text();
   if(status<500||attempt===scenario.retries)break;await delay(Math.min(1000*2**attempt,8000));
  }return status;}
  const selected=paths;
  await Promise.all(selected.map(run));
  if(scenario.hold===0){expect(requests.every(r=>r.status===200)).toBe(true);expect(m.events.length).toBe(selected.length*5);}
  if(scenario.scheduled)expect(requests.every(r=>r.status===200)).toBe(true);
  expect(m.observed.length).toBe(m.events.length);
  expect(m.observed.every(t=>Number.isFinite(t.acquisition_ms))).toBe(true);
  save({case:scenario.name,rep,pool:scenario.pool,artificial_hold_ms:scenario.hold,retry_limit:scenario.retries,duration_ms:round(performance.now()-start),requests,transactions:m.events,observed:m.observed,max_advisory_waiters:Math.max(...mon.samples.map(s=>s.advisory)),samples:mon.samples});
 }finally{await mon.stop();spy.mockRestore();logs.mockRestore();resetBoundaryCache();await m.db.disconnect();await h.close();}
});
