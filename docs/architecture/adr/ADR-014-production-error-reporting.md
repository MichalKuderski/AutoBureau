# ADR-014 — Production errors reach Sentry through the existing log sink, and through nothing else

**Status:** Proposed · blueprint P1-19 (to be created on acceptance), unblocks P1-08's sign-off condition
**Date:** 2026-08-26
**Executes rather than amends:** `10-observability-and-analytics.md` §1 names Sentry as the error
tool and §4 already lists "Sentry new-issue spike" among the launch paging alerts; this ADR carries
that out. No frozen document is contradicted, so nothing here is an amendment.
**Does not amend ADR-013.** Its sign-off condition is correctly stated and correctly unsatisfied;
this ADR establishes the destination that condition is waiting on.

## Context

`docs/hardening/05-security-reliability-audit.md` Gate B lists two items, and treats them as
separate blocking requirements:

> - [ ] **B1** Production logging enabled with redaction; no token, cookie, or provider body ever logged.
> - [ ] **B2** Error reporting wired, with correlation IDs.

Blueprint P0-01 folded B2's wording into its own description and shipped **B1**: a structured
logger with redaction, correlation ids, and a registration seam. Its module header says plainly why
it stopped there — the vendor stack "has not [arrived], and adding it now would be an
infrastructure decision made to satisfy a logging task", and `setLogSink` "is the whole integration
surface". That was the right call and it is the reason this decision is cheap now.

**B2's reporting half was never assigned to any task.** Architecture review 04 names the
operational floor as three things — "structured logs · error reporting · traces" — and one of the
three shipped.

### What the repository actually contains

