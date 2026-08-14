import { describe, expect, it, vi } from "vitest";
import { Database, ScopeError } from "../../src/scoped.js";
import { AuditError, currentActor, runAsSystem, runAsUser } from "../../src/audit.js";
import type { PrismaClient } from "@prisma/client";

/** Unit tier: guards that must hold before a connection is ever opened. */

function fakePrisma(): { client: PrismaClient; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn();
  // `$extends` returns the same object: Database applies the audit extension in its
  // constructor, and these tests are about the guards that fire before any transaction
  // opens — not about the extension.
  const client: Record<string, unknown> = { $transaction: transaction };
  client["$extends"] = () => client;
  return { client: client as unknown as PrismaClient, transaction };
}

describe("withHousehold input validation", () => {
  it.each([
    ["empty string", ""],
    ["sql injection attempt", "'; DROP TABLE items; --"],
    ["not a uuid", "household-42"],
    ["uuid-ish but wrong shape", "01890a5d-ac96-774b-bb1b"],
    ["nil uuid (no valid version nibble)", "00000000-0000-0000-0000-000000000000"],
  ])("rejects %s without opening a transaction", async (_label, value) => {
    const { client, transaction } = fakePrisma();
    const db = new Database(client);

    await expect(db.withHousehold(value, async () => "unreachable")).rejects.toBeInstanceOf(
      ScopeError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("accepts a v7 uuid and opens exactly one transaction", async () => {
    const { client, transaction } = fakePrisma();
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: vi.fn() }),
    );
    const db = new Database(client);

    await expect(
      db.withHousehold("01890a5d-ac96-774b-bb1b-2b0d7b3dcb6d", async () => "ok"),
    ).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("bounds scoped work with a short timeout by default", async () => {
    const { client, transaction } = fakePrisma();
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: vi.fn() }),
    );
    const db = new Database(client);

    await db.withHousehold("01890a5d-ac96-774b-bb1b-2b0d7b3dcb6d", async () => null);

    const options = transaction.mock.calls[0]?.[1] as { timeout: number };
    expect(options.timeout).toBeLessThanOrEqual(5_000);
  });
});

describe("withPrincipal input validation", () => {
  it.each([
    ["empty string", ""],
    ["sql injection attempt", "'; DROP TABLE household_users; --"],
    ["not a uuid", "user-42"],
  ])("rejects %s without opening a transaction", async (_label, value) => {
    const { client, transaction } = fakePrisma();
    const db = new Database(client);

    await expect(db.withPrincipal(value, async () => "unreachable")).rejects.toBeInstanceOf(
      ScopeError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("accepts a valid uuid and opens exactly one transaction", async () => {
    const { client, transaction } = fakePrisma();
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: vi.fn() }),
    );
    const db = new Database(client);

    await expect(
      db.withPrincipal("01890a5d-ac96-774b-bb1b-2b0d7b3dcb6d", async () => "ok"),
    ).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("actor context", () => {
  it("has no ambient actor by default", () => {
    expect(currentActor()).toBeUndefined();
  });

  it("demands a documented reason for a system actor", async () => {
    // Same bar as the dispatcher hatch: an unexplained system mutation is not auditable.
    expect(() => runAsSystem("why", async () => null)).toThrow(AuditError);
  });

  it("exposes the acting user inside its scope and nowhere else", async () => {
    const id = "01890a5d-ac96-774b-bb1b-2b0d7b3dcb6d";
    await runAsUser(id, async () => {
      expect(currentActor()).toEqual({ type: "user", userId: id });
    });
    expect(currentActor()).toBeUndefined();
  });

  it("keeps concurrent actors independent", async () => {
    const seen = await Promise.all([
      runAsUser("a1890a5d-ac96-774b-bb1b-2b0d7b3dcb6d", async () => {
        await new Promise((r) => setTimeout(r, 20));
        return currentActor();
      }),
      runAsSystem("dispatcher drain", async () => currentActor()),
    ]);
    expect(seen[0]).toEqual({ type: "user", userId: "a1890a5d-ac96-774b-bb1b-2b0d7b3dcb6d" });
    expect(seen[1]).toEqual({ type: "system", reason: "dispatcher drain" });
  });
});

describe("dispatcher escape hatch", () => {
  it("demands a documented reason", async () => {
    const { client, transaction } = fakePrisma();
    const db = new Database(client);

    await expect(db.unsafeAcrossAllHouseholds("why", async () => null)).rejects.toBeInstanceOf(
      ScopeError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
