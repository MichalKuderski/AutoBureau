# ADR-011: `/v1` domain API conventions

**Status:** Accepted (2026-08-22; implemented) · **Date:** 2026-08-22

## Context

One domain endpoint exists — `GET /v1/households/current` — and doc 03 §2 catalogues about
thirteen more. Doc 03 §1 already froze a good deal of the transport: cursor pagination as
`?cursor=&limit=` with `limit` capped at 100, a `{data, next_cursor}` response, whitelisted
per-endpoint filters with no query language, RFC 9457 problem responses with stable `type`
URIs, UUIDv7 ids opaque to clients, RFC 3339 UTC timestamps, `X-Household-Id` scoping, and
`Idempotency-Key` honoured on POSTs with side effects, stored 24 h and replayed verbatim.

**This ADR does not reopen any of that.** What doc 03 left unsaid is everything an engineer
actually has to decide at the keyboard: what a cursor *is*, what order rows arrive in, what
an absent field in a `PATCH` body means, which status a mutation answers with, and what
counts as "the same request" for idempotency. Those get answered thirteen times, differently
and in a hurry, unless they are answered once.

## Decision

### D1 — The list envelope is `{data, next_cursor}` and nothing else

Fixed by doc 03 §1; `PageSchema` in `packages/contracts/src/http.ts` is its schema.

`has_more` is deliberately absent: it is derivable from `next_cursor !== null`, and two
sources for one fact eventually disagree. A total count is also absent — counting a filtered
household-scoped table costs a second query per page for a number no screen displays. A
future `meta` object may be added beside these two fields without breaking a client.

An empty collection is `{data: [], next_cursor: null}` — the same shape, not a 404 and not a
special case. A singleton `GET` returns the resource representation directly, unwrapped: a
one-element envelope would make every caller unwrap a collection it knows is not one.

### D2 — Cursors are opaque keysets, bound to the query that issued them

A cursor is base64url-encoded JSON holding the ordering values of the last row served (`k`)
and a fingerprint of the query (`f`).

Keyset, not offset: an offset re-counts rows that may have shifted, so a row written during
paging silently duplicates or skips one. A keyset resumes at a position in the sort and is
stable under insertion and deletion.

Opacity is a contract, not an implementation detail — a client that parses a cursor breaks
when the sort gains a column. It is **not signed or encrypted**, and that is deliberate: it
needs neither confidentiality nor integrity. The values inside are the caller's own rows'
sort keys, and a forged cursor cannot reach another household's data, because every query it
resumes still runs inside `withHousehold` where RLS decides what exists. The worst outcome
is a strange page of the caller's own collection.

The fingerprint is `payloadSha256Hex` over `cursorFingerprintInput(resource, filters, sort)`
— the same RFC 8785 canonicalization approval payloads use, so it is stable across runtimes
and independent of parameter order. A cursor replayed against different filters or a
different sort resumes at a keyset that means something else, producing a page wrong in no
way the caller can detect; binding the fingerprint turns that silent nonsense into a `400`.

Page size: `limit` is 1…100 (ceiling from doc 03 §1), default **25**. Out-of-range is
rejected, not clamped — clamping means a caller asking for 1000 receives 100 and cannot tell
whether the collection ended.

### D3 — Every list endpoint declares a total order ending in the primary key

Default: `created_at DESC, id DESC`. An endpoint may declare another (`due_at ASC` for
obligations is the obvious one) and **must** still end it with `id`.

Without a primary-key tiebreak, rows sharing a `created_at` order arbitrarily, the keyset
lands mid-tie, and paging drops or repeats rows — a bug that appears only when two rows are
written in the same millisecond, which is to say only in production. UUIDv7's leading bits
are a timestamp, so the tiebreak agrees with the sort rather than fighting it.

### D4 — Filters are whitelisted parameters; unknown ones are rejected

Doc 03 §1 fixed "explicit whitelisted params per endpoint — no generic query language". This
ADR adds the encoding:

- **Multi-value:** repeat the parameter (`?status=upcoming&status=done`). Not
  comma-separated, which would make a comma illegal inside every filter value forever, and
  search text legitimately contains one.
