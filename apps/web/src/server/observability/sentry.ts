import { after } from "next/server";
import {
  ServerRuntimeClient,
  createStackParser,
  createTransport,
  nodeStackLineParser,
  type BaseTransportOptions,
  type Event,
  type ServerRuntimeClientOptions,
  type Transport,
} from "@sentry/core";
import { defaultSink, type LogRecord, type LogSink, setLogSink } from "./logger";

/**
 * Production error reporting (blueprint P1-19; ADR-014 as amended by ADR-015).
 *
 * WHY `@sentry/core` AND NOT `@sentry/node`
 * -----------------------------------------
 * `@sentry/node` is an OpenTelemetry distribution: requiring it loads eight
 * `@opentelemetry/*` packages plus `import-in-the-middle` and `require-in-the-middle`
 * before `init()` is ever called, and `init()` sets OpenTelemetry up unconditionally
 * unless an undocumented `skipOpenTelemetrySetup` is passed. ADR-014 D11 excludes
 * OpenTelemetry by name, so the package cannot be adopted under it (ADR-015 D1). What this
 * module wants is the transport, not the framework — which is exactly `@sentry/core`, two
 * packages, no loader hooks, no `node:` builtins. The CI fence in `ci.yml` keeps it that way.
 *
 * WHY THE VENDOR CANNOT LEAK WHAT THE LOGGER REFUSED
 * --------------------------------------------------
 * This is not a promise, it is an ordering fact in `logger.ts`: `log()` builds the record,
 * runs `describeError` and `redactMeta` over it, and only then calls the sink. A sink is
 * therefore handed an already-redacted `LogRecord` and forwards *that object's fields and
 * nothing else*. There is no second serialisation path, no `beforeSend` scrubber doing the
 * real work, and no request object anywhere near this module. `redact.ts` is not imported
 * here on purpose — a second copy of the redaction rules is how the two drift apart.
 *
 * WHY `defaultSink` RUNS FIRST
 * ----------------------------
 * `log()` wraps the sink in a silent `try/catch`. If the Sentry half ran first and threw,
 * that catch would swallow it *after* the local write had been skipped, and the record
 * would be gone with nothing to show for it. Local stderr is the authoritative record and
 * the fallback (ADR-014 D7); Sentry is a convenience layered on top, so it goes second,
 * inside its own guard.
 */

/**
 * The ceiling on how long a flush may take, in milliseconds.
 *
 * Not a latency budget — the flush never runs on the request path, and a healthy delivery
 * settles in single-digit milliseconds. It is the bound that stops an unreachable ingest
 * endpoint from holding a serverless invocation open.
 */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * A transport over `fetch`.
 *
 * `createTransport` handles envelope buffering and Sentry's own client-side rate limiting;
 * all this supplies is the request. The URL and auth headers come from the client, which
 * derives them from the DSN — no DSN parsing happens in application code.
 *
 * The response headers are passed back because they are what Sentry's rate limiter reads:
 * without them a throttled project would be re-sent to on every event instead of backing off.
 */
function fetchTransport(options: BaseTransportOptions): Transport {
  return createTransport(options, async (request) => {
    // An envelope arrives as a string or a `Uint8Array` over an arbitrary buffer — which
    // could be a `SharedArrayBuffer`, and `fetch` will not take one. Re-wrapping the bytes
    // gives a body `fetch` accepts without weakening the type; envelopes are small, so the
    // copy is not worth an assertion to avoid.
    const body: BodyInit =
      typeof request.body === "string" ? request.body : new Uint8Array(request.body);

    const response = await fetch(options.url, {
      method: "POST",
      body,
      // `?? {}` rather than passing `undefined`: `exactOptionalPropertyTypes` is on, and the
      // client supplies these auth headers on every real DSN anyway.
      headers: options.headers ?? {},
      // Telemetry is never a cacheable read, and Next patches global `fetch` with a cache.
      cache: "no-store",
    });

    return {
      statusCode: response.status,
      headers: {
        "x-sentry-rate-limits": response.headers.get("X-Sentry-Rate-Limits"),
        "retry-after": response.headers.get("Retry-After"),
      },
    };
  });
}

/**
 * The deployment's environment name, for Sentry's environment tag (ADR-014 D6).
 *
 * `VERCEL_ENV` is injected by the platform rather than configured by us — the same
 * derivation `.env.example` already prescribes for `APP_ORIGIN` via `VERCEL_URL` — so this
 * adds no variable to Doppler. It matters because doc 10 §4's alert is "new-issue spike",
 * and preview deployments full of deliberately broken pull requests would otherwise inflate
 * production's count and get the alert demoted.
 */
