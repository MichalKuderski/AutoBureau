import { createHash } from "node:crypto";
import { uuidv7 } from "@autobureau/contracts";
import { describeError, redactMeta } from "./redact";

/**
 * Structured server logging (doc 10 §1/§3, blueprint P0-01).
 *
 * WHAT THIS REPLACES
 * ------------------
 * Three `console.error` calls gated behind `process.env.NODE_ENV !== "production"`, which
 * meant a production failure returned a generic problem+json and left **no record
 * anywhere**. That gate is the reason the audit could not attribute a single production
 * behaviour to a cause, and it is the first thing this module removes.
 *
 * WHY NO VENDOR
 * -------------
 * Doc 10 §1 names OpenTelemetry → Grafana and Sentry, and that stack should arrive. It has
 * not, and adding it now would be an infrastructure decision made to satisfy a logging
 * task. Structured JSON on stdout/stderr is what every host already collects and what
 * every one of those tools ingests, so this module is the seam they plug into rather than
 * a thing they replace. `setLogSink` is the whole integration surface.
 *
 * THE RECORD IS ASSEMBLED, NEVER SPREAD
 * -------------------------------------
 * Every field below is named and typed. There is no path by which a caller's object
 * becomes the record — arbitrary context goes in `meta`, which is redacted wholesale. That
 * asymmetry is deliberate: the top level stays predictable for querying, and the one place
 * unpredictable data can enter is the one place that assumes the worst about it.
 */

export type Severity = "error" | "warn" | "info";

/** The emitted record. Snake-cased on the wire to match doc 10 §3's `trace_id`. */
export interface LogRecord {
  readonly ts: string;
  readonly level: Severity;
  readonly event: string;
  readonly env: string;
  readonly trace_id: string;
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly household?: string;
  readonly duration_ms?: number;
  readonly error_kind?: string;
  readonly error_code?: string;
  readonly error_message?: string;
  readonly stack?: string;
  readonly meta?: Record<string, unknown>;
}

export interface LogInput {
  /** Stable, greppable event name, e.g. `http.unhandled_error`. Not a sentence. */
  readonly event: string;
  readonly level?: Severity;
  readonly traceId: string;
  readonly route?: string | undefined;
  readonly method?: string | undefined;
  readonly status?: number | undefined;
  /** Already hashed — pass `householdRef(id)`, never a raw household id. */
  readonly household?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly error?: unknown;
  /** Include a scrubbed stack. Off by default; on for unexpected failures. */
  readonly stack?: boolean | undefined;
  readonly meta?: Record<string, unknown> | undefined;
}

export type LogSink = (record: LogRecord) => void;

/**
 * Default sink: one JSON object per line, on stderr for problems and stdout for
 * everything else. `process.stdout` is used rather than `console` because a structured
 * logger should not go through a formatter it does not control; the `console` fallback
 * exists for runtimes that do not expose the streams.
 *
 * Exported so a production sink can *compose* with it rather than replace it (ADR-014 D2,
 * ADR-015 D3): `setLogSink` takes one function, so an additive sink has to hold this one and
 * call it first. The alternative — a second copy of the emission path in the remote sink —
 * is how development and production formats drift apart, which is the defect the dev/prod
 * branch below already exists to avoid. Exporting it changes no behaviour.
 */
export const defaultSink: LogSink = (record) => {
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(record)
      : // Development gets the same object, indented. Same fields, same redaction — the
        // only difference is whitespace, so a format cannot drift between environments.
        JSON.stringify(record, null, 2);

  const stream = record.level === "info" ? process.stdout : process.stderr;
  if (typeof stream?.write === "function") {
    stream.write(`${line}\n`);
    return;
  }
  // Last resort, for a runtime that exposes no streams. `console.error` is permitted by
  // the lint config; it is the fallback rather than the path, so it stays unstructured-safe.
  console.error(line);
};

let sink: LogSink = defaultSink;

/** Test and integration seam. A future Sentry/OTel exporter registers here. */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = defaultSink;
}

/**
 * Errors already recorded, so one failure cannot produce two records as it crosses two
 * boundaries. A `WeakSet` because the entry must not outlive the error it describes.
 */
const alreadyLogged = new WeakSet<object>();

/** True when this exact error has already produced a record. */
export function wasLogged(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && alreadyLogged.has(cause);
}

function markLogged(cause: unknown): void {
  if (typeof cause === "object" && cause !== null) alreadyLogged.add(cause);
}

/**
 * A stable pseudonym for a household (doc 10 §3: "`household_id` (hashed)").
 *
 * Correlating every error from one tenant is the point; being able to read the tenant's id
 * out of a log aggregator is not. Truncated SHA-256 keeps records joinable to each other
 * and to nothing else.
 */
export function householdRef(householdId: string): string {
  return createHash("sha256").update(householdId).digest("hex").slice(0, 12);
}

/**
 * A correlation id for one inbound request.
 *
 * An inbound `x-request-id` is honoured so a platform-assigned id survives into these
 * records, but only when it looks like an id: the value reaches a log line, and a header
 * is attacker-controlled, so anything carrying a newline or a quote would be forging log
 * entries. Everything else gets a fresh `uuidv7` — the same time-ordered id the rest of
 * the system already uses, rather than a second scheme.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function traceIdFrom(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied !== null && SAFE_REQUEST_ID.test(supplied)) return supplied;
  return uuidv7();
}

/** Attach the correlation id to a response so support can quote it back. */
export function withTraceHeader(response: Response, traceId: string): Response {
  response.headers.set("x-request-id", traceId);
  return response;
}

/**
 * Emit one record.
 *
 * Returns `false` when the event was suppressed as a duplicate, which is what makes
 * "exactly one record per failure" a property of this module rather than of every caller.
 */
export function log(input: LogInput): boolean {
  if (input.error !== undefined && wasLogged(input.error)) return false;

  const described =
    input.error === undefined
      ? undefined
      : describeError(input.error, { stack: input.stack === true });

  const record: LogRecord = {
    ts: new Date().toISOString(),
    level: input.level ?? "error",
    event: input.event,
    env: process.env.NODE_ENV ?? "development",
    trace_id: input.traceId,
    ...(input.route === undefined ? {} : { route: input.route }),
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.household === undefined ? {} : { household: input.household }),
    ...(input.durationMs === undefined ? {} : { duration_ms: Math.round(input.durationMs) }),
    ...(described === undefined
      ? {}
      : {
          error_kind: described.kind,
          ...(described.code === undefined ? {} : { error_code: described.code }),
          error_message: described.message,
          ...(described.stack === undefined ? {} : { stack: described.stack }),
        }),
    ...(input.meta === undefined ? {} : { meta: redactMeta(input.meta) }),
  };

  if (input.error !== undefined) markLogged(input.error);

  try {
    sink(record);
  } catch {
    // A logger that throws converts a handled failure into an unhandled one. There is
    // nowhere left to report this, so it is dropped on purpose.
  }
  return true;
}

/** The route path, without the query string — a query can carry a token or an email. */
export function routeOf(request: Request): string | undefined {
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
}
