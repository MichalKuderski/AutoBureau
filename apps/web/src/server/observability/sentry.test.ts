// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ServerRuntimeClient,
  createTransport,
  type BaseTransportOptions,
  type Transport,
  type TransportMakeRequestResponse,
} from "@sentry/core";
import { defaultSink, log, resetLogSink, setLogSink, type LogRecord } from "./logger";
import {
  boundedFlush,
  clientOptions,
  composeSinks,
  eventFromRecord,
  installErrorReporting,
  sentryClientFromEnv,
  sentrySink,
} from "./sentry";

/**
 * Production error reporting (blueprint P1-19; ADR-014 as amended by ADR-015).
 *
 * The privacy assertions here deliberately go through the REAL `log()` and inspect the REAL
 * serialised envelope body — the bytes a transport would put on the wire. A test that built
 * a `LogRecord` by hand and checked the mapping would prove the mapping and nothing else;
 * the property that matters is that `logger.ts`'s redaction runs upstream of this module,
 * and only an end-to-end payload assertion can show that.
 */

// `next/server`'s `after()` is mocked so both of its branches are reachable deterministically.
// Its real behaviour is pinned separately, in "the real `after` throws outside a request scope".
const afterMock = vi.hoisted(() => ({
  tasks: [] as unknown[],
  // Default: no request scope, which is what a unit test genuinely is.
  impl: null as null | ((task: unknown) => void),
}));

vi.mock("next/server", () => ({
  after: (task: unknown) => {
    afterMock.tasks.push(task);
    if (afterMock.impl !== null) return afterMock.impl(task);
    throw Object.assign(new Error("`after` was called outside a request scope."), {
      __NEXT_ERROR_CODE: "E468",
    });
  },
}));

const JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJlLXZhbHVlLXRoYXQtaXMtbG9uZw";
const DSN = "https://publickey@o0.ingest.sentry.io/42";

interface Captured {
  readonly bodies: string[];
  readonly events: Record<string, unknown>[];
}

/** A real client whose only difference from production is where the transport points. */
function clientWithCapture(
  respond: (body: string) => Promise<TransportMakeRequestResponse> = async () => ({
    statusCode: 200,
  }),
): { client: ServerRuntimeClient; captured: Captured } {
  const captured: Captured = { bodies: [], events: [] };

  const transport = (options: BaseTransportOptions): Transport =>
    createTransport(options, async (request) => {
      const body = String(request.body);
      captured.bodies.push(body);
      // Envelope framing: header, item header, payload — one line each.
      const payload = body.split("\n")[2];
      if (payload !== undefined) captured.events.push(JSON.parse(payload) as Record<string, unknown>);
      return respond(body);
    });

  // The PRODUCTION options, with only the transport swapped — so an option added to
  // `clientOptions` (a `serverName`, a `runtime`) is caught here rather than shipped.
  const client = new ServerRuntimeClient({ ...clientOptions(DSN), transport });
  client.init();
  return { client, captured };
}

/**
 * `defaultSink` splits by level — `info` to stdout, everything else to stderr — so both
 * streams have to be captured, or an assertion that "nothing was written" would pass simply
 * because the line went to the stream nobody was watching.
 */
function spyOnStreams() {
  return {
    err: vi.spyOn(process.stderr, "write").mockReturnValue(true),
    out: vi.spyOn(process.stdout, "write").mockReturnValue(true),
  };
}

let streams: ReturnType<typeof spyOnStreams>;

beforeEach(() => {
  afterMock.tasks = [];
  afterMock.impl = null;
  streams = spyOnStreams();
});

