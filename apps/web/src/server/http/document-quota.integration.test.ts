import {beforeAll,afterAll,it,expect} from 'vitest';
import {domainHarness} from '@/test/integration/domain-harness';
let h:Awaited<ReturnType<typeof domainHarness>>,route:typeof import('@/app/v1/documents/quota/route');
beforeAll(async()=>{h=await domainHarness();await h.admin.entitlement.create({data:{householdId:h.household,periodStart:new Date(),docsUsedThisPeriod:9}});route=await import('@/app/v1/documents/quota/route');},120000);
afterAll(async()=>{await h?.close();});
it('authenticated authoritative quota ignores legacy upload usage and leaks no work capabilities',async()=>{const res=await route.GET(await h.request('/v1/documents/quota'));expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');expect(await res.json()).toEqual({plan:'free',processed:0,allowance:10,warningThreshold:8,warning:false,reservedSlots:0,queuedClean:0,processing:0,needsReview:0,actionRequired:0,nextPeriod:expect.stringMatching(/T00:00:00.000Z$/),grace:false,localOnly:true});});
it('unsigned and foreign-household requests never read quota',async()=>{expect((await route.GET(await h.request('/v1/documents/quota',{user:null}))).status).toBe(401);expect((await route.GET(await h.request('/v1/documents/quota',{headers:{'x-household-id':h.foreignHousehold}}))).status).toBe(403);});
