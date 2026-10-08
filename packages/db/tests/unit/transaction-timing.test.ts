import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Database, type TransactionTiming } from "../../src/scoped.js";
const user = "00000000-0000-4000-8000-000000000001";
function fixture(transaction: (...args:any[])=>Promise<unknown>, observe:(e:TransactionTiming)=>void) {
  const raw = { $transaction:transaction, $extends:()=>raw }; return new Database(raw as unknown as PrismaClient,observe);
}
it("distinguishes acquisition failure from execution failure without inspecting secret errors", async () => {
  const events:TransactionTiming[]=[];
  const failure = Object.assign(new Error("SECRET PASSWORD SQL"), { code:"P2028",meta:{ secret:user } });
  const db=fixture(async()=>{throw failure;},e=>events.push(e));
  await expect(db.withPrincipal(user,async()=>1)).rejects.toBe(failure);
  expect(events[0]).toMatchObject({operation:"principal",outcome:"acquisition_failed",execution_ms:null,code:"P2028",waiting_at_start:0,active_at_start:0});
  const tx={$executeRaw:async()=>1};
  const exec=fixture(async fn=>fn(tx),e=>events.push(e));
  await expect(exec.withPrincipal(user,async()=>{throw failure;})).rejects.toBe(failure);
  expect(events[1]).toMatchObject({outcome:"execution_failed",code:"P2028"}); expect(events[1]!.execution_ms).not.toBeNull();
  expect(JSON.stringify(events)).not.toMatch(/SECRET|PASSWORD|SQL|00000000/);
});
it("observes concurrent waiters and active callbacks, resets counters, preserves options and observer errors",async()=>{
  const events:TransactionTiming[]=[], queue:Array<()=>void>=[];
  const fn=vi.fn((callback:any)=>new Promise(resolve=>{queue.push(()=>resolve(callback({$executeRaw:async()=>1})));}));
  const db=fixture(fn,e=>events.push(e));
  const a=db.withPrincipal(user,async()=>1), b=db.withPrincipal(user,async()=>2);
  queue.shift()!(); await a; queue.shift()!(); await b;
  expect(events.map(e=>e.waiting_at_start)).toEqual([0,1]);
  expect(fn.mock.calls[0]![1]).toEqual({timeout:5000,maxWait:2000});
  const safe=fixture(async callback=>callback({$executeRaw:async()=>1}),()=>{throw Error("sink down");});
  expect(await safe.withPrincipal(user,async()=>3)).toBe(3);
});
it("counts active callbacks and resets counters after both settlement and acquisition failure",async()=>{
 const events:TransactionTiming[]=[];let entered!:()=>void,release!:()=>void,fail=false;
 const ready=new Promise<void>(r=>{entered=r;}), held=new Promise<void>(r=>{release=r;});
 const db=fixture(async callback=>{if(fail)throw Object.assign(new Error("private"),{code:"P2028"});return callback({$executeRaw:async()=>1});},e=>events.push(e));
 const a=db.withPrincipal(user,async()=>{entered();await held;return 1;});await ready;
 await db.withPrincipal(user,async()=>2);expect(events[0]).toMatchObject({active_at_start:1,waiting_at_start:0});
 release();await a;fail=true;await expect(db.withPrincipal(user,async()=>3)).rejects.toMatchObject({code:"P2028"});fail=false;
 await db.withPrincipal(user,async()=>4);expect(events.at(-1)).toMatchObject({active_at_start:0,waiting_at_start:0,outcome:"success"});
});