- **Ranges:** explicit `_before` / `_after` suffixes carrying RFC 3339 timestamps, matching
  doc 03's own `due_before`.
- **Booleans:** literally `true` or `false`.
- **Text search:** `q`.
- **Unknown parameters are a `400`**, not ignored. A silently dropped `?statuss=done` returns
  the whole collection and looks like a working filter.
- `cursor` and `limit` are reserved and never filters.

`listQuery()` in `apps/web/src/server/http/list.ts` enforces all of it. No query parameter
reaches SQL: filters arrive parsed by a Zod schema the endpoint owns.

### D5 — No client-controlled sorting in v1

The product has none — the shared `Table` sorts presentationally over data it already holds.
Each endpoint declares one canonical order (D3).

When an endpoint genuinely needs client sorting, `?sort=` takes a value from a **server-defined
enum of named orders**, never a column name, and the enum member maps to a declared total
order on the server. A sort parameter that reaches a column name is an injection sink.

### D6 — `PATCH` is RFC 7396 merge semantics, narrowed

- **Absent** field → unchanged. This is why `PATCH` exists here: a client holding a stale
  copy must not overwrite fields it never displayed, which is what a `PUT` of the full
  representation would do.
- **Explicit `null`** → clear, and only where the field is nullable. `null` on a
  non-nullable field is a validation error, not a silent no-op — otherwise the two are
  indistinguishable and "why did my update do nothing" is unactionable.
- **Unknown** field → `400` (doc 03 §4 already 400s on schema mismatch).
- **Read-only / immutable** field present → `400`, even when the value matches what is
  stored.
- **Empty body `{}`** → `200` with the current representation, no write, no audit row.
  Refusing it would make retry logic special-case a request that is already correct.

`nullableUpdate()` encodes the tri-state at the type level. Not RFC 6902 JSON Patch: its op
arrays buy array-index manipulation and test/assert semantics no AutoBureau resource needs,
at the cost of a body no client can build without a library.

### D7 — The v1 API contract standardises no optimistic-concurrency protocol

**This is a statement about the contract, not a claim about correctness.** The API defines
no `ETag`, no `If-Match`, no version field, and no conflict status for concurrent writes.
Nothing about that makes concurrent writes safe.

Concretely, and stated plainly so no future reader mistakes silence for a guarantee: if two
requests update the same resource at overlapping times, **the later write wins and the
earlier one is lost, with no error and no signal to either client**. D6 narrows the blast
radius — a merge patch only writes the fields it actually sent, so two clients editing
*different* fields of one resource do not clobber each other — but two clients editing the
*same* field is a lost update, and the API will report success to both.

The reason to ship that anyway is not that it is harmless; it is that the alternative is
worse right now. The models carry `updated_at` but no version counter, and **multi-user
logins are explicitly postponed** (`CLAUDE.md` scope defense), so a household has one
credentialed writer and the overlap window is a single person with two tabs. A partially
implemented `If-Match` — generated but unchecked, or enforced on two endpoints out of
thirteen — would be worse than none, because a client would code against a guarantee that
holds only sometimes.

**Revisit when** multi-user logins ship, or when any endpoint gains genuinely concurrent
editors — whichever comes first; the trigger is concurrent *writers*, not user count. The
mechanism at that point should be `If-Match` over a strong `ETag` derived from the row's
`updated_at`, answering `412` when the precondition fails, and it must land across the
mutation surface at once rather than endpoint by endpoint.

### D8 — Mutation status codes

| Operation | Status | Body |
|---|---|---|
| `POST` creating a resource | `201` | the created representation, plus `Location` |
| `POST` acting on a resource (`/complete`, `/dismiss`, `/review`) | `200` | the affected representation |
| `POST` starting async work | `202` | the handle that tracks it |
| `PATCH` | `200` | the full updated representation |
| `DELETE` | `204` | none |
| `DELETE` starting async work | `202` | the handle |

