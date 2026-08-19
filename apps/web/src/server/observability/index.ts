/**
 * Server observability (blueprint P0-01).
 *
 * The one import path for logging. Everything a handler needs — a correlation id, the
 * emitter, the response header — is here; the redaction internals are not re-exported,
 * because a caller that reaches for `scrubString` directly is usually about to build a
 * second, worse logging path.
 */
export {
  log,
  householdRef,
  routeOf,
  traceIdFrom,
  withTraceHeader,
  wasLogged,
  setLogSink,
  resetLogSink,
  type LogRecord,
  type LogInput,
  type LogSink,
  type Severity,
} from "./logger";
