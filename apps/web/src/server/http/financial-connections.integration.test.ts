import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let list: typeof import("@/app/v1/households/[id]/financial-connections/route");
let unlink: typeof import("@/app/v1/households/[id]/financial-connections/[itemId]/unlink/route");
let reconnect: typeof import("@/app/v1/households/[id]/financial-connections/[itemId]/reconnect/route");
let base: string, item: string;
const providerItemId = `public-fixture-item-${randomUUID()}`, providerAccountId = `public-fixture-account-${randomUUID()}`;
beforeAll(async () => {
  h = await domainHarness(); base = `/v1/households/${h.household}/financial-connections`;
  [list, unlink, reconnect] = await Promise.all([import("@/app/v1/households/[id]/financial-connections/route"),
    import("@/app/v1/households/[id]/financial-connections/[itemId]/unlink/route"), import("@/app/v1/households/[id]/financial-connections/[itemId]/reconnect/route")]);
  // Fixture administrator seeds an already-exchanged synthetic Item (guards admit only runtime roles).
  item = randomUUID();
  const subject = await h.admin.plaidLocalSubject.create({ data: { householdId: h.household, ownerId: h.owner } });
  await h.admin.plaidLocalExchange.create({ data: { id: item, householdId: h.household, subjectId: subject.id, ownerId: h.owner, consentVersion: 1, state: "completed", leaseToken: randomUUID(), leaseUntil: new Date() } });
  await h.admin.plaidLocalItem.create({ data: { id: item, householdId: h.household, exchangeId: item, subjectId: subject.id, ownerId: h.owner, incarnationId: subject.incarnationId, providerItemId, state: "login-required" } });
  await h.admin.plaidLocalCredential.create({ data: { id: item, householdId: h.household, version: 1, keyVersion: 1, nonce: "A".repeat(16), wrapNonce: "B".repeat(16), wrappedKey: "C".repeat(64), ciphertext: "D".repeat(40) } });
  const account = await h.admin.plaidLocalAccount.create({ data: { householdId: h.household, itemId: item, providerAccountId, name: "PUBLIC Checking", kind: "depository", currentCents: 12345n, availableCents: 12000n } });
  await h.admin.plaidLocalTransaction.create({ data: { householdId: h.household, itemId: item, accountId: account.id, providerTransactionId: `public-fixture-txn-${randomUUID()}`, amountCents: -500n, postedOn: new Date("2026-09-01"), description: "PUBLIC purchase", pending: false } });
});
afterAll(async () => {
  if (h) {
    const where = { householdId: h.household };
    await h.admin.plaidLocalTransaction.deleteMany({ where }); await h.admin.plaidLocalAccount.deleteMany({ where });
    await h.admin.plaidLocalWebhook.deleteMany({ where }); await h.admin.plaidLocalCursor.deleteMany({ where }); await h.admin.plaidLocalItemRoute.deleteMany({ where });
    await h.admin.plaidLocalCredential.deleteMany({ where }); await h.admin.plaidLocalItem.deleteMany({ where });
    await h.admin.plaidLocalExchange.deleteMany({ where }); await h.admin.plaidLocalSubject.deleteMany({ where });
    await h.close();
  }
});

describe("owner financial connections", () => {
  it("lists a safe projection only to the owner", async () => {
    const r = await list.GET(await h.request(base));
    expect(r.status).toBe(200);
    const text = await r.clone().text(), body = await r.json();
    expect(body).toMatchObject({ linkAvailable: false, connections: [{ id: item, state: "login-required", historyAfterRemoval: "delete", accounts: [{ name: "PUBLIC Checking", kind: "depository", currentCents: 12345, availableCents: 12000 }] }] });
    expect(text).not.toContain(providerItemId); expect(text).not.toContain(providerAccountId); expect(text).not.toContain("DDDD");
    expect((await list.GET(await h.request(base, { user: h.viewer }))).status).toBe(403);
  });
  it("requires recent authentication to reconnect or disconnect", async () => {
    expect((await reconnect.POST(await h.request(`${base}/${item}/reconnect`, { method: "POST", body: {}, assurance: "aal1" }))).status).toBe(403);
    expect((await unlink.POST(await h.request(`${base}/${item}/unlink`, { method: "POST", body: { history: "delete" }, user: h.viewer }))).status).toBe(403);
    expect(await h.admin.plaidLocalItem.findUniqueOrThrow({ where: { id: item } })).toMatchObject({ state: "login-required" });
  });
  it("reconnect schedules a fresh read; disconnect records the owner's history choice and stops syncing", async () => {
    const again = await reconnect.POST(await h.request(`${base}/${item}/reconnect`, { method: "POST", body: {} }));
    expect(again.status).toBe(200);
    expect((await again.json()).connections[0]).toMatchObject({ refreshRequested: true });
    expect((await unlink.POST(await h.request(`${base}/${item}/unlink`, { method: "POST", body: { history: "sometimes" } }))).status).toBe(400);
    const r = await unlink.POST(await h.request(`${base}/${item}/unlink`, { method: "POST", body: { history: "retain" } }));
    expect(r.status).toBe(200);
    expect((await r.json()).connections[0]).toMatchObject({ state: "unlinking", historyAfterRemoval: "retain" });
    expect(await h.admin.outboxEvent.count({ where: { householdId: h.household, eventType: "plaid.local_unlink_requested", aggregateId: item } })).toBe(1);
    expect((await reconnect.POST(await h.request(`${base}/${item}/reconnect`, { method: "POST", body: {} }))).status).toBe(409);
    expect((await unlink.POST(await h.request(`/v1/households/${h.foreignHousehold}/financial-connections/${item}/unlink`, { method: "POST", body: { history: "delete" } }))).status).toBe(404);
  });
});
