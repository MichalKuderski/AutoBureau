/**
 * The redaction boundary (doc 10 §3).
 *
 * Doc 10 requires "a shared redaction middleware ... strips emails, names, document text,
 * and any `item_secrets`-shaped values before emission; log-scrubber unit tests are part of
 * the platform module". This is that module, and its tests are `redact.test.ts`.
 *
 * THE DESIGN GOAL IS NOT "REDACT WHAT WE REMEMBER TO REDACT"
 * ---------------------------------------------------------
 * It is that a future developer who logs an object without knowing what is inside it
 * cannot leak a secret. Callers are not trusted to sanitise, because the whole class of
 * bug this exists to prevent is a caller who did not realise there was anything to
 * sanitise. Everything that reaches a log record passes through `redactValue` first.
 *
 * Three independent mechanisms, because any one of them alone has a blind spot:
 *
 *   1. KEY NAME. `accessToken`, `access_token`, `ACCESS-TOKEN` and `Access Token` all
 *      normalise to the same string, so a rename cannot smuggle a value past the filter.
 *   2. VALUE SHAPE. A secret does not stop being a secret because it was stored under an
 *      innocent key, or interpolated into an error message. JWTs, bearer headers,
 *      connection strings and email addresses are recognised wherever they appear.
 *   3. TYPE REFUSAL. Some things are never safe to serialise regardless of content — a
 *      `Request`, a `Response`, a `Headers` bag, a binary buffer (which is the shape
 *      `item_secrets.ciphertext` arrives in). Those are replaced with a type marker.
 *
 * Caps on depth, breadth and length are the fourth mechanism, and they are the reason an
 * accidental `logger.error({ meta: { prismaClient } })` produces a small useless record
 * rather than a large dangerous one.
 */

export const REDACTED = "[redacted]";

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 512;

/**
 * Key fragments that mark a value as unloggable.
 *
 * Matched as substrings of the *normalised* key (lowercased, non-alphanumerics stripped),
 * so one entry covers every casing and separator convention at once. Deliberately
 * conservative about short fragments: `auth` would match `author`, so the full
 * `authorization` is listed instead, and bare `key` is excluded in favour of the specific
 * compounds — a filter that fires on everything gets disabled by the next person.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  "authorization",
  "authorisation",
  "cookie",
  "token",
  "csrf",
  "pkce",
  "verifier",
  "challenge",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "anonkey",
  "privatekey",
  "signingkey",
  "credential",
  "signature",
  "ciphertext",
  "jwt",
  "bearer",
  "sessionid",
  "connectionstring",
  "databaseurl",
  "email",
] as const;

/** Prototype-polluting keys are dropped rather than redacted — they are never data. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/**
 * Value-shape scrubbers, applied in order.
 *
 * Order is load-bearing in one place: connection strings are scrubbed before email
 * addresses, because `postgres://user:pass@host/db` contains something an email regex will
 * happily match, and redacting only the `user:pass@host` fragment would leave the rest of
 * the URL — including the host — in the log.
 */
const SCRUBBERS: ReadonlyArray<readonly [RegExp, string]> = [
  // A JWT, which is what every access and refresh token in this system looks like.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, REDACTED],
  // A three-segment opaque token that is not obviously a JWT. Segment length is set high
  // enough that ordinary dotted identifiers and version strings are not eaten.
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  // Known credential prefixes. Cheap, and the ones this product has already committed to
  // meeting (Stripe post-launch per doc 13 §7; Plaid only behind ADR-011).
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]+/g, REDACTED],
  [/\baccess-(?:sandbox|development|production)-[A-Za-z0-9-]+/g, REDACTED],
  // `name=value` where the name itself says the value is a secret.
  [
    /\b([A-Za-z0-9_-]*(?:authorization|cookie|token|secret|password|apikey|csrf|verifier|challenge|signature)[A-Za-z0-9_-]*)\s*=\s*([^\s;,&"']+)/gi,
    `$1=${REDACTED}`,
  ],
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/\S+/gi, REDACTED],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
];

/**
 * Scrub a free string.
 *
 * Applied to every string that reaches a record, including error messages — a Prisma
 * unique-violation message quotes the conflicting value, which for `users.email` is a real
 * address, and that message would otherwise be logged verbatim.
 */