The `202` cases are already in doc 03 §2 (exports, task-runs, household and account
deletion); this generalises the rule rather than inventing it. `RouteResponse` and its
`created()` / `accepted()` / `noContent()` helpers let a handler say so — previously every
handler returned `200`.

### D9 — `DELETE` is idempotent

Deleting an absent resource returns `204`, not `404`: the postcondition holds either way, and
a client retrying a delete it already completed has not made an error.

This is also the more private answer. For a household-scoped resource, "not yours" and
"doesn't exist" both return `204`, revealing nothing — consistent with D10.

Soft versus hard deletion is domain behaviour, not transport, and each resource decides it.

### D10 — Not-found and not-yours are indistinguishable

Already the shipped posture: `problemResponse`'s own header records that the boundary "never
distinguishes 'that household is not yours' from 'no such household'", and
`resolveRequestContext` returns `not-a-member` for both.

Extended to domain resources: a resource belonging to another household returns exactly what
a nonexistent id returns. Because reads run inside `withHousehold`, RLS makes this the
*natural* outcome — a foreign row is simply not there — so an endpoint gets it right by doing
nothing special. Future endpoints must not add an existence check that would undo it.

### D11 — Validation errors are field-addressable

`400` with `type: …/problems/validation` and `errors: [{path, message}]`, which
`FieldErrorSchema` already defines.

`path` is the schema path joined the way a client addresses it — `contacts[0].email`, not
`["contacts", 0, "email"]` — so a UI binds an error to an input without parsing prose. A
root-level failure reports `""`, which clients render as a form-level message. Malformed JSON
and a missing required body both produce the same shape.

Zod's messages are safe to surface because they describe the *schema*, never the data.
Nothing echoes a submitted value back — in this product that is how a passport number reaches
a log.

### D12 — Error mapping

| Situation | Status | `type` |
|---|---|---|
| No/invalid session | 401 | `unauthorized` |
| Authenticated, not permitted; foreign or nonexistent resource | 403 / 404 per D10 | `forbidden` / `not-found` |
| Schema or filter failure, bad cursor, bad `limit` | 400 | `validation` |
| Idempotency key reused with a different body | 409 | `conflict` |
| Plan limit reached | 402 | `cap-exceeded` |
| Rate limited | 429 | `rate-limited` |
| Dependency down / not configured | 503 | `unavailable` |
| Anything unexpected | 500 | `internal` |

The `PROBLEM_KINDS` registry is the whole vocabulary; adding a kind is a contract change.
Clients match `type`, never `title` or `detail`, which are prose and may be reworded.
`detail` is coarse by design and never carries a database error, provider body, SQL, stack, or
identifier. Every response already carries the correlation id (`withTraceHeader`) and
`cache-control: no-store`.

### D13 — The idempotency contract (P1-05 implements it)

- **Honored on `POST`; ignored, never rejected, everywhere else.** This is the one place
  two facts had to be reconciled. Doc 03 §1 honors the header "on all POSTs with side
  effects", but `apiFetch` attaches a generated key to every unsafe method except `DELETE`
  — so `POST`, `PATCH` and `PUT` all arrive carrying one today, from our own client.

  `POST` is therefore where a stored response is looked up and replayed. On every other
  method the key is **ignored**, and *ignored* is load-bearing: a server that rejected an
  unexpected key would fail every `PATCH` the product makes. Ignoring is safe because
  those methods are already idempotent here — a merge patch reapplied is a no-op (D6),
  and deleting an absent resource answers `204` (D9) — so replay protection adds nothing
  they do not already have. A future endpoint may honor a key on `PATCH`/`PUT` as a local
  decision; it may not refuse one.

  `idempotencyDisposition(method)` returns exactly this, so P1-05 branches on one
  function rather than re-deriving the rule.
