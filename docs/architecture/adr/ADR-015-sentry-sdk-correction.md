# ADR-015 — The Sentry integration is built on `@sentry/core`, not `@sentry/node`

**Status:** Proposed
**Date:** 2026-08-27
**Amends ADR-014** (`ADR-014-production-error-reporting.md`, Accepted at `5150b0c`) — **the SDK and
configuration mechanism only.** ADR-014 remains the governing decision on production error
reporting. Its destination (D1), capture model (D2's rationale), scope (D3), configuration source
(D5), environment behaviour (D6), delivery contract (D7), and its relationships to ADR-013, P1-17
and P1-08 (D8, D9) are carried forward unchanged. **ADR-014 D2's closing instruction** — confirm the
configuration surface against the installed SDK, and treat any divergence as a finding rather than
an adjustment — is why this document exists instead of a quiet substitution during implementation.
**Does not amend ADR-013, ADR-012, ADR-011.** No sign-off condition, storage decision, or API
convention is touched.
**Amends no frozen architecture document.** Doc 10 §1 names Sentry; doc 13 §7 already lists Sentry
in the launch subprocessor set. Which npm package the server uses to reach Sentry is below the
altitude of both.

## Context

ADR-014 D2 selected `@sentry/node` and D11 excluded OpenTelemetry, and it flagged the risk in its
own text:

> The characterisation of what `@sentry/nextjs` captures by default, and the existence of specific
> configuration switches such as `sendDefaultPii`, are **assumptions about vendor behaviour that
> this repository cannot verify** — no SDK is installed and no deployment has run. […] P1-19 must
> confirm the actual configuration surface against the installed SDK, and treat any divergence as a
> finding rather than an adjustment.

P1-19 performed that confirmation before writing any code. The divergence it found is larger than
the one D2 anticipated, and it is not in the configuration surface: **`@sentry/node` is an
OpenTelemetry distribution.** Two of ADR-014's own statements cannot both hold while it is the
selected package.

This ADR settles the package question so it cannot be reopened during implementation.

### What was actually measured

Every row below was produced by installing the published packages into a throwaway directory on
2026-08-27 and exercising them against a local HTTP collector. Nothing here is recalled from
documentation. The repository was not modified; the probe directory was deleted afterwards.

**`@sentry/node@10.71.0` — the package ADR-014 D10 names**

| Observation | Value |
|---|---|
| Packages installed by `npm install @sentry/node@10.71.0` | **33** |
| Packages actually loaded into the process by `require("@sentry/node")`, before `init()` | **19** |
| `@opentelemetry/*` among them | **8** — `api`, `api-logs`, `core`, `instrumentation`, `resources`, `sdk-trace`, `sdk-trace-base`, `semantic-conventions` |
| Module-interception libraries among them | **2** — `import-in-the-middle`, `require-in-the-middle` |
| On-disk size | 60 MB, of which `@opentelemetry` is 22 MB |
| Does `init()` avoid the OTel setup? | **No.** `sdk/index.js` `_init()` calls `initOpenTelemetry(client, …)` unless `skipOpenTelemetrySetup: true` — an option ADR-014 never names. `initWithoutDefaultIntegrations()` does **not** avoid it |
| Auto-attached event fields | `server_name` (the machine hostname — observed as `"vm"`), `contexts.runtime`, `sdk` |
| Older majors | v9 is worse (auto-instruments `pg`, `http`, `fs`, `koa`, `hapi`, `knex`, Prisma); v8 shares the architecture; v7 predates OTel but is end-of-life |
| Leaner subpath export | **None.** `./import`, `./loader`, `./init`, `./preload` are all *more* instrumented than the main entry |

**`@sentry/core@10.71.0` — the alternative**

| Observation | Value |
|---|---|
| Packages installed | **2**: `@sentry/core@10.71.0` (MIT, `engines.node >= 18`) and its single dependency `@sentry/conventions@0.16.0` (MIT, **zero** dependencies) |
| Packages loaded by `require("@sentry/core")` | the same 2 — 233 files |
| `@opentelemetry/*` in the resolved closure | **none** |
| Module-interception libraries in the closure | **none** |
| `node:` builtins required anywhere in the loaded graph | **none** |
| Bundler metadata | `sideEffects: false`; ships its own types at `build/types/index.d.ts` (no `@types/*` needed) |
| Exports needed, all from the main entry | `ServerRuntimeClient`, `createTransport`, `createStackParser`, `nodeStackLineParser` |

**`@sentry/core` behaviour, exercised end to end**

| Test | Result |
|---|---|
| Envelope delivery to a local collector | **Succeeded.** Payload contained exactly the fields supplied plus the four listed below |
| Auto-added event fields | `event_id`, `timestamp`, `environment`, `contexts.trace{trace_id, span_id}` — **and nothing else** |
| Envelope header additions | `event_id`, `sent_at`, and a dynamic-sampling `trace` block (`environment`, `public_key`, `trace_id`, `org_id`) |
| `server_name` | **absent.** `server-runtime-client.js:163` attaches it *only* when `options.serverName` is set. `contexts.runtime` is the same shape at `:157`, gated on `options.runtime` |
| Ingest URL construction | Done **by the client** (`client.js:105-113`), which passes `{ url, … }` into the transport factory. Application code never parses the DSN |
| Transport throws synchronously | `captureEvent` returned an event id and **did not throw**; `flush` resolved `true` and did not reject |
| Transport promise rejects | `flush(1000)` → **`true`**, no rejection |
| Transport returns HTTP 500 | `flush(1000)` → **`true`** |
| Transport slower than the bound (5 s vs `flush(200)`) | → `false` at **201 ms** |
| Never-settling transport, event loop kept alive | `flush(300)` → `false` at **301 ms** |
| Never-settling transport, event loop otherwise idle | **`flush(300)` never settled.** Node reported an unsettled top-level await |
| No DSN configured | `getDsn()` → `undefined`, `getTransport()` → `undefined`, `captureEvent` still returns an id, `flush` → `true` immediately |
| An application-owned `Promise.race` against a ref'd `setTimeout` | Returned at its deadline (150 ms), reliably |

**Why the idle-loop case behaves that way, read from source.** `Client.flush(timeout)` awaits
`_isClientDoneProcessing(timeout)` and *then* `transport.flush(timeout)` — two sequential awaits
each bounded by the same argument (`client.js:245-254`), so the theoretical ceiling is ≈2× the
value passed. The transport half resolves through `promisebuffer.drain(timeout)`, which races the
drain against `safeUnref(setTimeout(() => resolve(false), timeout))` (`promisebuffer.js:35`), and
`safeUnref` calls `timer.unref()` (`timer.js:3`). **An `unref`'d timer does not keep the Node event
loop alive**, so the deadline fires only if something else is holding the process open. That is a
source-level reading confirmed by both measurements above — the bound holds with a live loop and
vanishes without one.

### Repository facts this decision rests on

| Fact | Location |
|---|---|
| The record is built, redacted, **then** handed to the sink | `logger.ts:169-198` |
| `sink(record)` is already inside `try { … } catch {}` | `logger.ts:193-198` |
| `defaultSink` is a module-private `const`, exported from neither `logger.ts` nor `index.ts` | `logger.ts:77` |
| `setLogSink(next)` **replaces** the sink rather than adding to it | `logger.ts:95-100` |
| `log()` is synchronous and returns `boolean` | `logger.ts:161` |
| The observability module is already Node-runtime-only — `logger.ts` imports `node:crypto` | `logger.ts:1` |
| `middleware.ts` does **not** import the observability module, so nothing drags the sink onto the Edge runtime | verified by import inspection |
| Next.js **15.5.22** is installed and `next/server` exports **`after`** (stable, not `unstable_after`) | `apps/web/node_modules/next` |
| `after(task)` **throws** (`E468`) when called outside a request scope | `next/dist/server/after/after.js:12-20` |
| A **function** passed to `after()` is queued and run by `runCallbacksOnClose()`, which awaits `onClose` first — this is what makes "after the response is sent" verified rather than assumed | `next/dist/server/after/after-context.js:33-49, 88-90` |
| A **promise** passed to `after()` takes a different branch: it needs a host-supplied `waitUntil` and **throws `E91`** without one | `next/dist/server/after/after-context.js:35-37, 130-136` |

## Decision

### D1 — The direct dependency is `@sentry/core`, and `@sentry/node` is rejected

**`@sentry/core@10.71.0`.** One direct dependency in `apps/web`.

`@sentry/node` is rejected for five reasons, none of which is package size. Size is a symptom; the
reasons are behavioural:

1. **It installs and loads an OpenTelemetry runtime distribution.** Eight `@opentelemetry/*`
   packages enter the process on `require`, before any configuration runs. ADR-014 D11 excludes
   OpenTelemetry by name. A package cannot be adopted under a decision that excludes what the
   package *is*.
2. **It cannot be configured out of that.** `init()` calls `initOpenTelemetry` unconditionally
   absent `skipOpenTelemetrySetup: true`, and `initWithoutDefaultIntegrations()` does not help.
   Avoiding it means avoiding `init()` — at which point the framework layer `@sentry/node` exists
   to provide is being deliberately bypassed, and only its transport is wanted. That is
   `@sentry/core`.
3. **It carries module-interception machinery.** `import-in-the-middle` and `require-in-the-middle`
   exist to patch module loading. Whether or not hooks are registered in a given configuration,
   their presence in the dependency closure of a codebase whose current hardening programme is
   about narrowing attack surface is a cost taken for no benefit here.
4. **It enriches events with data the application did not put there.** `server_name` (the machine
   hostname) and `contexts.runtime` were attached automatically. ADR-014 D4's payload table is
   closed and lists neither. Suppressing them would mean adding a `beforeSend` stripper — which that
   same clause explicitly refuses as a control: "An implementation that relied on `beforeSend` would
   have the ordering backwards."
5. **Nothing it adds is wanted.** Its value is automatic instrumentation and framework error
   capture. ADR-014 D2 rejects exactly that, because auto-capture attaches request data *before*
   `redact.ts` runs. The application is buying the one part of `@sentry/node` it has already
   decided not to use.

**`@sentry/core` provides precisely what ADR-014 D2 asked for** — "the transport, not the framework
integration — used explicitly from a sink". Verified: `ServerRuntimeClient` + `createTransport`
deliver a real envelope to a real endpoint, the client computes the ingest URL from the DSN itself,
and the resolved closure contains no OpenTelemetry and no loader hooks.

**Why `ServerRuntimeClient` is the right class, not an improvisation.** It is Sentry's own
runtime-agnostic server client — the base its `@sentry/vercel-edge` and `@sentry/cloudflare` SDKs
are built on; its constructor doc comment in the shipped types reads "Creates a new Edge SDK
instance". Using it is taking a supported path, not assembling one.

**Version pinning.** `@sentry/core` is pinned to a caret range on `10.71.0`, the version all
evidence above was gathered against. A major-version bump is a re-verification event, not a
routine upgrade: the SDK's option surface is actively churning (see D4).

### D2 — OpenTelemetry stays excluded, and the exclusion becomes checkable

ADR-014 D11's exclusion is **reaffirmed without weakening**, and extended from a statement of intent
into a property that can be enforced:

- **No `@opentelemetry/*` package** may appear in `apps/web`'s dependency closure.
- **No Sentry OpenTelemetry setup** — `initOpenTelemetry`, `@sentry/opentelemetry`, span processors,
  `skipOpenTelemetrySetup` and the options it guards are all out of scope because the package that
  has them is not adopted.
- **No automatic instrumentation and no module interception** — `import-in-the-middle`,
  `require-in-the-middle`, or any equivalent loader hook.
- **No global Sentry state.** P1-19 must not call `setCurrentClient`, `Sentry.init`,
  `Sentry.setUser`, `Sentry.setTag`, or any other global API. The client is private to the sink
  module, so the global scope stays empty and no other module can contribute to an event.

`@opentelemetry/api` remains what ADR-014's Context table recorded: an optional peer dependency of
Next.js, not installed and not resolvable. This decision keeps that true.

**This is not a decision against OpenTelemetry as a future metrics and tracing system.** ADR-014 D9
already records that P1-17 needs a metrics backend and that doc 10 §1 names OTel → Grafana Cloud for
it. That decision remains open and unmade. What is excluded is acquiring an OTel runtime
*accidentally*, as a side effect of an error-reporting task, without the decision being taken.

**P1-19 must add a CI guardrail** in the style of the existing fences in `.github/workflows/ci.yml`,
failing the build if `@opentelemetry`, `import-in-the-middle`, or `require-in-the-middle` appears in
the lockfile as anything other than an uninstalled optional peer. A boundary that is only prose is
one nobody notices crossing — which is how this one was nearly crossed.

### D3 — The capture model is unchanged

ADR-014 D2's model is preserved exactly:

```
application code → log() → describeError / redactMeta → LogRecord → composed sink → Sentry
```

No automatic framework capture may bypass `logger.ts`. Still prohibited, unchanged from ADR-014:
`@sentry/nextjs`, `instrumentation.ts`, implicit request capture, a browser SDK, and any second
error-serialisation path. **`redact.ts` is not re-implemented, extended, or consulted by the
sink** — the sink receives an already-redacted record and forwards it. That ordering,
`logger.ts:169-198`, is the entire privacy argument and this ADR does not touch it.

**One ordering requirement is added, and it is load-bearing.** ADR-014 D2 states the additive
property — "A Sentry outage, a missing DSN, or a broken transport must never cost the local
record" — but leaves it as a property. It becomes an instruction:

> The composed sink must call `defaultSink(record)` **first and unconditionally**, then invoke the
> Sentry path inside its **own** `try/catch`.

Composed the other way, a synchronous throw from the Sentry path would be caught by `log()`'s outer
`catch` (`logger.ts:195`) *after* skipping the local write — and the failure would be invisible,
because that `catch` is deliberately silent. The probe showed `captureEvent` does not throw on
transport failure, so this is defence against a case not currently reachable; it costs one line and
removes an entire class of regression. ADR-014's `defaultSink` export authorisation (D2, one
minimal additive export, no behaviour change) is carried forward as written.