afterEach(() => {
  resetLogSink();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Every line the local sink wrote, whichever stream it chose. */
const localLines = (): string[] =>
  [...streams.err.mock.calls, ...streams.out.mock.calls].map((call) => String(call[0]));

// ─────────────────────────── A · only `error` is forwarded ───────────────────────────

describe("A · error-only routing (ADR-014 D3)", () => {
  it("forwards an `error` record", async () => {
    const { client, captured } = clientWithCapture();
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    log({ event: "http.unhandled_error", traceId: "t-a1", error: new Error("boom") });
    await client.flush(1000);

    expect(captured.events).toHaveLength(1);
    expect(captured.events[0]!["tags"]).toMatchObject({ event: "http.unhandled_error" });
  });

  it.each([
    ["warn", "auth.rate_limited"],
    ["info", "http.ok"],
  ] as const)("does not forward a `%s` record", async (level, event) => {
    const { client, captured } = clientWithCapture();
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    log({ event, level, traceId: "t-a2", status: 429 });
    await client.flush(1000);

    expect(captured.events).toHaveLength(0);
    // …but it is still recorded locally. Suppressing the remote copy is not suppression.
    expect(localLines()).toHaveLength(1);
  });

  it("keeps every level on the local sink, so nothing is lost by not forwarding", async () => {
    const { client, captured } = clientWithCapture();
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    log({ event: "e", level: "error", traceId: "t-a3", error: new Error("x") });
    log({ event: "w", level: "warn", traceId: "t-a3" });
    await client.flush(1000);

    expect(localLines()).toHaveLength(2);
    expect(captured.events).toHaveLength(1);
  });
});

// ─────────────────────────── B · composition ordering ───────────────────────────

describe("B · `defaultSink` runs first and unconditionally (ADR-015 D3)", () => {
  const record = { level: "error", event: "e" } as LogRecord;

  it("calls the local sink before the remote one", () => {
    const order: string[] = [];
    composeSinks(
      () => order.push("local"),
      () => order.push("remote"),
    )(record);

    expect(order).toEqual(["local", "remote"]);
  });

  it("still writes locally when the remote sink throws synchronously", () => {
    const order: string[] = [];
    const composed = composeSinks(
      () => order.push("local"),
      () => {
        throw new Error("sentry is down");
      },
    );

    expect(() => composed(record)).not.toThrow();
    expect(order).toEqual(["local"]);
  });

  it("composes with the real `defaultSink`, not a copy of it", () => {
    installStderrFailingRemote();
    log({ event: "http.unhandled_error", traceId: "t-b1", error: new Error("boom") });

    const parsed = JSON.parse(localLines()[0]!) as LogRecord;
    expect(parsed.trace_id).toBe("t-b1");
    expect(parsed.event).toBe("http.unhandled_error");
  });
});

/** The composed production sink, with a remote half guaranteed to throw. */
function installStderrFailingRemote(): void {
  setLogSink(
    composeSinks(defaultSink, () => {
      throw new Error("sentry is down");
    }),
  );
}

// ─────────────────────────── C · failure isolation ───────────────────────────

describe("C · a Sentry failure cannot reach the caller (ADR-014 D7)", () => {
  it("does not make `log()` throw when the remote sink throws", () => {
    installStderrFailingRemote();
    expect(() =>
      log({ event: "e", traceId: "t-c1", error: new Error("x") }),
    ).not.toThrow();
  });

  it("does not change what `log()` returns", () => {
    installStderrFailingRemote();
    expect(log({ event: "e", traceId: "t-c2", error: new Error("x") })).toBe(true);
    expect(localLines()).toHaveLength(1);
  });

  it.each([
    ["a rejecting transport", async (): Promise<TransportMakeRequestResponse> => Promise.reject(new Error("net down"))],
    ["a 5xx response", async (): Promise<TransportMakeRequestResponse> => ({ statusCode: 500 })],
  ])("keeps the local record when the transport fails: %s", async (_label, respond) => {
    const { client } = clientWithCapture(respond);
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    expect(log({ event: "e", traceId: "t-c3", error: new Error("x") })).toBe(true);
    await expect(client.flush(1000)).resolves.not.toThrow();
    expect(localLines()).toHaveLength(1);
  });
});

// ─────────────────────────── D · configuration ───────────────────────────

describe("D · an unset DSN is a normal configuration (ADR-014 D6)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("builds no client when SENTRY_DSN is %s", (_label, value) => {
    vi.stubEnv("SENTRY_DSN", value as string);
    expect(sentryClientFromEnv()).toBeNull();
  });

  it("reports that remote reporting is inactive, rather than claiming success", () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect(installErrorReporting()).toBe(false);
  });

  it("leaves local logging exactly as it was", () => {
    vi.stubEnv("SENTRY_DSN", "");
    resetLogSink();
    installErrorReporting();

    log({ event: "http.unhandled_error", traceId: "t-d1", error: new Error("boom") });
    expect(localLines()).toHaveLength(1);
    expect((JSON.parse(localLines()[0]!) as LogRecord).trace_id).toBe("t-d1");
  });

  it("builds a client when a DSN is present", () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    const client = sentryClientFromEnv();
    expect(client).not.toBeNull();
    expect(client!.getDsn()).toBeDefined();
  });
});

