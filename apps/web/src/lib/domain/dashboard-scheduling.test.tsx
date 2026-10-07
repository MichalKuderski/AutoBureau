import { afterEach, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSummary, useObligations, queryKeys } from "./queries";
import { dashboardReadScheduler } from "./read-scheduler";
import { ApiError } from "@/lib/api-client";
afterEach(()=>vi.unstubAllGlobals());
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
function useReads(h:string){const schedule=dashboardReadScheduler(useQueryClient());return {summary:useSummary(h,schedule),items:useObligations(h,{},true,schedule)};}
function setup(retry=false){const client=new QueryClient({defaultOptions:{queries:{retry:retry?(n,e)=>e instanceof ApiError&&e.status>=500&&n<2:false,retryDelay:0,gcTime:0}}});const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;return {client,wrapper};}
it("keeps other panels independent during automatic retries and retries a failed panel manually",async()=>{
 const {client,wrapper}=setup(true);let attempts=0,active=0,peak=0,fail=true;const order:string[]=[];
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{active++;peak=Math.max(peak,active);const path=String(input);order.push(path);await Promise.resolve();active--;
  if(path==="/v1/dashboard"){attempts++;return fail?response({type:"x",title:"Unavailable",status:503},503):response({items_tracked:7});}
  return response({data:[{id:"visible"}],next_cursor:null});}));
 const {result,unmount}=renderHook(()=>useReads("tenant-a"),{wrapper});
 await waitFor(()=>expect(result.current.summary.isError).toBe(true));expect(attempts).toBe(3);expect(peak).toBe(1);expect(result.current.items.data).toEqual([{id:"visible"}]);expect(order[1]).toContain("obligations");
 fail=false;await result.current.summary.refetch();await waitFor(()=>expect(result.current.summary.data?.items_tracked).toBe(7));expect(result.current.items.data).toEqual([{id:"visible"}]);unmount();client.clear();
});
it("drops queued old-tenant reads on navigation, retains captured scope and never delivers old results to new tenant",async()=>{
 const {client,wrapper}=setup();let release!:()=>void;const held=new Promise<void>(r=>{release=r;});const calls:Array<{path:string;household:string;signal:AbortSignal}>=[];
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init:RequestInit)=>{const household=(init.headers as Record<string,string>)["X-Household-Id"]!;calls.push({path:String(input),household,signal:init.signal as AbortSignal});
  if(household==="tenant-a")await held;
  return String(input)==="/v1/dashboard"?response({items_tracked:household==="tenant-a"?99:2}):response({data:[],next_cursor:null});}));
 const {result,rerender,unmount}=renderHook(({h})=>useReads(h),{wrapper,initialProps:{h:"tenant-a"}});
 await waitFor(()=>expect(calls).toHaveLength(1));rerender({h:"tenant-b"});expect(calls[0]!.signal.aborted).toBe(true);expect(calls).toHaveLength(1);
 release();await waitFor(()=>expect(result.current.summary.data?.items_tracked).toBe(2));await waitFor(()=>expect(result.current.items.isSuccess).toBe(true));
 expect(calls.filter(c=>c.household==="tenant-a")).toHaveLength(1);expect(calls.slice(1).every(c=>c.household==="tenant-b")).toBe(true);
 expect(client.getQueryData(queryKeys.summary("tenant-a"))).toBeUndefined();unmount();client.clear();
});
