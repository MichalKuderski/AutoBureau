import { describe, expect, it } from "vitest";
import {
  EventEnvelopeSchema, ObligationSchema, ObligationOutcomeSchema,
  problem, ProblemDetailsSchema, LAUNCH_DOC_TYPES, CentsSchema,
} from "../src/index.js";
import { uuidv7 } from "../src/ids.js";

describe("event envelope", () => {
  const base = {
    event_type: "obligation.created",
    aggregate_type: "obligation",
    aggregate_id: uuidv7(),
    household_id: uuidv7(),
    payload: { obligation_id: uuidv7(), priority: 1 },
  };

  it("accepts a minimal valid envelope", () => {
    expect(EventEnvelopeSchema.parse(base)).toBeTruthy();
  });

  it("rejects unknown event types (the enum is the registry)", () => {
    expect(() => EventEnvelopeSchema.parse({ ...base, event_type: "obligation.exploded" })).toThrow();
  });

  it("rejects nested state in payloads — IDs and minimal facts only", () => {
    expect(() =>
      EventEnvelopeSchema.parse({ ...base, payload: { obligation: { title: "smuggled state" } } }),
    ).toThrow();
  });
});

describe("obligation contract", () => {
  const valid = {
    id: uuidv7(), household_id: uuidv7(), item_id: null, member_id: null,
    title: "Renew vehicle registration", kind: "renewal", direction: "owed_by_household",
    status: "upcoming", priority: 1, due_at: "2026-10-01T00:00:00Z",
    window_start: null, grace_until: null, amount_cents: 16800, currency: "USD",
    recurrence: null, source: "ai", source_document_id: uuidv7(), ai_confidence: 0.97,
    outcome: null, verified_at: null,
  };

  it("accepts a valid obligation", () => {
    expect(ObligationSchema.parse(valid)).toBeTruthy();
  });

  it("requires direction — entitlements are first-class (A-F2)", () => {
    const { direction: _direction, ...withoutDirection } = valid;
    expect(() => ObligationSchema.parse(withoutDirection)).toThrow();
    expect(
      ObligationSchema.parse({ ...valid, direction: "owed_to_household", kind: "claim" }),
    ).toBeTruthy();
  });

  it("rejects fractional money — cents are integers", () => {
    expect(() => ObligationSchema.parse({ ...valid, amount_cents: 168.5 })).toThrow();
    expect(() => CentsSchema.parse(9.99)).toThrow();
  });

  it("outcome capture validates the A-F3 shape", () => {
    expect(
      ObligationOutcomeSchema.parse({ done_via: "action_kit", cost_cents: 16800, process_matched: true }),
    ).toBeTruthy();
    expect(() => ObligationOutcomeSchema.parse({ done_via: "telepathy" })).toThrow();
  });
});

describe("problem details", () => {
  it("builds valid RFC 9457 shapes with stable type URIs", () => {
    const p = problem("cap-exceeded", { detail: "Document limit reached for this month." });
    expect(ProblemDetailsSchema.parse(p)).toBeTruthy();
    expect(p.type).toBe("https://autobureau.com/problems/cap-exceeded");
    expect(p.status).toBe(402);
  });
});

describe("frozen launch scope", () => {
  it("has exactly the 8 PRD doc types — changing this is a §21 amendment, not a commit", () => {
    expect(LAUNCH_DOC_TYPES).toHaveLength(8);
    expect(LAUNCH_DOC_TYPES).toContain("medical_bill");
  });
});