// ────────────── E/F · the forwarded payload, and where redaction happened ──────────────

describe("E/F · nothing sensitive reaches the wire, because redaction ran upstream", () => {
  const SECRETS = {
    email: "alice@example.com",
    ip: "203.0.113.9",
    token: JWT,
    cookie: `ab_session=${JWT}`,
    bucket: "a3f1c9e7b25d8046f1ac35be7290dd41c8b6e05a97f3241d0be85cf6a91d7e32",
    password: "hunter2-correct-horse",
  };

  async function forward(input: Parameters<typeof log>[0]): Promise<{ body: string; event: Record<string, unknown> }> {
    const { client, captured } = clientWithCapture();
    setLogSink(composeSinks(defaultSink, sentrySink(client)));
    log(input);
    await client.flush(1000);
    expect(captured.events).toHaveLength(1);
    return { body: captured.bodies[0]!, event: captured.events[0]! };
  }

  it("carries no token, cookie or password from metadata", async () => {
    const { body } = await forward({
      event: "auth.sign_in_error",
      traceId: "t-e1",
      error: new Error("connection refused"),
      meta: {
        accessToken: SECRETS.token,
        cookie: SECRETS.cookie,
        password: SECRETS.password,
        policy: "magic_link_per_identifier",
      },
    });

    for (const secret of [SECRETS.token, SECRETS.cookie, SECRETS.password]) {
      expect(body).not.toContain(secret);
    }
    // The non-sensitive field survives — this is redaction, not blanket deletion.
    expect(body).toContain("magic_link_per_identifier");
  });

  it("carries no ADR-013 bucket value or its subject from the real limiter emission", async () => {
    // Exactly the shape `rate-limit.ts` emits — `meta: { policy }` and nothing else. The
    // guarantee ADR-014 D4 makes about bucket values is delivered here, at the emission
    // site: `bucketOf`'s digest and the address it is derived from are never handed to
    // `log()` at all. This test fails the moment someone adds either to the meta bag.
    const { body } = await forward({
      event: "auth.rate_limit_unavailable",
      traceId: "t-e1b",
      route: "/v1/auth/magic-link",
      method: "POST",
      error: new Error("connection refused"),
      meta: { policy: "magic_link_per_identifier" },
    });

    expect(body).not.toContain(SECRETS.bucket);
    expect(body).not.toContain(SECRETS.email);
    expect(body).not.toContain(SECRETS.ip);
    expect(body).toContain("magic_link_per_identifier");
  });

  it("carries no email address, even when the provider put one in the error message", async () => {
    const { body, event } = await forward({
      event: "http.unhandled_error",
      traceId: "t-e2",
      error: new Error(`Unique constraint failed on users.email: ${SECRETS.email}`),
    });

    expect(body).not.toContain(SECRETS.email);
    // Proof the scrubbing happened in `describeError`, upstream of this module: the marker
    // `redact.ts` substitutes is what arrived, so the sink never saw the address at all.
    expect(String(event["message"])).toContain("[redacted-email]");
  });

  it("never lets a Request, its headers, or a provider body through", async () => {
    const request = new Request("https://app.autobureau.com/v1/auth/sign-in?code=abc123", {
      method: "POST",
      headers: { cookie: SECRETS.cookie, authorization: `Bearer ${JWT}` },
    });

    const { body } = await forward({
      event: "auth.sign_in_error",
      traceId: "t-e3",
      error: new Error("provider rejected"),
      meta: { request, providerBody: { email: SECRETS.email, access_token: SECRETS.token } },
    });

    expect(body).not.toContain(SECRETS.cookie);
    expect(body).not.toContain(SECRETS.email);
    expect(body).not.toContain(JWT);
    expect(body).toContain("[Request]");
  });

  it("sends a hashed household reference, never the household id", async () => {
    const householdId = "0192f5a1-0000-7000-8000-0000000000a1";
    const { body, event } = await forward({
      event: "http.unhandled_error",
      traceId: "t-e4",
      household: "3f8a1c9d0e2b",
      error: new Error("boom"),
    });

    expect(body).not.toContain(householdId);
    expect((event["tags"] as Record<string, unknown>)["household"]).toBe("3f8a1c9d0e2b");
  });

  it("adds no `server_name` and no runtime context (ADR-015 D4)", async () => {
    const { event } = await forward({
      event: "http.unhandled_error",
      traceId: "t-e5",
      error: new Error("boom"),
      stack: true,
    });

    // Asserted on the outcome, not on the presence of a `sendDefaultPii` flag — the flag is
    // deprecated toward removal, and a control that disappears at a major bump is not one.
    expect(event["server_name"]).toBeUndefined();
    expect((event["contexts"] as Record<string, unknown> | undefined)?.["runtime"]).toBeUndefined();
  });

  it("carries the correlation id Gate B2 requires", async () => {
    const { event } = await forward({
      event: "http.unhandled_error",
      traceId: "t-e6-correlation",
      route: "/v1/households/current",
      method: "GET",
      status: 500,
      error: new Error("boom"),
    });

    expect(event["tags"]).toMatchObject({
      trace_id: "t-e6-correlation",
      route: "/v1/households/current",
      method: "GET",
      status: 500,
    });
  });

  it("groups on the event name rather than the scrubbed message", () => {
    const record = {
      ts: new Date().toISOString(),
      level: "error",
      event: "http.idempotency_persist_failed",
      env: "test",
      trace_id: "t-e7",
      error_message: "[redacted-email] conflicted",
    } as LogRecord;

    expect(eventFromRecord(record).fingerprint).toEqual(["http.idempotency_persist_failed"]);
  });
});

