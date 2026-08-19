// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UUID_RE } from "@autobureau/contracts";
import {
  householdRef,
  log,
  resetLogSink,
  routeOf,
  setLogSink,
  traceIdFrom,
  wasLogged,
  withTraceHeader,
  type LogRecord,
} from "./logger";

/**
 * The observability contract (blueprint P0-01).
 *
 * These assertions are the contract later tasks are allowed to rely on: a failure yields
 * exactly one record, that record can be correlated to a request, and nothing sensitive
 * reaches it. The redaction proofs live in `redact.test.ts`; this file is about the
 * record's shape, its correlation, and the exactly-once property.
 */

const JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJlLXZhbHVlLXRoYXQtaXMtbG9uZw";

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  setLogSink((record) => records.push(record));
});

afterEach(() => {
  resetLogSink();
  vi.unstubAllEnvs();
});

// ─────────────────────────── Test A · an error is recorded ───────────────────────────

describe("Test A · an unexpected failure produces one structured record", () => {
  it("emits exactly one record", () => {
    log({ event: "http.unhandled_error", traceId: "trace-abcdefgh", error: new Error("boom") });
    expect(records).toHaveLength(1);
  });

  it("carries a correlation id, a severity, and the error class", () => {
    log({
      event: "http.unhandled_error",
      traceId: "trace-abcdefgh",
      route: "/v1/households/current",
      method: "GET",
      status: 500,
      error: new TypeError("boom"),
    });

    const record = records[0]!;
    expect(record.trace_id).toBe("trace-abcdefgh");
    expect(record.level).toBe("error");
    expect(record.event).toBe("http.unhandled_error");
    expect(record.error_kind).toBe("TypeError");
    expect(record.route).toBe("/v1/households/current");
    expect(record.method).toBe("GET");
    expect(record.status).toBe(500);
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.env).toBeDefined();
  });

  it("records in production — the gate the audit found is gone", () => {
    vi.stubEnv("NODE_ENV", "production");
    log({ event: "http.unhandled_error", traceId: "t-production", error: new Error("boom") });
    expect(records).toHaveLength(1);
    expect(records[0]!.env).toBe("production");
  });

  it("includes a stack only when asked", () => {
    log({ event: "e", traceId: "t-nostack", error: new Error("x") });
    expect(records[0]!.stack).toBeUndefined();

    log({ event: "e", traceId: "t-stack", error: new Error("y"), stack: true });
    expect(records[1]!.stack).toBeDefined();
  });

  it("emits a record with no error at all when one is not supplied", () => {
    log({ event: "http.rejected", level: "warn", traceId: "t-plain", status: 403 });
    expect(records[0]!.error_kind).toBeUndefined();
    expect(records[0]!.level).toBe("warn");
  });
});

// ─────────────────────────── Test F · exactly once ───────────────────────────

describe("Test F · one failure cannot produce two records", () => {
  it("suppresses the same error crossing a second boundary", () => {
    const cause = new Error("boom");

    expect(log({ event: "http.unhandled_error", traceId: "t-1", error: cause })).toBe(true);
    expect(log({ event: "outer.boundary", traceId: "t-1", error: cause })).toBe(false);

    expect(records).toHaveLength(1);
    expect(records[0]!.event).toBe("http.unhandled_error");
  });

  it("reports through `wasLogged` so a caller can branch without emitting", () => {
    const cause = new Error("boom");
    expect(wasLogged(cause)).toBe(false);
    log({ event: "e", traceId: "t-2", error: cause });
    expect(wasLogged(cause)).toBe(true);
  });

  it("treats two distinct errors as two records", () => {
    log({ event: "e", traceId: "t-3", error: new Error("a") });
    log({ event: "e", traceId: "t-3", error: new Error("b") });
    expect(records).toHaveLength(2);
  });

  it("does not suppress records that carry no error", () => {
    log({ event: "http.rejected", traceId: "t-4", status: 403 });
    log({ event: "http.rejected", traceId: "t-4", status: 403 });
    expect(records).toHaveLength(2);
  });
});

// ─────────────────────────── redaction at the logger seam ───────────────────────────

