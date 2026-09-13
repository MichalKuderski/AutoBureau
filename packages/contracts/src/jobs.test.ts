import { describe, expect, it } from "vitest";
import { decodeJobEnvelope, encodeJobEnvelope, JOB_ROUTES, JobConsumerSchema, jobQueue } from "./jobs.js";
import { EVENT_TYPES } from "./events.js";
const envelope = { version: 1, event_id: "9223372036854775807", household_id: "11111111-1111-4111-8111-111111111111", event_type: "document.uploaded", consumer: "pipeline" };
describe("opaque staging queue contract", () => {
  it("round trips opaque identifiers without losing bigint precision", () => {
    expect(decodeJobEnvelope(encodeJobEnvelope(envelope))).toEqual(envelope);
  });
  it.each(["text", "payload", "name", "email", "address", "access_token", "signed_url", "traceparent", "metadata", "attributes"])("refuses %s rather than stripping private data", (key) => {
    expect(() => encodeJobEnvelope({ ...envelope, [key]: "private-canary" })).toThrow();
  });
  it.each(["0", "01", "-1", "1.5", "1e5", "9223372036854775808", "abc", ""])("rejects invalid event id %s", (event_id) => {
    expect(() => decodeJobEnvelope(JSON.stringify({ ...envelope, event_id }))).toThrow();
  });
  it("refuses unknown version, consumer, event type and unregistered consumer routing", () => {
    for (const change of [{ version: 2 }, { consumer: "arbitrary" }, { event_type: "custom.event" }, { consumer: "analytics" }]) {
      expect(() => decodeJobEnvelope(JSON.stringify({ ...envelope, ...change }))).toThrow();
    }
    expect(() => decodeJobEnvelope(" ".repeat(513))).toThrow();
  });
  it("routes each event explicitly and never repeats a logical consumer", () => {
    expect(Object.keys(JOB_ROUTES).sort()).toEqual([...EVENT_TYPES].sort());
    for (const routes of Object.values(JOB_ROUTES)) {
      expect(new Set(routes).size).toBe(routes.length);
      for (const consumer of routes) {
        expect(JobConsumerSchema.safeParse(consumer).success).toBe(true);
        expect(["pipeline", "notifications"]).toContain(jobQueue(consumer));
      }
    }
  });
});