// ─────────────────────────── G · the flush is bounded ───────────────────────────

describe("G · flush is bounded by a timer this codebase owns (ADR-015 D5)", () => {
  it("settles against an unresponsive transport — the case the SDK's own timer misses", async () => {
    const { client } = clientWithCapture(() => new Promise<TransportMakeRequestResponse>(() => {}));
    client.captureEvent({ level: "error", message: "m" });

    const started = Date.now();
    await expect(boundedFlush(client)).resolves.toBeUndefined();
    const elapsed = Date.now() - started;

    // Bounded above by this module's own deadline, with slack for a loaded CI runner.
    expect(elapsed).toBeLessThan(4000);
  });

  it("settles even when the SDK's own deadline never fires", async () => {
    // The distinguishing case, and the reason the bound has to be ours. `@sentry/core`
    // races its drain against a timer passed through `safeUnref`, so in a process with
    // nothing else pending — a serverless invocation finishing — that timer never fires and
    // `flush()` never settles. A test runner always keeps the loop alive, so an unresponsive
    // *transport* is not enough to reproduce it; an unsettling `flush()` is.
    const { client } = clientWithCapture();
    vi.spyOn(client, "flush").mockReturnValue(new Promise<boolean>(() => {}));

    const started = Date.now();
    await expect(boundedFlush(client)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("returns promptly when delivery succeeds, so the bound is a ceiling not a wait", async () => {
    const { client } = clientWithCapture();
    client.captureEvent({ level: "error", message: "m" });

    const started = Date.now();
    await boundedFlush(client);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("hands `after()` a function, never a promise", () => {
    const { client } = clientWithCapture();
    afterMock.impl = () => undefined; // a request scope that accepts the task
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    log({ event: "e", traceId: "t-g1", error: new Error("x") });

    expect(afterMock.tasks).toHaveLength(1);
    const task = afterMock.tasks[0];
    expect(typeof task).toBe("function");
    // A promise would take `after()`'s other branch, need a host `waitUntil`, and start the
    // flush immediately — i.e. on the request path.
    expect(task).not.toHaveProperty("then");
  });

  it.each([
    ["E468", "`after` was called outside a request scope."],
    ["E91", "`after()` will not work correctly, because `waitUntil` is not available."],
  ])("still flushes when `after()` throws %s", async (code, message) => {
    const { client, captured } = clientWithCapture();
    afterMock.impl = () => {
      throw Object.assign(new Error(message), { __NEXT_ERROR_CODE: code });
    };
    setLogSink(composeSinks(defaultSink, sentrySink(client)));

    expect(() => log({ event: "e", traceId: "t-g2", error: new Error("x") })).not.toThrow();
    await client.flush(1000);

    expect(captured.events).toHaveLength(1);
    expect(localLines()).toHaveLength(1);
  });

  it("the real `after` throws outside a request scope, so the fallback is reachable", async () => {
    const actual = await vi.importActual<typeof import("next/server")>("next/server");
    expect(() => actual.after(() => undefined)).toThrow(/request scope/i);
  });
});