describe("the logger redacts what it is handed", () => {
  it("scrubs metadata without the caller asking", () => {
    log({
      event: "e",
      traceId: "t-5",
      meta: { accessToken: JWT, nested: { cookie: `ab_session=${JWT}` }, safe: "keep me" },
    });

    const serialised = JSON.stringify(records[0]);
    expect(serialised).not.toContain(JWT);
    expect(serialised).toContain("keep me");
  });

  it("scrubs an error message carrying an email address", () => {
    log({
      event: "e",
      traceId: "t-6",
      error: new Error("Unique constraint failed: alice@example.com"),
    });
    expect(records[0]!.error_message).not.toContain("alice@example.com");
  });

  it("never lets a Request into a record", () => {
    const request = new Request("https://app.autobureau.com/v1/x", {
      headers: { cookie: `ab_session=${JWT}` },
    });
    log({ event: "e", traceId: "t-7", meta: { request } });
    expect(JSON.stringify(records[0])).not.toContain(JWT);
  });
});

// ─────────────────────────── correlation ───────────────────────────

describe("correlation ids", () => {
  const requestWith = (headers: Record<string, string> = {}): Request =>
    new Request("https://app.autobureau.com/v1/households/current?token=secret", { headers });

  it("generates a uuidv7 when the request carries none", () => {
    expect(traceIdFrom(requestWith())).toMatch(UUID_RE);
  });

  it("generates a distinct id per request", () => {
    expect(traceIdFrom(requestWith())).not.toBe(traceIdFrom(requestWith()));
  });

  it("adopts a platform-supplied x-request-id", () => {
    const id = "req-01HZY8QK3M4N5P6Q";
    expect(traceIdFrom(requestWith({ "x-request-id": id }))).toBe(id);
  });

  it.each([
    ["a quote, which would break the JSON record", 'abcdefgh"}'],
    ["a space, which would split the field", "abcdefgh injected"],
    ["a value too short to be an id", "short"],
    ["a value long enough to be a payload", "a".repeat(200)],
    ["an empty value", ""],
  ])("refuses %s and generates its own", (_label, supplied) => {
    const generated = traceIdFrom(requestWith({ "x-request-id": supplied }));
    expect(generated).toMatch(UUID_RE);
    expect(generated).not.toBe(supplied);
  });

  it("cannot receive a newline at all — the runtime rejects it first", () => {
    // Worth pinning: `traceIdFrom`'s pattern is the second line of defence, not the only
    // one. A header value carrying a newline never reaches application code because
    // `Headers` refuses to hold it, so log-line forging is blocked twice.
    expect(() => requestWith({ "x-request-id": "abcdefgh\ninjected" })).toThrow();
  });

  it("drops the query string from the recorded route", () => {
    // A query can carry a magic-link code or an email; the path cannot.
    expect(routeOf(requestWith())).toBe("/v1/households/current");
  });

  it("returns the id to the caller on the response", () => {
    const response = withTraceHeader(new Response(null, { status: 500 }), "t-8");
    expect(response.headers.get("x-request-id")).toBe("t-8");
  });
});

describe("household correlation is pseudonymous", () => {
  const HOUSEHOLD = "0192f5a1-0000-7000-8000-0000000000a1";

  it("is stable, so records from one tenant join up", () => {
    expect(householdRef(HOUSEHOLD)).toBe(householdRef(HOUSEHOLD));
  });

  it("does not contain the household id", () => {
    expect(householdRef(HOUSEHOLD)).not.toContain(HOUSEHOLD);
    expect(householdRef(HOUSEHOLD)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("separates distinct households", () => {
    expect(householdRef(HOUSEHOLD)).not.toBe(householdRef("0192f5a1-0000-7000-8000-0000000000a2"));
  });
});

// ─────────────────────────── the default sink ───────────────────────────

describe("the default sink emits one JSON object per line", () => {
  it("writes structured JSON to stderr for an error", () => {
    resetLogSink();
    vi.stubEnv("NODE_ENV", "production");
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    log({ event: "http.unhandled_error", traceId: "t-9", error: new Error("boom") });

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]![0]);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line) as LogRecord;
    expect(parsed.trace_id).toBe("t-9");
    expect(parsed.event).toBe("http.unhandled_error");
    write.mockRestore();
  });

  it("survives a sink that throws, because a logger may not raise", () => {
    setLogSink(() => {
      throw new Error("sink is down");
    });
    expect(() => log({ event: "e", traceId: "t-10", error: new Error("x") })).not.toThrow();
  });
});
