import { describe, expect, it } from "vitest";
import { CAPABILITIES, ForbiddenError, assertCan, can, type Capability } from "./policy";

/**
 * doc 06 §3's table, asserted rather than trusted. The matrix is transcribed in the
 * module; these tests check the transcription and the fail-closed edges around it.
 */

const HOUSEHOLD = "0192f5a1-0000-7000-8000-0000000000a1";
const OTHER = "0192f5a1-0000-7000-8000-0000000000b2";
const subject = (role: "owner" | "member" | "viewer") => ({
  userId: "0192f5a1-0000-7000-8000-000000000001",
  householdId: HOUSEHOLD,
  role,
});

/** doc 06 §3, restated independently of the implementation's own constant. */
const EXPECTED: Record<Capability, Array<"owner" | "member" | "viewer">> = {
  "registry.read": ["owner", "member", "viewer"],
  "document.upload": ["owner", "member"],
  "document.review": ["owner", "member"],
  "item.write": ["owner", "member"],
  "obligation.write": ["owner", "member"],
  "secret.reveal": ["owner", "member"],
  "member.manage": ["owner"],
  "settings.manage": ["owner"],
  "household.delete": ["owner"],
  "household.export": ["owner"],
};

describe("the matrix matches doc 06 §3", () => {
  it("covers every capability and no others", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED) as Capability[])("%s allows exactly the documented roles", (cap) => {
    for (const role of ["owner", "member", "viewer"] as const) {
      expect(can(subject(role), cap)).toBe(EXPECTED[cap].includes(role));
    }
  });

  it("omits the postponed agent capabilities (PRD §9)", () => {
    const keys = Object.keys(CAPABILITIES);
    expect(keys).not.toContain("task_run.start");
    expect(keys).not.toContain("approval.approve");
  });
});

describe("viewer is read-only", () => {
  it("may read and nothing else", () => {
    expect(can(subject("viewer"), "registry.read")).toBe(true);
    for (const cap of Object.keys(EXPECTED) as Capability[]) {
      if (cap === "registry.read") continue;
      expect(can(subject("viewer"), cap)).toBe(false);
    }
  });
});

describe("member cannot administer", () => {
  it.each(["member.manage", "settings.manage", "household.delete", "household.export"] as Capability[])(
    "%s is owner-only",
    (cap) => {
      expect(can(subject("member"), cap)).toBe(false);
      expect(can(subject("owner"), cap)).toBe(true);
    },
  );
});

describe("cross-household authorization", () => {
  it("denies an owner acting on another household's resource", () => {
    expect(can(subject("owner"), "item.write", { householdId: OTHER })).toBe(false);
    expect(can(subject("owner"), "registry.read", { householdId: OTHER })).toBe(false);
  });

  it("allows the same capability on its own household", () => {
    expect(can(subject("owner"), "item.write", { householdId: HOUSEHOLD })).toBe(true);
  });

  it("is not a substitute for tenancy — it denies before the database is asked", () => {
    // The point of the check: turn a silent empty result into a loud denial.
    expect(() => assertCan(subject("owner"), "item.write", { householdId: OTHER })).toThrowError(
      ForbiddenError,
    );
  });
});

describe("fail-closed edges", () => {
  it("denies an unknown capability", () => {
    expect(can(subject("owner"), "item.destroy" as Capability)).toBe(false);
  });

  it("denies an unknown role", () => {
    const impostor = { ...subject("owner"), role: "superuser" as "owner" };
    for (const cap of Object.keys(EXPECTED) as Capability[]) {
      expect(can(impostor, cap)).toBe(false);
    }
  });

  it("denies an empty or missing role", () => {
    expect(can({ ...subject("owner"), role: "" as "owner" }, "registry.read")).toBe(false);
    expect(
      can({ ...subject("owner"), role: undefined as unknown as "owner" }, "registry.read"),
    ).toBe(false);
  });

  it("assertCan names the capability it refused", () => {
    try {
      assertCan(subject("viewer"), "item.write");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).capability).toBe("item.write");
    }
  });
});