### D4 — Payload and PII, reconciled with the observed SDK behaviour

**The primary invariant is unchanged and is not the SDK's:** every field transmitted has already
passed `describeError` / `redactMeta` before the sink sees it. ADR-014 D4's field table stands
verbatim, and so does its never-transmitted list — raw email addresses, raw IP addresses, passwords,
JWTs, cookies, `authorization` headers, connection strings, provider response bodies, `item_secrets`
ciphertext, `Request`/`Response`/`Headers` objects, and ADR-013's rate-limit bucket values. Each is
refused by type, matched by key name, or matched by value shape in `redact.ts` *before* the sink is
reached. That mechanism is untouched by the change of package.

**Vendor-added metadata: allowed, but only the observed closed set.**

| Added by | Field | Verdict |
|---|---|---|
| Event body | `event_id`, `timestamp`, `environment` | **Allowed.** Generated or application-supplied; no subject |
| Event body | `contexts.trace{trace_id, span_id}` | **Allowed.** Sentry's own correlation ids, generated locally, unrelated to the record's `trace_id` and to any user |
| Envelope header | `sent_at`, `trace{environment, public_key, trace_id, org_id}` | **Allowed.** Routing and sampling metadata |
| Event body | `server_name` | **Never set** |
| Event body | `contexts.runtime` | **Never set** |

