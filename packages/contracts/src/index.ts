/**
 * Browser-safe entry point.
 *
 * Everything exported here runs in any runtime — schemas, the event registry, error
 * shapes, and isomorphic ID generation. Node-only utilities (payload hashing, which
 * needs a synchronous SHA-256) live behind the `./node` subpath so that importing a
 * schema in a React component cannot drag server code into the client bundle.
 * Discovered while wiring the web app: a single entry point made `node:crypto` a
 * transitive dependency of every screen.
 */
export { uuidv7, UUID_RE } from "./ids.js";
export {
  PROBLEM_BASE, PROBLEM_KINDS, problem,
  ProblemDetailsSchema, FieldErrorSchema,
  type ProblemDetails, type ProblemKind, type FieldError,
} from "./problem.js";
export {
  EVENT_TYPES, EventTypeSchema, EventEnvelopeSchema, EventPayloadSchema,
  type EventType, type EventEnvelope,
} from "./events.js";
export * from "./domain/common.js";
export * from "./domain/entities.js";