- **"With side effects" is not a second test P1-05 has to apply.** Under `/v1` the two
  phrasings select the same endpoints. Every POST in doc 03 §2 mutates: creates
  (`/v1/households`, `/v1/households/{id}/members`, `/v1/items`, `/v1/obligations`,
  `/v1/documents/uploads`), state transitions (`/complete`, `/dismiss`, `/snooze`,
  `/cancel`, `/review`, `/reprocess`), approvals, invites, alias provisioning, exports,
  push registrations, and the `/v1/notifications/read` batch. The endpoint that is a
  read-only POST in most APIs is a `GET` here — `GET /v1/search?q=` — and doc 03 §1 rules
  out a generic query language, so there is no POST-shaped read to disagree about.
  **P1-05 branches on the method alone**, which is why `idempotencyDisposition()` takes no
  path.

  A future read-only POST is a contract violation, not a case to handle: it must be a
  `GET`. If one ever becomes genuinely unavoidable, amend this ADR *before* it ships — the
  default would otherwise honor it, and honoring a key on a read replays a response that
  may be up to 24 hours stale.
- **Two POST surfaces are not ordinary `/v1` POSTs** and the rule does not reach them.
  `/v1/auth/*` is the documented exception (D14): no envelope, no `authenticated()`
  wrapper, and no key from `apiFetch`. `/v1/webhooks/*` (Cloudflare email, Resend, Stripe)
  are inbound from third parties that never send an `Idempotency-Key` at all — their
  replay protection is the provider's own event id plus the HMAC check in doc 05 §2, a
  different mechanism with a different lifetime.
- **Key:** client-supplied, 1…255 characters, opaque. `apiFetch` already generates one for
  every non-`GET`/`DELETE` request, and is **left unchanged** by this ADR: a key the
  server ignores costs one header, whereas narrowing the client to `POST` would be a
  behaviour change made only to simplify a document.
- **Scope + fingerprint:** `payloadSha256Hex` over `{household_id, user_id, method, path,
  body}`. Household and principal scoping mean one household's key can never collide with
  another's.
- **Same key, same fingerprint** → replay the stored response verbatim (doc 03 §1).
- **Same key, different fingerprint** → `409 conflict`. Answering with the first response
  would hide a client bug behind a success.
- **Retention:** 24 h (doc 03 §1).
- **In flight** → `409`; the mechanism is P1-05's to choose.

`idempotencyDisposition()` and `idempotencyFingerprintInput()` are in contracts. **No
storage, no table, and no deduplication is implemented here** — that is P1-05, which needs
from this ADR only: which methods to branch on, the key's bounds, the fingerprint input,
the `409` rule, the 24-hour retention, and that a stray key is ignored rather than refused.
All six are above.

### D14 — `/v1/auth/*` is a documented exception

The auth routes answer `204` with no body and no envelope, and are not wrapped in
`authenticated()`. They are protocol endpoints that *establish* the session the conventions
above presuppose; an endpoint that required a session in order to create one could never be
reached. They are exempt from D1, D8 and D13, and remain bound by the problem-response and
`no-store` rules.

This is consistency where it is useful, not uniformity for its own sake.

## Consequences

- ✅ A future endpoint answers "route, method, request schema, envelope, pagination, filters,
  sorting, errors, validation, status, idempotency, concurrency" by reading this document,
  not by deciding again.
- ✅ Cursor safety and filter/sort safety are structural: no query parameter can reach SQL,
  and no cursor can widen tenant scope, because RLS is downstream of both.
- ⚠️ `limit` and unknown-parameter strictness will reject requests a lenient API would have
  accepted. That is the intent; it surfaces client bugs at the first call rather than in a
  support thread.
- ⚠️ D7 accepts lost updates under genuine concurrency. Bounded by D6 (only sent fields are
  written) and by multi-user logins being postponed.
- ❌ Rejected: a generic filter DSL (doc 03 §1 already refused one, and it is an injection
  surface and an optimizer's nightmare); JSON Patch (D6); offset pagination (D2); a
  `{data, meta, errors}` wrapper on singleton reads (D1) — it makes every caller unwrap a
  collection that is not one.

## What this ADR deliberately does not decide

Per-resource schemas and their filter whitelists; soft-versus-hard deletion per resource;
the storage mechanism for idempotency (P1-05); rate-limit buckets (doc 12 §7); and the
fixture→API cutover itself (P1-18). Those are endpoint-level or later-task decisions that
this document is meant to make *cheap*, not to pre-empt.
