import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let deletion: typeof import("@/app/v1/households/[id]/deletion/route");
let undo: typeof import("@/app/v1/households/[id]/deletion/undo/route");
let household: typeof import("@/app/v1/households/[id]/route");
let base: string;
beforeAll(async () => {
  h = await domainHarness();
  base = `/v1/households/${h.household}/deletion`;
  [deletion, undo, household] = await Promise.all([import("@/app/v1/households/[id]/deletion/route"),
    import("@/app/v1/households/[id]/deletion/undo/route"), import("@/app/v1/households/[id]/route")]);
});
afterAll(async () => {
  if (h) {
    const where = { householdId: { in: [h.household, h.foreignHousehold] } };
    await h.admin.deletionObservation.deleteMany({ where }); await h.admin.deletionAttempt.deleteMany({ where });
    await h.admin.deletionResource.deleteMany({ where }); await h.admin.householdDeletion.deleteMany({ where });
    await h.close();
  }
});
const request = (body: unknown) => ({ method: "POST", body });

describe("owner deletion request, undo window and fence", () => {
  it("starts with no request and never claims a receipt", async () => {
    const r = await deletion.GET(await h.request(base));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ request: null, finalReceiptIssuable: false });
  });
  it("refuses viewers, sessions without the required step-up, inexact confirmation and foreign paths", async () => {
    expect((await deletion.POST(await h.request(base, { ...request({ confirmation: "DELETE HOUSEHOLD" }), user: h.viewer }))).status).toBe(403);
    expect((await deletion.POST(await h.request(base, { ...request({ confirmation: "DELETE HOUSEHOLD" }), assurance: "aal1" }))).status).toBe(403);
    expect((await deletion.POST(await h.request(base, request({ confirmation: "delete household" })))).status).toBe(400);
    expect((await deletion.POST(await h.request(base, request({ confirmation: "DELETE HOUSEHOLD", extra: true })))).status).toBe(400);
    expect((await deletion.POST(await h.request(`/v1/households/${h.foreignHousehold}/deletion`, request({ confirmation: "DELETE HOUSEHOLD" })))).status).toBe(404);
    expect(await h.admin.householdDeletion.count({ where: { householdId: { in: [h.household, h.foreignHousehold] } } })).toBe(0);
  });
  it("records one request with a 14-day database-clock undo window, idempotently and audited", async () => {
    const first = await deletion.POST(await h.request(base, request({ confirmation: "DELETE HOUSEHOLD" })));
    expect(first.status).toBe(202);
    const body = await first.json();
    expect(body).toMatchObject({ request: { state: "grace", undoAvailable: true }, finalReceiptIssuable: false, providerErasure: "unverified", backupExpiry: "unverified" });
    const window = Date.parse(body.request.undoUntil) - Date.parse(body.request.requestedAt);
    expect(window).toBeGreaterThanOrEqual(14 * 86400_000);
    const second = await deletion.POST(await h.request(base, request({ confirmation: "DELETE HOUSEHOLD" })));
    expect((await second.json()).request.id).toBe(body.request.id);
    expect(await h.admin.householdDeletion.count({ where: { householdId: h.household } })).toBe(1);
    expect(await h.admin.auditLog.count({ where: { householdId: h.household, targetType: "household_deletions" } })).toBeGreaterThanOrEqual(1);
  });
  it("undo works only for the current request inside the window", async () => {
    const current = (await (await deletion.GET(await h.request(base))).json()).request;
    expect((await undo.POST(await h.request(`${base}/undo`, request({ requestId: "00000000-0000-4000-8000-000000000000" })))).status).toBe(409);
    expect((await undo.POST(await h.request(`${base}/undo`, { ...request({ requestId: current.id }), user: h.viewer }))).status).toBe(403);
    const ok = await undo.POST(await h.request(`${base}/undo`, request({ requestId: current.id })));
    expect(ok.status).toBe(200);
    expect((await ok.json()).request).toBeNull();
    expect((await undo.POST(await h.request(`${base}/undo`, request({ requestId: current.id })))).status).toBe(409);
  });
  it("a matured request cannot be undone, is fenced by the worker, and then blocks household writes", async () => {
    await deletion.POST(await h.request(base, request({ confirmation: "DELETE HOUSEHOLD" })));
    const row = (await h.admin.householdDeletion.findFirstOrThrow({ where: { householdId: h.household, state: "grace" } }));
    await h.admin.householdDeletion.update({ where: { id: row.id }, data: { requestedAt: new Date(Date.now() - 15 * 86400_000), undoUntil: new Date(Date.now() - 86400_000) } });
    expect((await undo.POST(await h.request(`${base}/undo`, request({ requestId: row.id })))).status).toBe(409);
    // Fencing is a retention-worker transition (app_user is refused by the guard); fixture only.
    await h.admin.householdDeletion.update({ where: { id: row.id }, data: { state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now() + 900_000) } });
    // Once fenced the household is closed to every session, including status reads; the
    // refusal must say so plainly rather than asking the owner to re-verify security.
    const fencedRead = await deletion.GET(await h.request(base));
    expect(fencedRead.status).toBe(403);
    expect((await fencedRead.json()).detail).toBe("This household is being deleted and can no longer be used.");
    expect((await h.admin.householdDeletion.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("fenced");
    const write = await household.PATCH(await h.request(`/v1/households/${h.household}`, { method: "PATCH", body: { name: "Renamed after fence" } }));
    expect(write.status).toBeGreaterThanOrEqual(400);
    expect((await h.admin.household.findUniqueOrThrow({ where: { id: h.household } })).name).not.toBe("Renamed after fence");
  });
});
