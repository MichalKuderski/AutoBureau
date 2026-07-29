import { describe, expect, it } from "vitest";
import { uuidv7, UUID_RE } from "../src/ids.js";

describe("uuidv7", () => {
  it("produces RFC-9562-shaped v7 UUIDs", () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      expect(id).toMatch(UUID_RE);
      expect(id[14]).toBe("7"); // version nibble
      expect(["8", "9", "a", "b"]).toContain(id[19]); // variant
    }
  });

  it("orders lexicographically by timestamp", () => {
    const early = uuidv7(1_000_000);
    const late = uuidv7(2_000_000);
    expect(early < late).toBe(true);
  });

  it("does not collide across a burst", () => {
    const seen = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(seen.size).toBe(10_000);
  });

  it("rejects invalid timestamps", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(1.5)).toThrow(RangeError);
  });
});