function environmentName(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * The client's options, separated from its construction so tests can exercise *these* —
 * swapping only the transport — rather than a hand-built lookalike. A privacy assertion
 * against a client configured differently from production proves nothing about production.
 */
export function clientOptions(dsn: string): ServerRuntimeClientOptions {
  return {
    dsn,
    transport: fetchTransport,
    stackParser: createStackParser(nodeStackLineParser()),
    // No integration is installed, which is what actually keeps the vendor's opt-in data
    // collection out — there is no default-PII machinery present to switch off.
    integrations: [],
    environment: environmentName(),
    // Set as a statement of intent, NOT as the control. It is deprecated in favour of
    // `dataCollection` and slated for removal in the SDK's next major; the controls that
    // survive that are the four structural ones in this module's header (ADR-015 D4).
    sendDefaultPii: false,
    // `serverName` and `runtime` are deliberately absent. `ServerRuntimeClient` attaches
    // `server_name` and `contexts.runtime` only when they are supplied, so omitting them is
    // the control — no stripping pass is needed, and none is used.
  };
}

/**
 * Build the client, or `null` when this deployment has no DSN.
 *
 * An unset DSN is a normal configuration, not an error (ADR-014 D6): local runs and CI have
 * no business contacting a vendor, and a boot-time warning about it is noise that teaches
 * developers to ignore warnings.
 */
export function sentryClientFromEnv(): ServerRuntimeClient | null {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (dsn === undefined || dsn === "") return null;

  const client = new ServerRuntimeClient(clientOptions(dsn));
  client.init();
  return client;
}

/**
 * One `LogRecord` becomes one Sentry event.
 *
 * Every field below is read off the record. Nothing is spread, nothing is derived from a
 * request, and nothing is added — which is what makes the payload's contents a property of
 * `logger.ts`'s redaction rather than of this mapping.
 *
 * The fingerprint is the event name, not the message: scrubbed messages are deliberately
 * low-entropy, so Sentry's default message grouping would merge unrelated faults and bury
 * the very spike doc 10 §4's alert watches for.
 */
export function eventFromRecord(record: LogRecord): Event {
  const tags: Record<string, string | number> = {
    event: record.event,
    trace_id: record.trace_id,
    env: record.env,
  };
  if (record.route !== undefined) tags["route"] = record.route;
  if (record.method !== undefined) tags["method"] = record.method;
  if (record.status !== undefined) tags["status"] = record.status;
  // Already a truncated SHA-256 (`householdRef`), never the household id itself.
  if (record.household !== undefined) tags["household"] = record.household;
  if (record.error_kind !== undefined) tags["error_kind"] = record.error_kind;
  if (record.error_code !== undefined) tags["error_code"] = record.error_code;

  const extra: Record<string, unknown> = {};
  if (record.duration_ms !== undefined) extra["duration_ms"] = record.duration_ms;
  if (record.stack !== undefined) extra["stack"] = record.stack;
  if (record.meta !== undefined) extra["meta"] = record.meta;

  return {
    level: "error",
    message: record.error_message ?? record.event,
    timestamp: Date.parse(record.ts) / 1000,
    fingerprint: [record.event],
    tags,
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
  };
}

/**
 * Flush, bounded by a timer this module owns.
 *
 * The SDK's own `flush(timeout)` argument is not a sufficient bound, and the reason is
 * readable in `@sentry/core`: the transport half races the drain against a timer passed
 * through `safeUnref`, and an `unref`'d timer does not keep the Node event loop alive. With
 * an unresponsive ingest endpoint and nothing else pending — which is precisely the shape of
 * a serverless invocation finishing — that race never settles. So the deadline here is a
 * plain, ref'd `setTimeout`, and the SDK's argument is only a hint (ADR-015 D5).
 *
 * Never rejects, and clears its own timer, so a caller can drop the result on the floor
 * without leaving either an unhandled rejection or a pending handle behind.
 */
export function boundedFlush(client: ServerRuntimeClient): Promise<void> {
  return new Promise<void>((resolve) => {
    const deadline = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    const settle = (): void => {
      clearTimeout(deadline);
      resolve();
    };
    client.flush(FLUSH_TIMEOUT_MS).then(settle, settle);
  });
}

/**
 * Hand the flush to Next's `after()`, which runs it once the response has been sent.
 *
 * The **function** form is required, and the distinction is not stylistic. A function is
 * queued and drained by `runCallbacksOnClose()`, which awaits `onClose` first — that is what
 * makes "after the response" true. A promise takes a different branch: it needs a
 * host-supplied `waitUntil`, throws `E91` without one, and would start the flush
 * immediately, i.e. on the request path.
 *
 * Two throw paths, both caught: `E468` when there is no request scope at all, and `E91` as
 * above. A logger cannot know whether its caller is inside a request, so this `try/catch` is
 * structural. The fallback is unawaited — bounded by the same deadline, just with no
 * invocation to attach to.
 */
function scheduleFlush(client: ServerRuntimeClient): void {
  try {
    after(() => boundedFlush(client));
    return;
  } catch {
    // Outside a request scope (`E468`), or no `waitUntil` in this runtime (`E91`).
  }
  void boundedFlush(client);
}

/**
 * The Sentry half of the composed sink.
 *
 * `error` only (ADR-014 D3). `warn` covers expected, security-relevant, potentially
 * high-volume events — `auth.rate_limited` fires once per rejected attempt, so under exactly
 * the attack it detects it would arrive in floods and bury the new-issue spike.
 */
export function sentrySink(client: ServerRuntimeClient): LogSink {
  return (record) => {
    if (record.level !== "error") return;
    client.captureEvent(eventFromRecord(record));
    scheduleFlush(client);
  };
}

/**
 * `local` first and unconditionally; `remote` second, inside its own guard.
 *
 * `local` is deliberately not wrapped: it is the authoritative path, and if stderr itself is
 * failing there is nowhere left to report that — `log()`'s own `try/catch` is the last net.
 * What must never happen is the reverse, a remote failure costing the local record.
 */
export function composeSinks(local: LogSink, remote: LogSink): LogSink {
  return (record) => {
    local(record);
    try {
      remote(record);
    } catch {
      // Telemetry may not cost the local record, and there is nowhere to report this to.
    }
  };
}

let installedClient: ServerRuntimeClient | null = null;

/**
 * Install the composed sink, if this deployment has a DSN.
 *
 * Returns whether remote reporting is now active, so a caller can tell "configured" from
 * "not configured" without inferring it. Idempotent: the client is built once, and the sink
 * is always composed from `defaultSink` rather than from whatever is currently registered,
 * so a second call re-installs an equivalent sink instead of stacking a second copy.
 */
export function installErrorReporting(): boolean {
  installedClient ??= sentryClientFromEnv();
  if (installedClient === null) return false;

  setLogSink(composeSinks(defaultSink, sentrySink(installedClient)));
  return true;
}