**`server_name` and `contexts.runtime` are controlled by omission, not by stripping.**
`ServerRuntimeClient` attaches them only when `options.serverName` / `options.runtime` are supplied
(`server-runtime-client.js:163` and `:157` respectively). P1-19 must not supply either. This is the
structural form of the control, and it is why the `@sentry/node` path was worse here: it *sets*
them, so suppression there would have required a `beforeSend` stripper.

**`sendDefaultPii: false` is no longer the stated control, and ADR-014 D4 requirement 1 is
amended.** Direct observation: the option still exists in `@sentry/core`'s `ClientOptions`
(`types/options.d.ts:356`), still defaults to `false`, and now carries
`@deprecated … will be removed in the next major version (v11)`, superseded by a `dataCollection`
category object, with "If both `sendDefaultPii` and `dataCollection` are set, `sendDefaultPii` will
be ignored." Naming a deprecated flag as a privacy control is how a guarantee quietly expires at a
major-version bump.

The controls are, in order of load-bearing-ness:

1. **The payload is an already-redacted `LogRecord`.** Nothing else is passed to `captureEvent`.
2. **`integrations: []`.** No integration is installed, so no default-PII machinery exists to
   disable. This is why the deprecation is survivable rather than merely tolerable.
3. **No global Sentry state** (D2) — the scope stays empty, so nothing can enrich an event.
4. **`server_name` and `runtime` omitted** (above).
5. `sendDefaultPii: false` is set anyway, as belt-and-braces and as an explicit statement of intent
   in the code. **It is documentation, not enforcement.** If a future major removes it, the four
   controls above are unaffected — and P1-19's tests must assert the *outcome* (no such field in a
   forwarded payload) rather than the presence of the flag.

