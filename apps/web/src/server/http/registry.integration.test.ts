import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor } from "@autobureau/contracts";
import { domainHarness } from "@/test/integration/domain-harness";

let h: Awaited<ReturnType<typeof domainHarness>>;
let itemList: typeof import("@/app/v1/items/route");
let item: typeof import("@/app/v1/items/[id]/route");
let documentList: typeof import("@/app/v1/documents/route");
let document: typeof import("@/app/v1/documents/[id]/route");
let obligationList: typeof import("@/app/v1/obligations/route");
let obligation: typeof import("@/app/v1/obligations/[id]/route");
let dashboard: typeof import("@/app/v1/dashboard/route");
const ids = Array.from({ length: 4 }, () => randomUUID());
const docId = randomUUID(), foreignDoc = randomUUID(), member = randomUUID();
const obl = [randomUUID(), randomUUID(), randomUUID()];
const sentinel = "raw-identifier-and-storage-canary";
beforeAll(async () => {
  h = await domainHarness();
  await h.admin.householdMember.create({ data: { id: member, householdId: h.household, kind: "dependent", displayName: "Parent" } });
  for (const [id, householdId] of [[docId, h.household], [foreignDoc, h.foreignHousehold]] as const) {
    await h.admin.document.create({ data: { id, householdId, source: "upload", status: "needs_review", title: "Policy source",
      sha256: createHash("sha256").update(id).digest(), storagePath: sentinel, mimeType: "application/pdf", sizeBytes: 2500,
      extracted: { account_number: sentinel }, error: { internal_trace: sentinel } } });
  }
  const at = new Date("2026-09-01T00:00:00Z");
  await h.admin.item.createMany({ data: ids.map((id, i) => ({ id, householdId: i === 3 ? h.foreignHousehold : h.household,
    name: `Policy ${i}`, kind: "insurance_policy", memberId: i === 0 ? member : null, sourceDocumentId: i === 0 ? docId : null,
    amountCents: 1999n, currency: "USD", attrs: { account_number: sentinel }, createdAt: at })) });
  await h.admin.itemSecret.create({ data: { itemId: ids[0]!, field: "policy_number", ciphertext: Buffer.from(sentinel), keyVersion: 1, last4: "1234" } });
  const due = new Date(Date.now() + 86_400_000);
  await h.admin.obligation.createMany({ data: obl.map((id, i) => ({ id, householdId: i === 2 ? h.foreignHousehold : h.household,
    title: `Renew policy ${i}`, kind: "renewal", source: i === 0 ? "ai" : "user", sourceDocumentId: i === 0 ? docId : null,
    aiConfidence: i === 0 ? 0.999 : null, memberId: i === 0 ? member : null, itemId: i === 0 ? ids[0]! : null,
    status: i === 0 ? "action_needed" : "upcoming", priority: i === 0 ? 1 : 2, dueAt: due })) });
  [itemList, item, documentList, document, obligationList, obligation, dashboard] = await Promise.all([
    import("@/app/v1/items/route"), import("@/app/v1/items/[id]/route"), import("@/app/v1/documents/route"),
    import("@/app/v1/documents/[id]/route"), import("@/app/v1/obligations/route"), import("@/app/v1/obligations/[id]/route"),
    import("@/app/v1/dashboard/route"),
  ]);
});
afterAll(async () => h?.close());

