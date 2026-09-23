import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let collection: typeof import("@/app/v1/households/[id]/members/route");
let detail: typeof import("@/app/v1/households/[id]/members/[mid]/route");
let restore: typeof import("@/app/v1/households/[id]/members/[mid]/restore/route");
let base: string, personId: string;
beforeAll(async () => {
  h = await domainHarness();
  base = `/v1/households/${h.household}/members`;
  await h.admin.entitlement.create({ data: { householdId: h.household, periodStart: new Date(), membersMax: 2 } });
  [collection, detail, restore] = await Promise.all([
    import("@/app/v1/households/[id]/members/route"), import("@/app/v1/households/[id]/members/[mid]/route"), import("@/app/v1/households/[id]/members/[mid]/restore/route"),
  ]);
});
afterAll(async () => h?.close());
describe("owner-managed people with durable capacity and archive semantics", () => {
  it("creates a paper member once with no login or invitation", async () => {
    const options = { method: "POST", body: { display_name: "Parent", kind: "dependent" }, headers: { "idempotency-key": "member-create-test" } };
    const first = await collection.POST(await h.request(base, options));
    expect(first.status).toBe(201);
    const body = await first.json(); personId = body.id;
    const second = await collection.POST(await h.request(base, options));
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(body);
    expect(first.headers.get("location")).toBe(`${base}/${personId}`);
    expect(body.user_id).toBeNull();
    expect(await h.admin.householdMember.count({ where: { householdId: h.household } })).toBe(1);
    expect(await h.admin.householdUser.count({ where: { householdId: h.household } })).toBe(2); // existing owner + test viewer
    expect(await h.admin.auditLog.findMany({ where: { action: "household.member_added", householdId: h.household } })).toMatchObject([{ actorId: h.owner, targetId: personId }]);
  });
  it("two concurrent creates cannot both consume the last active slot", async () => {
    await h.admin.householdMember.update({where:{id:personId},data:{userId:h.owner}}); // fixture explicitly binds the self row; names/ages never imply self
    const responses = await Promise.all(["One", "Two"].map(async (name) => collection.POST(await h.request(base, { method: "POST", body: { display_name: name, kind: "adult" } }))));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 402]);
    expect(await h.admin.householdMember.count({ where: { householdId: h.household, archivedAt: null } })).toBe(2);
  });
  it("edits only editable fields and allows explicit clearing of a date", async () => {
    const response = await detail.PATCH(await h.request(`${base}/${personId}`, { method: "PATCH", body: { display_name: "Mom", date_of_birth: "1950-03-04" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: personId, display_name: "Mom", date_of_birth: "1950-03-04" });
    expect((await detail.PATCH(await h.request(`${base}/${personId}`, { method: "PATCH", body: { date_of_birth: null } }))).status).toBe(200);
    expect(await h.admin.householdMember.findUnique({ where: { id: personId } })).toMatchObject({ dateOfBirth: null });
    expect((await detail.PATCH(await h.request(`${base}/${personId}`, { method: "PATCH", body: { user_id: h.owner } }))).status).toBe(400);
  });
  it("archives without removing items, and repeated deletes are harmless", async () => {
    const item = await h.admin.item.create({ data: { householdId: h.household, memberId: personId, name: "Preserved record", kind: "other" } });
    expect((await detail.DELETE(await h.request(`${base}/${personId}`, { method: "DELETE" }))).status).toBe(204);
    const before = await h.admin.auditLog.count({ where: { householdId: h.household, action: "household.member_archived" } });
    expect((await detail.DELETE(await h.request(`${base}/${personId}`, { method: "DELETE" }))).status).toBe(204);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, action: "household.member_archived" } })).toBe(before);
    expect(await h.admin.item.findUnique({ where: { id: item.id } })).toMatchObject({ memberId: personId });
    const active = await (await collection.GET(await h.request(base))).json();
    const archived = await (await collection.GET(await h.request(`${base}?archived=true`))).json();
    expect(active.data.map((row: { id: string }) => row.id)).not.toContain(personId);
    expect(archived.data.map((row: { id: string }) => row.id)).toEqual([personId]);
  });
  it("concurrent restores return the same active person without duplicate audits", async () => {
    const responses = await Promise.all([1, 2].map(async () => restore.POST(await h.request(`${base}/${personId}/restore`, { method: "POST", body: {} }))));
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, action: "household.member_restored" } })).toBe(1);
    expect(await h.admin.householdMember.count({ where: { householdId: h.household, archivedAt: null } })).toBe(2);
  });
  it("rejects restoring after 30 days and preserves the archived row", async () => {
    const archivedAt = new Date(Date.now() - 31 * 86_400_000);
    await h.admin.householdMember.update({ where: { id: personId }, data: { archivedAt } });
    expect((await restore.POST(await h.request(`${base}/${personId}/restore`, { method: "POST", body: {} }))).status).toBe(409);
    expect(await h.admin.householdMember.findUnique({ where: { id: personId } })).toMatchObject({ archivedAt });
  });
  it("rejects viewer mutations and foreign household paths", async () => {
    expect((await collection.POST(await h.request(base, { method: "POST", user: h.viewer, body: { display_name: "Unauthorized", kind: "adult" } }))).status).toBe(403);
    const foreign = await h.admin.householdMember.create({ data: { householdId: h.foreignHousehold, displayName: "Foreign person", kind: "adult" } });
    const absent = await detail.PATCH(await h.request(`${base}/${randomUUID()}`, { method: "PATCH", body: { display_name: "Attack" } }));
    const forbidden = await detail.PATCH(await h.request(`${base}/${foreign.id}`, { method: "PATCH", body: { display_name: "Attack" } }));
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toEqual(await absent.json());
    expect((await detail.DELETE(await h.request(`${base}/${foreign.id}`, { method: "DELETE" }))).status).toBe(204);
    expect(await h.admin.householdMember.findUnique({ where: { id: foreign.id } })).toMatchObject({ displayName: "Foreign person", archivedAt: null });
    expect((await collection.GET(await h.request(`/v1/households/${h.foreignHousehold}/members`))).status).toBe(404);
  });
});
it("a full Free allowance cannot be bypassed by a queued create or legacy cap fields",async()=>{
 const prior=await h.admin.entitlement.findUniqueOrThrow({where:{householdId:h.household}});
 const count=await h.admin.householdMember.count({where:{householdId:h.household,archivedAt:null}});
 await h.admin.entitlement.update({where:{householdId:h.household},data:{membersMax:count+1}});
 let locked!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{locked=r;}),barrier=new Promise<void>(r=>{release=r;});
 const holder=h.admin.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${h.household}`},0))`;locked();await barrier;
  await tx.entitlement.update({where:{householdId:h.household},data:{membersMax:count}});
 });
 await ready;
 const pending=collection.POST(await h.request(base,{method:"POST",body:{display_name:"PUBLIC queued person",kind:"adult"}}));
 try {
  let blocked=false;
  for(let i=0;i<100;i++){
   const [r]=await h.admin.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock'`;
   if(Number(r?.n)>0){blocked=true;break;}await new Promise(r=>setTimeout(r,5));
  }
  expect(blocked).toBe(true);release();await holder;
  expect((await pending).status).toBe(402);
  expect(await h.admin.householdMember.count({where:{householdId:h.household,archivedAt:null}})).toBe(count);
 }finally{release();await holder;await pending;await h.admin.entitlement.update({where:{householdId:h.household},data:{membersMax:prior.membersMax}});}
});
it("application clock skew cannot reopen an expired member restore window",async()=>{
 const realNow=Date.now(),prior=await h.admin.entitlement.findUniqueOrThrow({where:{householdId:h.household}});
 const count=await h.admin.householdMember.count({where:{householdId:h.household,archivedAt:null}});
 await h.admin.entitlement.update({where:{householdId:h.household},data:{membersMax:count+1}});
 const row=await h.admin.householdMember.create({data:{householdId:h.household,kind:"adult",displayName:"PUBLIC expired fixture",archivedAt:new Date(realNow-31*86400000)}});
 try{
  h.security.beforeFactors=async()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(realNow-32*86400000);};
  expect((await restore.POST(await h.request(`${base}/${row.id}/restore`,{method:"POST",body:{}}))).status).toBe(409);
  expect((await h.admin.householdMember.findUniqueOrThrow({where:{id:row.id}})).archivedAt).not.toBeNull();
 }finally{h.security.beforeFactors=undefined;vi.useRealTimers();await h.admin.entitlement.update({where:{householdId:h.household},data:{membersMax:prior.membersMax}});}
});
it("explicit self creation uses the authenticated holder, never a supplied user ID or name",async()=>{
 const household=h.foreignHousehold,base=`/v1/households/${household}/members`,headers={"x-household-id":household};
 await h.admin.entitlement.create({data:{householdId:household,periodStart:new Date()}});
 const post=(body:unknown)=>h.request(base,{method:"POST",user:h.outsider,headers,body}).then(collection.POST);
 const response=await post({display_name:"PUBLIC holder",kind:"adult",is_self:true});expect(response.status).toBe(201);const self=await response.json();expect(self.user_id).toBe(h.outsider);
 expect((await post({display_name:"PUBLIC duplicate",kind:"adult",is_self:true})).status).toBe(409);
 expect((await post({display_name:"PUBLIC extra",kind:"child"})).status).toBe(402); // one existing managed person is retained
 expect((await post({display_name:"PUBLIC invalid",kind:"pet",is_self:true})).status).toBe(400);
 expect((await post({display_name:"PUBLIC forged",kind:"adult",user_id:h.owner})).status).toBe(400);
 expect((await detail.PATCH(await h.request(`${base}/${self.id}`,{method:"PATCH",user:h.outsider,headers,body:{is_self:false}}))).status).toBe(400);
});