| Checked at this commit | Result |
|---|---|
| Sentry, OTel, Grafana, Better Stack, PostHog, Langfuse in any `package.json` | **none** |
| `@opentelemetry/api` in `pnpm-lock.yaml` | present **only as an optional peer dependency of Next.js**; not installed, not resolvable |
| `instrumentation.ts` (Next's own error/OTel entrypoint) | absent |
| Production callers of `setLogSink` | **none** — every caller is a test |
| Observability variable in `.env.example`, `vercel.json`, any workflow | none |
| `docs/runbooks/`, which doc 10 §7 says exists "from day one" | absent |
| Live deployment | **none has ever run** (doc 09 §9.9) |

### The signals already waiting for a destination

Eight events are emitted at `error` level today and consumed by nothing:

`auth.not_configured` · `auth.rate_limit_unavailable` · `auth.refresh_unavailable` ·
`auth.sign_in_error` · `auth.sign_in_failed` · `http.idempotency_persist_failed` ·
`http.not_configured` · `http.unhandled_error`

`auth.rate_limit_unavailable` is **one of eight**, and not the strongest case among them:
`http.idempotency_persist_failed` records a domain mutation that committed while the record of it
did not — ADR-012's named worst case — and `http.unhandled_error` covers every unexpected `/v1`
fault. **This capability is a shared platform need that P1-08 happened to surface**, which is why
this ADR is scoped to the channel rather than to the limiter.

## Decision

### D1 — The destination is Sentry

**Sentry, for the server runtimes.** Three pieces of repository evidence decide this, and only the
third is close:

1. **Doc 10 §1 already names it** as the error tool, and doc 10 §4 already names
   "Sentry new-issue spike" as a launch paging alert. Adopting it *executes* the frozen architecture
   set; adopting anything else *deviates* from it and would need the deviation argued.
2. **Doc 13 §7 already lists Sentry in the accepted launch subprocessor set**, and states the rule
   that makes this decisive: **"Adding a subprocessor = ADR + notice cycle."** Sentry is not an
   addition — it is already cleared, with a DPA and a documented purpose. Any alternative
   destination *is* an addition, and doc 13 §3 prices that at a public subprocessor-list change plus
   **30 days' email notice to users**. Choosing differently would cost a month and a compliance
   cycle to obtain a capability the named vendor already provides.
3. **No accepted ADR establishes Sentry**, which is exactly why this document exists. Following the
   precedent ADR-012 and ADR-013 both set — a vendor named in a summary table is an intention, not
   an executed decision — the naming makes Sentry the default an alternative must argue with, not a
   settled adoption. This ADR is that ratification.

**Why not the alternatives**, stated so the choice is a comparison rather than an assertion:

- **A different error tracker** (Rollbar, Honeybadger, Bugsnag, self-hosted GlitchTip): identical
  capability, plus a new subprocessor, a new DPA, and a 30-day notice cycle. Nothing in the
  repository suggests Sentry is inadequate, so the cost buys nothing.
- **Grafana Cloud alone** (also named in doc 10 §1): it is the metrics/logs destination, not the
  error tracker, and doc 10 §4's error alert is written against Sentry's issue model. Using it here
  would collapse two decisions into one and pull OTel in behind it — which D11 excludes.
- **A Vercel log drain into an existing destination**: requires a deployment that does not exist,
  configures nothing in this repository, and still needs a destination chosen. It is a transport
  question, not a destination one.
- **Doing nothing and waiting for the full observability program**: leaves Gate B2 open and leaves
  ADR-013 D7's accepted fail-open risk without the visibility it was conditioned on.

**Residency:** US, consistent with doc 13 §6 ("US processing at launch — Vercel/Supabase/AWS **and
Langfuse** all pinned to US regions"). The project is created in Sentry's US region; a project
created elsewhere would contradict a residency posture the review already corrected once (A9/F-11).

### D2 — The integration is a `LogSink`, and specifically NOT the Next.js auto-instrumentation SDK

This is the load-bearing decision, and the reason it is not a matter of taste is an ordering fact in
`logger.ts` that can be read directly:

```
const record: LogRecord = {                    // describeError(...) scrubs kind/code/message/stack
  …                                            // redactMeta(input.meta) scrubs everything else
};
try { sink(record); } catch { /* … */ }        // the sink sees the record only AFTER redaction
```

**A sink receives an already-redacted `LogRecord`.** Forwarding one therefore inherits every
guarantee doc 10 §3 requires — structurally, not by promise, and not by remembering to configure
something.

`@sentry/nextjs` with `instrumentation.ts` would do the opposite. Its value proposition is
automatic capture: it hooks the runtime and reports raw exceptions, and its default integrations
attach request data — headers, cookies, bodies — at the moment of the throw, **before this
codebase's redaction boundary has run**. That would move doc 10 §3's "PII never in logs" guarantee
out of a tested module (`redact.test.ts`) and into a vendor's configuration surface, where the
failure mode is silent. `redact.ts`'s own header states the design goal this would defeat: "a future
developer who logs an object without knowing what is inside it cannot leak a secret."

**Decision:** `@sentry/node` — the transport, not the framework integration — used explicitly from a
sink, with automatic instrumentation and default integrations disabled. Exactly one new runtime
dependency in `apps/web`.

Three properties follow and are binding:

- **Additive, never a replacement.** The Sentry sink composes with `defaultSink`; stderr keeps
  receiving every record exactly as today. `setLogSink` takes one function, so the implementation
  registers a composed sink that calls both — it does not swap the default out.
- **`log()` is unchanged.** No new parameter, no new severity, no call-site edits. The seam already
  exists; this ADR uses it rather than widening it.
- **No browser SDK.** Server runtime only. Doc 10 §6 already puts "session replay off entirely at
  launch", and the client error boundary in `components/ui/error-state.tsx` stays as it is.

### D3 — Scope: `level: "error"` records only

Forwarded: `error`. Not forwarded: `warn`, `info`.

`warn` covers `auth.rate_limited`, `http.rejected`, `auth.refresh_invalid`,
`auth.rate_limit_degraded` — security-relevant, **expected**, and potentially high-volume by design.
`auth.rate_limited` fires once per rejected attempt, so under exactly the attack it detects it would
arrive in floods. Feeding that into an issue tracker whose launch alert is "new-issue spike"
(doc 10 §4) would bury the spike it exists to surface. Those events belong to log search and, later,
to metrics — which is a different decision, deliberately not taken here (D11).

### D4 — What is transmitted, and what cannot be

The whole payload is the `LogRecord`, whose field set is closed. `logger.ts` states why, under the
heading "THE RECORD IS ASSEMBLED, NEVER SPREAD": "Every field below is named and typed. There is no
path by which a caller's object becomes the record — arbitrary context goes in `meta`, which is
redacted wholesale."

| Field | Sent | Note |
|---|---|---|
| `ts`, `level`, `event`, `env` | yes | `event` is a class name, never a subject |
| `trace_id` | **yes** | the correlation id Gate B2 explicitly requires |
| `route`, `method`, `status` | yes | `routeOf` returns the pathname only — "a query can carry a token or an email" |
| `household` | yes, **already hashed** | `householdRef` truncated SHA-256, per doc 10 §3 |
| `duration_ms` | yes | |
| `error_kind`, `error_code`, `error_message`, `stack` | yes, **already scrubbed** | `describeError` extracts four named fields and scrubs each |
| `meta` | yes, **already redacted** | `redactMeta`, with depth/breadth/length caps |

**Never transmitted, and structurally unable to be:** raw email addresses, raw IP addresses,
passwords, JWTs, cookies, `authorization` headers, connection strings, provider response bodies,
`item_secrets` ciphertext, `Request`/`Response`/`Headers` objects, and ADR-013's rate-limit bucket
values. Each is either refused by type, matched by key name, or matched by value shape *before* the
sink is reached.

Three configuration requirements make the vendor's own defaults match this posture:

1. **`sendDefaultPii: false`.** Sentry's opt-in PII collection must stay off.
2. **No request/user context attached.** The record is the payload; nothing enriches it.
3. **Issues group on `event`, not on message text.** The scrubbed message is deliberately
   low-entropy, so default grouping would merge unrelated faults. `event` is the stable, greppable
   name the taxonomy already provides, and grouping on it is what makes "new-issue spike" mean
   something.

`beforeSend` scrubbing is permitted as defence in depth but is **not** the control — the control is
that redaction already ran. An implementation that relied on `beforeSend` would have the ordering
backwards.

**Consequence for doc 13 §4:** because no personal data reaches Sentry, it stays out of the deletion
cascade, which today enumerates "Langfuse traces (API purge), PostHog person deletion" and does not
list Sentry. That absence is correct and this ADR preserves the reason for it. If a future change
ever sends identifying data to Sentry, doc 13 §4 must be amended in the same change.

### D5 — Configuration and secrets

One variable: **`SENTRY_DSN`**.

- **Source of truth is Doppler**, syncing to Vercel environment variables (doc 09 §5). Nothing is
  set by hand in the Vercel dashboard, per `.env.example`'s existing rule that "a value that exists
  only there is invisible to review".
- A DSN is a write-only ingest key rather than a credential, but it routes through Doppler anyway:
  doc 09 §5's rule is "no secrets in repo or CI logs", gitleaks runs in CI, and a second handling
  convention for one variable is how the first one drifts.
- **`.env.example` gains one documented entry**, classified per environment in the same table that
  already classifies `DATABASE_URL` and `REDIS_URL`.

### D6 — Environment behaviour

| Environment | `SENTRY_DSN` | Behaviour |
|---|---|---|
| `local` | unset | Sink not registered. stderr only — the current development experience is unchanged |
| CI / test | unset | Same. No test may depend on network egress to a vendor |
| `preview` | set | Sentry `environment: "preview"` |
| `staging` | set | `environment: "staging"` |
| `production` | set | `environment: "production"` |

**An unset DSN is a normal configuration, not an error.** It disables the sink silently rather than
throwing or warning on every boot; a local run must not be noisy about a vendor it has no business
contacting. This mirrors how the auth boundary already treats absent configuration as a state to
report rather than a crash (doc 09 §9.8).

Tagging the environment matters for the alert rule: without it, preview deployments and their
deliberately broken pull requests would inflate production's new-issue count and demote the alert
doc 10 §7 says gets demoted when it fires without action.

### D7 — Failure behaviour: telemetry may never affect availability

**Rule: a request's outcome never depends on the error channel.** Four properties, three of which
the repository already provides:

1. **A throwing sink cannot escape.** `log()` already wraps `sink(record)` in `try { … } catch {}`
   with the comment "A logger that throws converts a handled failure into an unhandled one." That
   containment is repository-verified and pre-dates this decision.
2. **Delivery is never awaited on the request path.** `log()` is synchronous and returns `boolean`;
   this ADR does not change that. The sink hands the event to the transport and returns.
3. **Delivery is best-effort.** A failed send is dropped. No retry queue, no buffer with a
   durability story, no backpressure — those would be a second reliability system to operate, for
   telemetry.
4. **stderr is the fallback, and it is also the primary.** Because the Sentry sink is additive (D2),
   a Sentry outage degrades the system to *exactly today's behaviour*: a structured JSON line on
   stderr. **No new availability policy is invented here** — the existing local logging path simply
   remains, unchanged, underneath.

This is the same shape of reasoning ADR-013 D7 applies to the rate limiter, and for the same reason:
a component that exists to observe failure must not be able to cause it.

**One honest limitation, and it is a real one.** On Vercel a serverless function may be frozen or
reclaimed once the response is sent, so an event handed to an async transport can be lost before it
leaves the process. The implementation should flush on a best-effort basis where the platform allows
it, and **this ADR does not claim that every emitted error reaches Sentry.** What it claims is that
the channel exists and that failure to deliver is silent and harmless. Measuring actual delivery is
D11's deployment-only verification.

### D8 — Relationship to P1-08 and ADR-013

ADR-013's condition is that `auth.rate_limit_unavailable` "must reach doc 10's alert channel". Three
layers, and conflating them is how this gets reported dishonestly:

| Layer | Owner | Status |
|---|---|---|
| **Emission** — the event exists, at `error`, once per affected request, carrying no subject | P1-08, commit `8399890` | ✅ **Implemented and repository-verified** by integration tests I3/I4 |
| **Destination capability** — a real channel with an alert rule behind it | **ADR-014 decides it; P1-19 builds it** | ⬜ Decided here, not yet built |
| **Deployed delivery** — an event actually observed arriving in Sentry, and an alert actually firing | a real deployment | ⬜ **Production-only verification.** Cannot be established from this repository (doc 09 §9.9) |

**ADR-013 is unchanged and unweakened.** Its condition is satisfied when P1-19 ships *and* delivery
is observed in a deployed environment — not when this ADR is accepted, and not when P1-19 merges.
Reporting P1-08 as signed off before that final step would be the exact overclaim ADR-013 D7 was
written to prevent.

### D9 — Relationship to P1-17 and the wider observability programme

**ADR-014 is a prerequisite for the observability programme, not a solution to it, and specifically
does not close P1-17.**

P1-17 requires instrumenting "transaction duration and pool wait" and setting "the alert that
triggers relocation". That is **metrics with a numeric threshold**. An error tracker records
discrete faults; it cannot compute a p95, hold a time series, or evaluate a burn rate. P1-17 needs a
metrics backend — doc 10 §1's OTel → Grafana Cloud — which is a separate decision this ADR
deliberately does not take (D11). P5-04, which load-tests P1-17's threshold, inherits that same
dependency.

What P1-17 *does* get from this decision is reuse of the same seam: an exporter registered through
`setLogSink`, or a sibling seam built the same way, rather than a second parallel integration path.

**P5-02** — "Security regression suite — Gates A–D of audit 05 as executable checks" — will assert
Gate B2. After P1-19 that assertion can pass on the repository-verifiable half; the deployed half
remains D11's.

### D10 — The implementation task that follows acceptance

Exactly one task, to be added to `docs/hardening/07-HARDENING-BLUEPRINT.md` **after this ADR is
accepted** and not before. This ADR does not edit the blueprint: the blueprint is the work queue,
the architecture set is the decision record, and writing the task before the decision is ratified
would put work in the queue for a decision that has not been made.

> ### P1-19 · Wire production error reporting
> | | |
> |---|---|
> | **Priority** | High — closes audit 05 Gate B2 and unblocks P1-08's sign-off condition |
> | **Description** | Register a production `LogSink` that forwards `level: "error"` records to Sentry (ADR-014). Additive to `defaultSink`; `log()` unchanged; `@sentry/node` with automatic instrumentation off, never `@sentry/nextjs`. One variable, `SENTRY_DSN`, via Doppler; unset disables the sink silently. |
> | **Files** | new `server/observability/sentry.ts` · `server/observability/index.ts` · `apps/web/package.json` · `.env.example` · `docs/architecture/09-*.md` §9.4 |
> | **Dependencies** | P0-01 (the seam), ADR-014 accepted |
> | **Risk** | **Low** — additive; a broken sink degrades to today's behaviour |
> | **Tests** | A registered sink receives every `error` record and no `warn`/`info` record. A throwing sink does not affect the caller. An unset DSN registers nothing. No forwarded record contains an email, IP, token, cookie, or bucket value. Existing redaction and observability suites stay green. |
> | **Type** | Mechanical (the architecture is ADR-014's) |
> | **Cat** | **B** |

Two follow-ups that are **not** part of P1-19 and must not be folded into it: creating the Sentry
project with its US region and DPA (an operational step, not a code change), and configuring the
doc 10 §4 "new-issue spike" alert rule (a console action in a project that does not yet exist).

### D11 — What this ADR does not decide

Named individually so none is quietly absorbed later:

- **Metrics and traces.** No OTel, no `@opentelemetry/*`, no Grafana Cloud, no Tempo/Mimir/Loki.
- **SLO and burn-rate alerting** (doc 10 §4's table and its 2%/1h + 5%/6h rates).
- **P1-17's connection-budget threshold alert** and P5-04's load test.
- **Uptime monitoring** — Better Stack, synthetic checks, the public status page. Doc 09 §9.8
  already records that no `/health` endpoint exists and that this is deliberate.
- **Product analytics** — PostHog, the outbox analytics consumer, feature flags (doc 10 §6).
- **LLM tracing** — Langfuse (doc 10 §5); `services/ai` does not exist.
- **Slack/ticket workflow and paging infrastructure** — doc 10 §4's "everything else is a Slack
  ticket" and §7's on-call rotation. This ADR delivers a destination that an alert rule can watch;
  who gets woken is an operational decision with no repository surface today.
- **`docs/runbooks/`**, which doc 10 §7 says exists from day one and does not.
- **Log retention and shipping** — doc 10 §3's "30 d logs" presupposes Loki. stderr on Vercel is
  not that, and this ADR does not make it that.

## Consequences

- ✅ **Gate B2 becomes closable**, and with it ADR-013 D7's visibility condition — the first time
  either has had a mechanism.
- ✅ **Eight existing error signals gain a consumer**, not one. No signal-specific notifier is built.
- ✅ **The redaction guarantee is inherited structurally.** Because records are scrubbed before the
  sink, the vendor cannot receive what the logger already refused to emit.
- ✅ **No new subprocessor, no notice cycle.** Doc 13 §7 already cleared Sentry; any alternative
  would have cost 30 days.
- ✅ **The logger is untouched.** P0-01 built `setLogSink` for exactly this, and this decision spends
  the seam rather than widening the module.
- ⚠️ **One new runtime dependency** in `apps/web`, and one new environment variable. Small, but this
  repository has twice declined to acquire either inside a mechanism task (ADR-012, ADR-013) — which
  is why it is being acquired here, in a decision of its own, rather than folded into P1-08.
- ⚠️ **A vendor now receives operational metadata**: event names, routes, hashed household
  references, trace ids, scrubbed messages and stacks. That is not nothing, even with no personal
  data in it — a route plus a timestamp is information about usage.
- ⚠️ **Serverless delivery is not guaranteed** (D7). An event can be lost when a function freezes.
  Under-delivery is silent, which means "no Sentry issues" will never by itself prove "no errors".
- ⚠️ **This closes error reporting only.** Anyone reading doc 10 after this lands will still find
  metrics, traces, SLOs, uptime, analytics and runbooks undelivered, and P1-17 still blocked.
- ↩️ **Reversible.** Removing the sink returns the system to today's posture: structured records on
  stderr, consumed by nothing. No data model, no migration, and no other module depends on it.

## Open decisions

None material to implementation. Two operational choices are deliberately left to whoever creates
the project, because neither changes what P1-19 builds:

1. **Sentry plan tier and event quota.** A quota decision, revisitable without code change. Worth
   noting only because quota exhaustion is a silent under-delivery mode on top of D7's.
2. **Whether `@sentry/node`'s release/sourcemap tagging is configured in P1-19 or later.** Doc 10 §1
   names "release-tagged, sourcemaps"; it improves triage and changes no privacy or failure
   property, so it may follow.

## What this ADR does not change

- **ADR-013** — unmodified. Its condition stands as written; this establishes what it waits on.
- **ADR-012, ADR-011** — untouched.
- **P1-08's implementation** (`8399890`) — no change. The event is already emitted correctly.
- **`logger.ts`, `redact.ts`, and their tests** — untouched. The seam is used, not widened.
- **Doc 10** — no amendment. This executes §1 and §4 rather than departing from them.
- **Doc 13 §7** — no amendment. Sentry is already in the launch subprocessor set.
