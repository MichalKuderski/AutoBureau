# ADR-010: A per-request CSP nonce, and the removal of `script-src 'unsafe-inline'`

**Status:** Accepted (2026-08-21; implemented) · **Date:** 2026-08-21

## Context

Doc 12 §4 has always specified "CSP (nonce-based, no `unsafe-inline`)", and a comment at
`apps/web/next.config.ts:5` asserted the same thing. Neither was true. The header captured
from a live production build read:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; …
```

The string `nonce` appeared nowhere in the codebase. `'unsafe-inline'` in `script-src`
disables the one thing CSP is principally for: it makes any successful injection of script
content — through a document title, an extracted field, a vendor name, an AI-derived value —
executable with full page privileges. Session cookies being `HttpOnly` limits token theft but
not action: same-origin script can read the whole household registry through `/v1` and
reproduce `apiFetch`'s CSRF header at will. This product's core loop is built to ingest
adversarial input (`FOUNDING_PRINCIPLES`: documents are untrusted input), which is exactly when
this control has to be real.

The worse cost was epistemic. A control that is documented, cited as satisfied, and absent is
more dangerous than a known gap, because nobody compensates for it.

The security audit (`docs/hardening/05-security-reliability-audit.md` P0-2) attributed
`'unsafe-inline'` to a single inline script — the theme bootstrap in `app/layout.tsx`, which
sets `data-theme` before first paint so a dark-preference user never sees a light flash. **That
attribution was wrong, and it mattered.** A production response for `/` carries the theme
script *and ~18 `self.__next_f.push(...)` blocks* — the App Router's own mechanism for
streaming the RSC payload. Deleting our inline script, or moving it to a file under `'self'`,
would not have permitted dropping `'unsafe-inline'`; the framework's scripts still needed it.
Any fix had to cover scripts nobody in this repository wrote.

## Decision

1. **The policy is built per request and applied by the middleware** — `src/server/http/csp.ts`,
   applied in `src/middleware.ts`. It cannot live in `next.config.ts`: that config's `headers()`
   is evaluated once at build time, and a nonce identical on every response is not a nonce.
2. **The nonce is 16 bytes from `crypto.getRandomValues`, base64-encoded, minted per request.**
   Nothing about the request feeds into it — not a timestamp, request id, user id, or household
   id. A derived nonce is a predictable nonce, worth no more than `'unsafe-inline'` while
   looking considerably more responsible.
3. **The middleware sets the policy on both the request and the response.** The response header
   is what the browser enforces. The *request* header is how Next learns the nonce: `app-render`
   reads incoming `content-security-policy`, extracts the first `'nonce-…'` source from
   `script-src` (`get-script-nonce-from-header.js`), and stamps it onto every script it emits.
   This is the framework's own supported mechanism, not a workaround around it.
4. **The root layout reads `x-nonce` and stamps the theme script.** Both headers are set from
   one value on one code path, so the script the browser receives and the policy it enforces
   cannot drift apart.
5. **`script-src` no longer contains `'unsafe-inline'`, in production or development.**
   `'unsafe-eval'` remains in development only, for React Refresh — the one relaxation, and the
   reason the policy is built per environment rather than frozen.
6. **`style-src 'unsafe-inline'` stays**, and is now stated plainly instead of being described
   as something stricter. Tailwind and React both write inline styles; the exposure is far
   smaller than the script equivalent and removing it is not this decision.
7. **The constant headers stay in `next.config.ts`** (`nosniff`, HSTS, `Referrer-Policy`,
   `X-Frame-Options`, `Permissions-Policy`). They are constants and belong on every response,
   including the static assets the middleware matcher skips. CSP is different in kind: it
   governs a document's execution context, so it only does work on responses that become
   documents — precisely the set the matcher already covers.

## Consequences

- ✅ An injected `<script>` no longer executes. The attacker must now also guess 128 bits of
  per-response randomness. Verified end-to-end on a production build: every inline script in the
  served HTML (15/15 on `/`, 7/7 on `/sign-in`) carries the exact nonce named in that response's
  header, and the header no longer contains `'unsafe-inline'`.
- ⚠️ **Every page is now server-rendered on demand.** Eight routes used to prerender (`/`,
  `/sign-up`, `/forgot-password`, `/onboarding/*`, `/_not-found`); none do now. This is required,
  not incidental: a page rendered at build time carries scripts stamped with no nonce, while the
  response beside it carries a fresh one, and the browser blocks the entire page. Reading a
  request header in the root layout is what guarantees this app-wide. The cost is a marketing
  page that no longer serves from cache — acceptable pre-G1, and separable later by moving that
  surface out of the app rather than by weakening the policy.
- ⚠️ The theme script carries `suppressHydrationWarning`. Browsers blank the `nonce` *content
  attribute* after parsing — a CSP anti-exfiltration rule, so `script[nonce=…]` cannot read it
  back — while keeping the IDL property, so hydration compares the server's value against an
  empty string and reports a mismatch on every page. The script has already executed; there is
  nothing to patch up.
- ⚠️ Responses excluded by the middleware matcher (`_next/static`, `_next/image`, `favicon.ico`,
  `manifest.webmanifest`, `robots.txt`) no longer carry CSP. None of them become a document, so
  none of them execute anything the policy would have governed; the headers that *do* matter for
  an asset response are unchanged.
- ❌ Rejected: **hashes instead of a nonce** — the framework's streamed payload scripts differ per
  render, so a build-time hash set cannot cover them. ❌ Rejected: **moving the theme bootstrap
  to a file under `'self'`** — it addresses one of nineteen inline scripts and leaves
  `'unsafe-inline'` in place, buying nothing. ❌ Rejected: **`'unsafe-inline'` alongside a nonce
  as a "compatibility" fallback** — browsers that understand nonces ignore `'unsafe-inline'`
  when one is present, so it protects nothing and misrepresents the policy to anyone reading it.
  ❌ Rejected: **keeping `'unsafe-inline'` in development** — the same reason, plus it would hide
  violations until production.

## Revisiting

`style-src 'unsafe-inline'` and the Trusted Types half of doc 12 §4 remain unimplemented and are
not covered by this decision. Either is a separate ADR. Removing `style-src 'unsafe-inline'`
requires a Tailwind build that emits no inline style attributes and a React version that does not
set them directly — verify both against a live response before claiming it, which is the failure
this ADR exists to correct.