export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SCRUBBERS) {
    out = out.replace(pattern, replacement);
  }
  return out.length > MAX_STRING_LENGTH ? `${out.slice(0, MAX_STRING_LENGTH)}…[truncated]` : out;
}

/** Types that are never safe or never useful to serialise, whatever they contain. */
function typeMarker(value: object): string | null {
  if (value instanceof Error) return null; // handled by the caller, not refused
  if (typeof Request !== "undefined" && value instanceof Request) return "[Request]";
  if (typeof Response !== "undefined" && value instanceof Response) return "[Response]";
  if (typeof Headers !== "undefined" && value instanceof Headers) return "[Headers]";
  if (typeof FormData !== "undefined" && value instanceof FormData) return "[FormData]";
  if (typeof Blob !== "undefined" && value instanceof Blob) return "[Blob]";
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return "[ReadableStream]";
  }
  // Binary is the shape `item_secrets.ciphertext` and every key material arrives in.
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength}B]`;
  if (value instanceof Map) return `[Map(${value.size})]`;
  if (value instanceof Set) return `[Set(${value.size})]`;
  if (value instanceof Promise) return "[Promise]";
  return null;
}

/**
 * Sanitise an arbitrary value for emission.
 *
 * Total function: it never throws, because a logger that can fail turns a handled error
 * into an unhandled one. Anything it cannot understand becomes a marker string.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;

  switch (typeof value) {
    case "string":
      return scrubString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return `${value.toString()}n`;
    case "function":
      return "[function]";
    case "symbol":
      return "[symbol]";
    default:
      break;
  }

  if (depth >= MAX_DEPTH) return "[truncated]";

  const marker = typeMarker(value as object);
  if (marker !== null) return marker;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[invalid Date]" : value.toISOString();
  }

  if (value instanceof URL) {
    // A URL can carry credentials in its userinfo; rebuild it without them.
    const safe = new URL(value.toString());
    safe.username = "";
    safe.password = "";
    safe.search = safe.search === "" ? "" : "?[redacted]";
    return scrubString(safe.toString());
  }

  // An Error nested inside metadata is reduced rather than walked: its own `stack` belongs
  // to the record's top-level error field, not to a nested bag.
  if (value instanceof Error) {
    return `${safeIdentifier(value.name, "Error")}: ${scrubString(value.message)}`;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    return items;
  }

  const out: Record<string, unknown> = {};
  let seen = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (seen >= MAX_OBJECT_KEYS) {
      out["…"] = "[truncated]";
      break;
    }
    seen += 1;
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1);
  }
  return out;
}

/** Redact a metadata bag. Always an object, so a record's `meta` field has one shape. */
export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(meta, 0);
  return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

/** Constructor names and error codes reach the log as identifiers, never as free text. */
function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return /^[A-Za-z0-9_$.-]{1,64}$/.test(value) ? value : fallback;
}

export interface DescribedError {
  readonly kind: string;
  readonly code?: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Reduce a thrown value to the four fields worth recording.
 *
 * Deliberately *not* a serialisation of the error object. A `PrismaClientKnownRequestError`
 * carries a `meta` bag holding the values that violated a constraint; a `ProviderError`
 * sits next to a provider response. Extracting named fields and scrubbing each is the only
 * way to log the useful part without carrying the rest along.
 *
 * `code` is the single most useful field for triage — it is `P2002` on a unique violation,
 * `ECONNREFUSED` on a dead socket, and the `reason` enum on this codebase's own error
 * types — and every one of those is an identifier with no data in it.
 */
export function describeError(cause: unknown, options: { stack?: boolean } = {}): DescribedError {
  if (!(cause instanceof Error)) {
    return { kind: "NonError", message: scrubString(String(cause)) };
  }

  const record = cause as unknown as Record<string, unknown>;
  const code = safeIdentifier(record["code"], "") || safeIdentifier(record["reason"], "");

  const stack =
    options.stack === true && typeof cause.stack === "string"
      ? scrubString(cause.stack.split("\n").slice(0, 12).join("\n"))
      : undefined;

  return {
    kind: safeIdentifier(cause.name, "Error"),
    ...(code === "" ? {} : { code }),
    message: scrubString(cause.message),
    ...(stack === undefined ? {} : { stack }),
  };
}
