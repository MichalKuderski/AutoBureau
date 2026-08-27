import { installErrorReporting } from "./sentry";

/**
 * Server observability (blueprint P0-01, P1-19).
 *
 * The one import path for logging. Everything a handler needs — a correlation id, the
 * emitter, the response header — is here; the redaction internals are not re-exported,
 * because a caller that reaches for `scrubString` directly is usually about to build a
 * second, worse logging path. `defaultSink` is not re-exported either: it is exported from
 * `logger.ts` for `sentry.ts` to compose with, not for handlers to reach for.
 *
 * Registering the production sink here, rather than in an `instrumentation.ts`, is what
 * makes it reach every caller — every module that logs already imports this one — without
 * adopting Next's auto-instrumentation entrypoint, which ADR-014 D2 rejects because it
 * captures request data before this codebase's redaction boundary runs.
 *
 * Without `SENTRY_DSN` this is a no-op and the sink stays exactly as P0-01 left it, so a
 * local run and a CI run behave identically to before P1-19 (ADR-014 D6).
 */
installErrorReporting();

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