`beforeSend` remains permitted as defence in depth and remains **not** the control, exactly as
ADR-014 D4 states.

**Grouping is preserved.** ADR-014 D4 requirement 3 — issues group on `event`, not message text —
is implemented as `fingerprint: [record.event]`, verified round-tripping intact in the probe.

**Doc 13 §4 is unaffected.** No personal data reaches Sentry, so it stays out of the deletion
cascade. ADR-014's conditional stands: if a future change ever sends identifying data, doc 13 §4
must be amended in the same change.

### D5 — Delivery and flush, specified against the real API

**ADR-014 D7's contract is preserved in full and is not renegotiated:** local `defaultSink` is
authoritative; Sentry is best-effort, at-most-once, unacknowledged, never retried; a request may
never fail, slow, or change status because Sentry is unavailable; remote arrival is offered, never
guaranteed. What follows is the mechanism, which ADR-014 could not specify because no SDK was
installed.

**Is flush available?** Yes: `client.flush(timeout?: number): PromiseLike<boolean>`.

**Is the SDK's own argument a sufficient bound? No — and this is the single most important
implementation finding in this document.** Two verified defects in treating it as one:

1. `Client.flush(timeout)` awaits `_isClientDoneProcessing(timeout)` and *then*
   `transport.flush(timeout)` (`client.js:245-254`). The argument bounds each half separately, so
   the ceiling is ≈2× the value passed. (Measured at 301 ms for `flush(300)` because the first half
   completed immediately — the ceiling is structural, not the common case.)