describe("real tenant registry reads", () => {
  it("pages across equal timestamps without skipping, duplicating or leaking rows", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await itemList.GET(await h.request(`/v1/items?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { id: string; household_id: string }[]; next_cursor: string | null };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.household_id).toBe(h.household);
      seen.push(body.data[0]!.id);
      cursor = body.next_cursor;
    } while (cursor && seen.length < 6);
    expect(seen.sort()).toEqual(ids.slice(0, 3).sort());
    expect(new Set(seen).size).toBe(3);
    expect(cursor).toBeNull();
  });
  it("returns only allowlisted fields and masked secret metadata", async () => {
    const response = await item.GET(await h.request(`/v1/items/${ids[0]}`));
    const body = await response.json();
    expect(body).toMatchObject({ member_name: "Parent", amount_cents: 1999, document_count: 1, open_obligation_count: 1, secrets: [{ field: "policy_number", last4: "1234" }] });
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(body).not.toHaveProperty("attrs");
    expect(body).not.toHaveProperty("ciphertext");
    const doc = await document.GET(await h.request(`/v1/documents/${docId}`));
    const docBody = await doc.json();
    expect(docBody).toMatchObject({ title: "Policy source", member_name: "Parent", linked_item_ids: [ids[0]] });
    expect(JSON.stringify(docBody)).not.toContain(sentinel);
    expect(docBody).not.toHaveProperty("storage_path");
    expect(docBody).not.toHaveProperty("extracted");
  });
  it("uses tenant-safe source documents for provenance", async () => {
    const response = await obligation.GET(await h.request(`/v1/obligations/${obl[0]}`));
    expect(await response.json()).toMatchObject({ source: "ai", member_name: "Parent", item_name: "Policy 0", provenance: { document_id: docId, document_title: "Policy source" }, days_until: 1 });
  });
  it("foreign singleton reads match absent rows, while forged scope is forbidden", async () => {
    for (const [route, prefix, id] of [[item, "items", ids[3]], [document, "documents", foreignDoc], [obligation, "obligations", obl[2]]] as const) {
      const foreign = await route.GET(await h.request(`/v1/${prefix}/${id}`));
      const absent = await route.GET(await h.request(`/v1/${prefix}/${randomUUID()}`));
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toEqual(await absent.json());
    }
    expect((await itemList.GET(await h.request("/v1/items", { headers: { "x-household-id": h.foreignHousehold } }))).status).toBe(403);
  });
  it("applies server filters and searches titles without searching identifier fields", async () => {
    const matching = await itemList.GET(await h.request(`/v1/items?member_id=${member}&q=POLICY&kind=insurance_policy`));
    expect((await matching.json()).data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
    expect((await (await itemList.GET(await h.request(`/v1/items?q=${sentinel}`))).json()).data).toEqual([]);
    expect((await (await documentList.GET(await h.request(`/v1/documents?member_id=${member}&status=needs_review`))).json()).data).toHaveLength(1);
    expect((await (await obligationList.GET(await h.request("/v1/obligations?status=action_needed&status=upcoming&due_within_days=2"))).json()).data.map((row: { id: string }) => row.id)).toEqual(obl.slice(0, 2));
  });
  it("never turns an empty result into fixture records", async () => {
    const response = await itemList.GET(await h.request("/v1/items?kind=passport"));
    expect(await response.json()).toEqual({ data: [], next_cursor: null });
  });
  it.each(["limit=101", "limit=0", "status=bogus", "sort=household_id", "cursor=bad", "member_id=bad"])("rejects invalid list parameters: %s", async (query) => {
    const response = await itemList.GET(await h.request(`/v1/items?${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
  it("rejects a cursor reused under different filters or another household", async () => {
    const first = await (await itemList.GET(await h.request("/v1/items?limit=1"))).json();
    const cursor = encodeURIComponent(first.next_cursor);
    expect((await itemList.GET(await h.request(`/v1/items?kind=passport&cursor=${cursor}`))).status).toBe(400);
    expect((await itemList.GET(await h.request(`/v1/items?cursor=${cursor}`, { user: h.outsider }))).status).toBe(400);
    const decoded = JSON.parse(Buffer.from(first.next_cursor, "base64url").toString());
    const malformed = encodeCursor(["bad-date", ids[0]!], decoded.f);
    expect((await itemList.GET(await h.request(`/v1/items?cursor=${encodeURIComponent(malformed)}`))).status).toBe(400);
  });
  it("computes household totals from RLS-visible records and leaves unknown promises null", async () => {
    const response = await dashboard.GET(await h.request("/v1/dashboard"));
    expect(await response.json()).toEqual({ action_needed: 1, upcoming_30d: 2, needs_review: 1, items_tracked: 3,
      coverage: { captured: 0, expected: null }, value_found_cents: null, next_digest_at: null });
  });
  it("requires authentication and marks every response private", async () => {
    for (const [route, prefix] of [[itemList, "items"], [documentList, "documents"], [obligationList, "obligations"], [dashboard, "dashboard"]] as const) {
      expect((await route.GET(await h.request(`/v1/${prefix}`, { user: null }))).status).toBe(401);
      expect((await route.GET(await h.request(`/v1/${prefix}`))).headers.get("cache-control")).toBe("no-store");
    }
  });
});
