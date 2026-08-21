/**
 * The Content-Security-Policy, and the per-request nonce that makes it real.
 *
 * This policy used to live in `next.config.ts`. It cannot stay there: `headers()` in the
 * Next config is evaluated once, at build time, to produce a static rule list, and a
 * nonce that is the same on every response is not a nonce — it is a password the
 * attacker can read off the last page they were served. A per-request value has to come
 * from a per-request boundary, which in this application is the middleware.
 *
 * The other security headers stay in `next.config.ts` on purpose. They are constants, and
 * belong on *every* response including the static assets the middleware matcher
 * deliberately skips. CSP is different: it governs a document's execution context, so it
 * only ever does work on a response that becomes a document — exactly the set the
 * matcher already covers.
 *
 * ### Why the nonce reaches scripts nobody here wrote
 *
 * The security audit recorded the theme bootstrap in `app/layout.tsx` as the *only*
 * inline script, and therefore the only reason for `'unsafe-inline'`. That is not what a
 * production response contains: a rendered page carries the theme script plus ~18
 * `self.__next_f.push(...)` blocks, which are how the App Router streams its RSC payload
 * to the client. Removing our own inline script would not have let `'unsafe-inline'` go;
 * every one of those framework scripts needs to be allowed too.
 *
 * Next handles them itself, but only if it is told the policy through the *request*:
 * `app-render` reads the incoming `content-security-policy` header, extracts the first
 * `'nonce-…'` source from `script-src`, and stamps it onto every script it emits
 * (`get-script-nonce-from-header.js`, consumed by `getRequiredScripts` and
 * `createInlinedDataReadableStream`). So the middleware sets the policy twice, for two
 * different readers: on the request so the framework can nonce its own output, and on
 * the response so the browser enforces it.
 */

/** How many random bytes back each nonce. 128 bits — unguessable within a response. */
const NONCE_BYTES = 16;

/**
 * A fresh, cryptographically random nonce.
 *
 * Base64 of 16 random bytes, which matches the `'nonce-…'` grammar Next's own extractor
 * accepts (`/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/`). Nothing about the request feeds into
 * it: deriving a nonce from a timestamp, a request id, or any user/household identifier
 * would make it predictable, and a predictable nonce is worth no more than
 * `'unsafe-inline'` while looking considerably more responsible.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface CspOptions {
  /** The nonce for this one response. Never reused across responses. */
  readonly nonce: string;
  /**
   * Development only: React Refresh compiles modules with `eval`. This is the single
   * documented relaxation, and it is why the policy is built per-environment rather than
   * being one frozen string.
   */
  readonly allowEval?: boolean;
}

/**
 * The policy for one response.
 *
 * `style-src 'unsafe-inline'` stays. Tailwind and React both write inline styles, and
 * unlike script that is a small, well-understood exposure — it is stated here honestly
 * rather than described as something stricter than it is.
 */
export function buildCsp({ nonce, allowEval = false }: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, ...(allowEval ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * The request header the root layout reads to stamp the theme script.
 *
 * Distinct from the `content-security-policy` request header that Next reads for its own
 * scripts — both are set from the same value on the same code path, so the script the
 * layout renders and the policy the browser enforces cannot drift apart.
 */
export const NONCE_HEADER = "x-nonce";