2. The transport half's deadline timer is **`unref`'d** (`promisebuffer.js:35` → `timer.js:3`). With
   a never-settling transport and an otherwise idle event loop, **`flush(300)` never settled at
   all.** This is precisely the shape of the serverless freeze ADR-014 D7 worries about: the moment
   nothing else is holding the process open is the moment the SDK's own deadline stops working.

**Therefore the bound is the application's, not the SDK's.** P1-19 must race
`client.flush(FLUSH_TIMEOUT_MS)` against its own **ref'd** `setTimeout` at the same deadline and
proceed on whichever settles first. Verified reliable: an application-owned race returned at its
150 ms deadline against a never-settling transport.

**`FLUSH_TIMEOUT_MS = 2000`,** a single named constant. Rationale: large enough that a healthy
round-trip completes (the probe's local delivery took 9–19 ms), small enough to sit inside any
plausible post-response window. It is a ceiling that a healthy path never reaches, not a latency
budget that is spent.

**How it is invoked — never synchronously, never on the request path.**

| Context | Mechanism |
|---|---|
| Inside a request scope | `after()` from `next/server` (Next **15.5.22**, stable, verified present), passed a **function**, which runs the flush **after the response is sent**. The flush is awaited *inside* the `after` callback, never by `log()` and never by the handler |
| Outside a request scope | Fire-and-forget: start the bounded race, **do not await it**, attach a no-op rejection handler so an unhandled rejection cannot be produced |

**`after()` must be passed a function, never a promise, and the call must be wrapped in
`try/catch`.** Both requirements are read from the installed source rather than from the API's name.
The *function* form is queued and run by `runCallbacksOnClose()`, which awaits `onClose` before
draining the queue (`after-context.js:33-49, 88-90`) — that is what makes "after the response is
sent" a verified property. The *promise* form takes a different branch: it requires a host-supplied
`waitUntil` and throws `E91` without one (`after-context.js:35-37, 130-136`), and it would begin the
flush immediately rather than after the response. **Two throw paths must be caught, not one** —
`E468` when there is no request scope (`after.js:12-20`), and `E91` if the function form is ever
replaced by the promise form. Either falls through to the second row. A logger cannot know whether
its caller is inside a request, so the `try/catch` is structural rather than defensive politeness.

**`log()` stays synchronous and unchanged.** The sink hands the event to the client and returns; the
client buffers it; the flush happens later, elsewhere, bounded. No new parameter, no new severity,
no `await` added anywhere on the request path — ADR-014 D2's "`log()` is unchanged" holds with the
single authorised `defaultSink` export.

**How transport failure is isolated.** Four layers, three of them verified rather than asserted:

1. `captureEvent` did not throw when the transport threw synchronously, rejected, or returned 500 —
   **measured**.
2. `flush` resolved and never rejected in all three of those cases — **measured**.
3. The Sentry path sits in its own `try/catch` after `defaultSink` has already written (D3).
4. `log()`'s existing outer `try/catch` (`logger.ts:193-198`) remains the last net.

**One honesty requirement, because the measurement makes it necessary.** `flush()` returned **`true`
for a rejected transport and for an HTTP 500**: it reports that the buffer drained, not that Sentry
accepted anything. **`flush() === true` must never be logged, tested, or reported as evidence of
delivery.** ADR-014's conclusion is reinforced, not softened: an empty Sentry project means "no
alerts fired", never "no errors occurred".

**Not claimed here.** Nothing above asserts how Vercel freezes, reclaims, or bills a function, or
that `after()` callbacks survive to completion in production. Those are platform behaviours; no
deployment has ever run (doc 09 §9.9). What is claimed is narrower and verified: the mechanism is
bounded by a timer this codebase controls, it is never awaited on the request path, and its failure
costs nothing but the remote copy.

### D6 — The direct dependency set, stated exactly

ADR-014 D2's "**Exactly one new runtime dependency in `apps/web`**" was ambiguous between the direct
dependency and the resolved closure, and the ambiguity is what let a 33-package OpenTelemetry
distribution pass as "one dependency". The claim is replaced with one that cannot be read two ways:

| | Package | Version | Why |
|---|---|---|---|
| **Direct** — declared in `apps/web/package.json` | `@sentry/core` | `^10.71.0` | The Sentry event model, `ServerRuntimeClient`, `createTransport`, and the DSN/envelope machinery. The only thing the sink needs |
| **Transitive** — not declared, listed for completeness | `@sentry/conventions` | `0.16.0` | `@sentry/core`'s single dependency; zero dependencies of its own |

**Direct: one. Resolved closure: two.** Both MIT. No `@types/*` package is required — `@sentry/core`
ships its own types.

`@sentry/conventions` is **transitive and must not be declared as a direct dependency**. Declaring a
transitive package pins something the parent controls and creates a second place for the version to
drift.

**The rule that replaces the ambiguous claim, and that D2's CI fence enforces:** one direct
dependency, and *the resolved closure contains no OpenTelemetry package and no module-interception
package*. Counted that way the constraint is checkable, and `@sentry/node` fails it while
`@sentry/core` passes.

### D7 — What of ADR-014 is amended, clause by clause

Nothing not listed as amended is changed. ADR-014 remains the governing decision.

| ADR-014 clause | Status under ADR-015 |
|---|---|
| **D1** — destination is Sentry; US region; why not the alternatives | **Unchanged.** Sentry is still the destination and still already in doc 13 §7's launch subprocessor set. The operational obligations D1 classifies as outstanding remain outstanding |
| **D2** — `LogSink`, not `@sentry/nextjs`; additive, never replacing; `defaultSink` export; `log()` unchanged; no browser SDK | **Amended in two places, otherwise unchanged.** (a) The package is `@sentry/core`, not `@sentry/node` (D1 here). (b) "Exactly one new runtime dependency" is replaced by D6 here. The rationale, the prohibition on `@sentry/nextjs` and auto-instrumentation, the additive requirement, the `defaultSink` export authorisation, and "`log()` is unchanged" all stand. D3 here **adds** a composition-ordering requirement |
| **D3** — `error` only; not `warn`, not `info` | **Unchanged** |
| **D4** — closed payload; never-transmitted list; three configuration requirements; `beforeSend` is not the control | **Requirement 1 amended.** `sendDefaultPii: false` is demoted from control to documentation, for the verified deprecation reason (D4 here), and replaced by four structural controls. Requirements 2 and 3, the field table, the never-transmitted list, the `beforeSend` position, and the doc 13 §4 consequence are unchanged. Vendor-metadata policy is **added**, not amended — ADR-014 had no position on it because it had not been observed |
| **D5** — one variable `SENTRY_DSN`, via Doppler; one `.env.example` entry | **Unchanged** |
| **D6** — per-environment behaviour; an unset DSN disables the sink silently | **Unchanged.** Note the probe confirms a DSN-less client is inert anyway (`getTransport()` → `undefined`), but D6's rule stands: with no DSN the sink is **not registered at all**, which is stronger than relying on an inert client |
| **D7** — telemetry may never affect availability; the delivery-contract table; the serverless caveat | **Contract unchanged; one row specified.** "Is a bounded flush required?" is still **yes**, and D5 here supplies the mechanism together with the finding that the SDK's own `timeout` argument is not by itself that bound. Everything else — best-effort, at-most-once, never blocking, stderr as primary and fallback, the honest labelling of the serverless caveat — is carried forward verbatim |
| **D8** — the three layers; ADR-013's condition | **Unchanged.** Emission is implemented (`8399890`); destination capability is what P1-19 builds; deployed delivery remains production-only verification. ADR-013's sign-off condition is neither satisfied nor weakened by this ADR |
| **D9** — not a solution to P1-17; the seam is reused | **Unchanged.** An error tracker still cannot compute a p95 |
| **D10** — the P1-19 task block | **Amended.** See D8 here for the exact rows |
| **D11** — what ADR-014 does not decide | **Unchanged and reaffirmed.** D2 here strengthens the OTel exclusion from prose to a CI fence. Every other exclusion — metrics, traces, SLOs, uptime, analytics, LLM tracing, paging, runbooks, log retention — stands untouched |
| **Open items, classified** | **Unchanged.** Plan tier and quota, the DPA and US-region project, data-category mapping, subprocessor-list confirmation, release tagging, and sourcemap upload (**still off by default**) remain exactly as classified |

### D8 — What P1-19 must change after this ADR is accepted

The task's shape, priority, risk and category are unchanged. These rows change:

| Row | Change |
|---|---|
| **SDK / package** | `@sentry/node` → **`@sentry/core@^10.71.0`**, one direct dependency (D6). Construct `ServerRuntimeClient` explicitly with `createTransport`; never call `Sentry.init`, `setCurrentClient`, or any global API |
| **Files** | The entry's existing list is correct and stays as written — new `server/observability/sentry.ts` · `server/observability/logger.ts` (`defaultSink` export only) · `server/observability/index.ts` · `apps/web/package.json` · `.env.example` · `docs/architecture/09-infrastructure-and-deployment.md` §9.4 — **plus** `.github/workflows/ci.yml` for the OTel fence (D2) |
| **Configuration** | `SENTRY_DSN` via Doppler, unchanged. Client options: `integrations: []`, `sendDefaultPii: false` (documentation, not control), `environment` from the deployment, `fingerprint: [record.event]` per event. **Do not pass `serverName` or `runtime`** |
| **Payload rules** | Forward the redacted `LogRecord` and nothing else. Vendor metadata limited to D4's closed allowed set |
| **Dependencies** | `P0-01 (the seam), ADR-014 (accepted)` → `P0-01 (the seam), ADR-014 + ADR-015 (accepted)`. The entry must not cite only ADR-014 while implementing decisions ADR-015 took |
| **Flush** | One constant `FLUSH_TIMEOUT_MS = 2000`. Race `client.flush()` against an application-owned **ref'd** timer. Invoke via `after()` inside a request scope, **passing a function, never a promise** (D5), wrapped in `try/catch` covering both `E468` and `E91`; fire-and-forget with a no-op rejection handler otherwise. Never awaited by `log()` or by a handler |
| **Composition** | `defaultSink(record)` first and unconditionally; the Sentry path second, in its own `try/catch` (D3) |
| **Tests** | ADR-014 D10's list stands, with four **additions**: (1) a forwarded payload contains **no `server_name` and no `contexts.runtime`** — asserted on the outcome, not on the presence of `sendDefaultPii`; (2) a transport that throws, rejects, and returns 500 each leave `log()`'s return value and the local stderr record unaffected; (3) the flush is bounded by the application's own deadline **with an unresponsive transport**, which is the case the SDK's own timer does not cover; (4) the CI fence fails when an `@opentelemetry/*` or module-interception package enters the lockfile. **No test may depend on network egress to a vendor** (ADR-014 D6) |
| **Verification obligation** | Confirm that the Next.js build bundles `@sentry/core` cleanly. This ADR could not check it — doing so requires the lockfile change that this task is forbidden to make — so it is P1-19's, and a bundling failure is a finding to report, not a thing to work around |

### D9 — Governance sequence after acceptance

The hardening blueprint is the single work queue and this ADR does not edit it. On acceptance, in
this order:

1. **Amend the existing P1-19 entry** in `docs/hardening/07-HARDENING-BLUEPRINT.md` — the
   `### P1-19 · Wire production error reporting` section — to match D8: its Description, Files,
   Dependencies and Tests rows. Amend it **in place**; do not add a second task. There is one piece
   of work and it has not started.
2. **Add ADR-015 to the index table** in `docs/architecture/README.md`.
3. **Only then may P1-19 implementation begin.**

Implementation must not start against this ADR while it is `Proposed`. Its whole purpose is to make
the SDK question settled before code is written, and starting early would reproduce exactly the
failure it was written to correct.

### D10 — What this ADR does not decide

- **Anything in ADR-014 D11.** Metrics, traces, SLO and burn-rate alerting, P1-17's threshold,
  uptime monitoring, product analytics, LLM tracing, paging and ticket workflow, `docs/runbooks/`,
  and log retention all remain undecided and unbuilt.
- **Whether OpenTelemetry is eventually adopted** for metrics and tracing. D2 excludes acquiring it
  *accidentally*; it does not pre-empt the decision doc 10 §1 anticipates.
- **The Sentry account, DPA, US-region project, data-category mapping, subprocessor-list
  confirmation, plan tier and event quota.** All operational, all outstanding, all unchanged from
  ADR-014's classification. None is complete.
- **The doc 10 §4 "new-issue spike" alert rule.** A console action in a project that does not exist.
- **Sourcemap upload.** Still off by default; enabling it remains a separate, deliberate decision.
- **Release tagging.** Still an implementation choice that may land in P1-19 or later.

## Consequences

- ✅ **The OpenTelemetry exclusion survives** — as a checked property rather than a sentence, and
  without deferring the decision doc 10 §1 anticipates.
- ✅ **The redaction boundary is untouched.** The change is which package the sink hands an
  already-redacted record to. `redact.ts`, its tests, and `logger.ts`'s ordering are unmodified.
- ✅ **A narrower payload than the rejected path.** `@sentry/core` attaches no hostname and no
  runtime context, so ADR-014 D4's closed field table is honoured by omission rather than by a
  `beforeSend` stripper the same clause refuses.
- ✅ **A smaller and quieter dependency closure** — two MIT packages, no `node:` builtins, no loader
  hooks, `sideEffects: false`.
- ✅ **The flush is genuinely bounded**, by a timer this codebase owns, in the one case the SDK's own
  timer was measured not to cover.
- ⚠️ **A lower-level API is used**, so P1-19 assembles the client, transport and stack parser
  explicitly. That is more code in `sentry.ts` than a one-line `Sentry.init()`, and it is the
  point — every enrichment is opt-in rather than opt-out.
- ⚠️ **Upgrades are a re-verification event.** The option surface is churning (`sendDefaultPii` is
  already deprecated toward removal in v11). A major bump requires re-running the checks in this
  document's evidence tables, not just a version change.
- ⚠️ **Everything ADR-014 flagged as unverifiable remains unverifiable.** No deployment has run.
  Actual arrival in Sentry, an alert firing, Vercel's freeze behaviour, and the Next.js bundle
  outcome are all still ahead.
- ↩️ **Reversible.** Removing the sink returns the system to today's posture: structured records on
  stderr, consumed by nothing. No data model, no migration, and no other module depends on it.

## Source discipline

Recorded explicitly, because ADR-014 was accepted partly on vendor behaviour that turned out not to
hold.

**Direct observation** — packages installed from the public registry on 2026-08-27 and exercised
against a local HTTP collector; source read from the installed build output. Every row of both
evidence tables, every file:line citation to `@sentry/*`, the flush measurements, the failure-mode
measurements, and the resolved dependency closures.

**Repository fact** — read from this working tree at `342c184`: `logger.ts` ordering and seam,
`middleware.ts` imports, the installed Next.js version, and `after()`'s presence, its out-of-scope
`E468` throw, its function-form scheduling through `onClose`, and its promise-form `E91` throw — the
last three read from `next/dist/server/after/after-context.js`, not from documentation.

**Inference, labelled as such** — that an OpenTelemetry runtime graph would materially affect cold
start or bundle size on Vercel (plausible, **unmeasured**, and *not* a reason D1 relies on); and
that an `unref`'d deadline is more likely to fail during a serverless freeze than in a warm process
(reasoned from the observed `unref` behaviour, not measured on the platform).

**Production-only, unverifiable from this repository** — that an event arrives in Sentry; that an
alert fires; Vercel's freeze, reclaim, and `after()` completion behaviour; and whether the Next.js
build bundles `@sentry/core` cleanly. The last is P1-19's obligation (D8); the rest remain ADR-014
D8's third layer.

## What this ADR does not change

- **ADR-014** — not edited. It governs, amended only where D7 above says so.
- **ADR-013, ADR-012, ADR-011** — untouched. ADR-013's sign-off condition stands exactly as written.
- **P1-08's implementation** (`8399890`) — no change. The event is already emitted correctly.
- **`logger.ts`** — one additive export of `defaultSink`, authorised by ADR-014 D2 and owned by
  P1-19. Nothing else: no change to `log()`, to record construction, to redaction, or to the
  `try/catch` around the sink.
- **`redact.ts` and its tests** — untouched. Redaction is inherited, not re-implemented.
- **Doc 10, doc 13** — no amendment. Sentry is already named in §1/§4 and already in the launch
  subprocessor set.
- **The hardening blueprint** — not edited here. D9 sequences that as a post-acceptance step.
