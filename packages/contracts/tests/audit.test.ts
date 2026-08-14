import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AuditActionSchema, ActorTypeSchema, EVENT_TYPES } from "../src/index.js";

/**
 * The registry is small on purpose (ADR-009 D6). These tests guard the two properties
 * that make it useful: an action outside the list cannot be recorded, and the list does
 * not quietly become a second copy of the event taxonomy.
 */

describe("audit action registry", () => {
  it("accepts only registered actions", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AuditActionSchema.parse(action)).toBe(action);
    }
    expect(AuditActionSchema.safeParse("obligation.updated").success).toBe(false);
    expect(AuditActionSchema.safeParse("anything.at.all").success).toBe(false);
    expect(AuditActionSchema.safeParse("").success).toBe(false);
  });

  it("uses the dotted aggregate.verb convention", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("carries no duplicates", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("keeps at least one action the outbox taxonomy deliberately does not carry", () => {
    // `secret.revealed` is a read with no async consumer. If it ever appears in
    // EVENT_TYPES, someone has implied a subscriber that does not exist (D6).
    expect(AUDIT_ACTIONS).toContain("secret.revealed");
    expect(EVENT_TYPES as readonly string[]).not.toContain("secret.revealed");
  });

  it("mirrors the actor_type enum from the data model", () => {
    expect(ActorTypeSchema.parse("user")).toBe("user");
    expect(ActorTypeSchema.parse("system")).toBe("system");
    expect(ActorTypeSchema.parse("agent")).toBe("agent");
    expect(ActorTypeSchema.safeParse("root").success).toBe(false);
  });
});
