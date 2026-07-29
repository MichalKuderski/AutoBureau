# AutoBureau v1 — Product Requirements Document

**Status:** FROZEN (pending one override clause, §4.1) · **Version:** 1.0 · **Date:** 2026-07-27
**Owner:** Head of Product · **Engineering contract:** anything not in this document is out of scope for v1. Scope enters only by PRD amendment (§21), never by Slack, vibes, or "while we're in there."
**Canonical references:** architecture set v0.2.0-review (constraints), red-team A-B1–6 (cuts), ledger thesis A-F1–5 (data doctrine), execution blueprint (gates G1–G4). Where this PRD and those documents disagree on *product scope*, this PRD wins; on *engineering constraints*, the architecture set wins.

---

## 1. Product Vision (one page)

Every household has a **standing**: what it holds (policies, registrations, IDs, warranties, leases), what it owes (renewals, filings, payments), and what it is owed (claims, deposits, coverage it forgets to use). Today that standing lives nowhere — it is smeared across inboxes, drawers, and the memory of whoever worries most.

AutoBureau v1 is the first true **system of record for household standing**. You feed it evidence — forward an email, snap a photo, connect your inbox — and it maintains a verified, current ledger: every item, every deadline, every window that matters, each fact traceable to the document that proves it. It watches so you don't have to, warns you with enough runway to act, and hands you the exact next step — pre-filled and ready — when action is due.

v1 makes one promise and engineers everything around it: **nothing in your ledger lapses silently.** We do not promise to do your paperwork for you (that's v2's earned privilege). We promise you will never again be surprised by your own life admin.

The v1 wedge is the person carrying the heaviest version of this load: the **sandwich-generation caregiver**, managing a parent's affairs alongside their own. For them the product is not organization — it is relief, and proof to themselves and their family that everything is handled.

Success in one sentence: *within ten minutes of signing up, a caregiver sees a true deadline they didn't have written down anywhere — and eight weeks later, documents are still flowing in without us asking.*

What v1 is **not**: not a chatbot, not an autonomous agent, not a finance app, not a tax service, not a document graveyard. Every one of those is either a distraction or a later act.

---

## 2. User Personas

**P1 — The Caregiver (primary; the wedge).** 45–60, employed, managing their own household plus an aging parent's paperwork (often after a health event forced the takeover). Overwhelmed, guilt-prone, deeply motivated by "nothing slips." Moderate tech comfort; lives in email; phone camera is the scanner. Buys relief and provability. **We design every default for P1.**

**P2 — The Household CFO (secondary; admitted, not targeted).** 30–50, runs a family's admin, tired of the spreadsheet. Arrives via SEO tools and word of mouth. Served by the same product; no P2-specific features in v1.

**Anti-personas (we do not build for them in v1, and we say no):** small-business owners (business admin ≠ household standing), tax filers seeking advice or e-filing, users demanding we log into portals or pay bills for them, document-hoarding "archive everything" users whose job is storage rather than obligations.

## 3. Jobs To Be Done

| # | When… | I want to… | So that… |
|---|---|---|---|
| J1 | I take over a parent's affairs | reconstruct what exists — policies, IDs, accounts, deadlines | I'm not discovering obligations by missing them |
| J2 | A bill/notice/renewal arrives (mail or email) | know in seconds whether action is required and by when | nothing lapses while I'm juggling everything else |
| J3 | A deadline approaches | be warned with enough runway, then given the exact next step | acting takes minutes, not a weekend of dread |
| J4 | Family (or I, at 2am) asks "is X handled?" | answer from one trustworthy place | I can prove — to them and myself — that it's under control |
| J5 | Something I own breaks or money is due back to me | know the warranty/deposit/claim window exists before it closes | I stop donating money to companies through forgetfulness |

## 4. The Wedge

**Frozen:** sandwich-generation caregivers, US, English, managing 1–2 elders' affairs plus their own household. Product implications baked into v1: multi-**member** households under a single login (caregiver manages Mom as a member — no second account needed); the guided census is elder-takeover-shaped; the 8 document types include `medical_bill` (EOBs and bills are caregiver reality) instead of professional certifications; copy register is *relief and reassurance*, never productivity-bro.

### 4.1 The single override clause
This PRD freezes ahead of gate G1 (blueprint P0). If G1's data contradicts the caregiver wedge, exactly three things may change via one amendment: persona priority (§2), one document-type swap (§8/F7), and the copy register (§15). **Nothing else reopens.** If G1 confirms, this clause self-deletes.

## 5. Problems we solve (v1)

1. **Invisible deadlines** → every dated obligation extracted, tracked, and reminded with laddered runway.
2. **The takeover problem** (J1) → guided census turns "I have no idea what Dad has" into a working ledger in one sitting.
3. **Ingestion labor** → three channels (Gmail read-only, forwarding alias, camera/upload) so evidence flows in at near-zero effort.
4. **"Is it handled?" anxiety** → a single standing view per member with freshness indicators and provenance on every fact.
5. **Blank-page paralysis at action time** → per-obligation Action Kits: pre-filled letters, checklists, calendar files.
6. **Forgotten entitlements (v0 slice)** → warranty windows and refundable deposits tracked as things *owed to you*.

## 6. Problems we explicitly DO NOT solve (v1)

No executing actions on the user's behalf (no sending, submitting, canceling *for* you). No storing portal/bank credentials; no logging into anything. No moving money, paying bills, tax prep/filing, or financial/legal/medical advice. No bank-transaction ingestion (Plaid). No bill negotiation. No conversational assistant. No collaboration (second logins). No business/side-hustle admin. No paper mail scanning service. No non-US formats. **Support will be given canned "not yet, here's why" responses for each of these — the roadmap defends itself.**

## 7. Core user journeys

- **CJ-1 First Run (the ten-minute promise):** signup → choose "managing for myself / also for a parent" → add members → guided census (checklist-style: "Does Mom have… Medicare? supplemental? a car? a lease?") → seeds *provisional* items → prompt for one document (camera or upload) → first **true** obligation on screen ≤ 10 min (metric M1).
- **CJ-2 Passive flow:** connect Gmail (read-only) → 12-month backfill scan → batched review ("we found 14 relevant documents") → accept/correct → ledger populates; ongoing scan continues silently. Alternate: provision `h-…@in.autobureau.com`, guided forward test.
- **CJ-3 The save:** reminder email (T-30) → obligation detail with provenance → Action Kit (e.g., pre-filled DMV checklist + ICS) → user acts in the world → marks done → **outcome capture** (one-tap: "renewed — cost $X / process matched? y/n").
- **CJ-4 Review:** needs-review item → side-by-side document + proposed fields → accept / correct / reject → corrections logged (eval corpus) → obligations spawn only from confirmed or above-threshold facts.
- **CJ-5 The weekly exhale:** Sunday digest — "2 need attention, 3 handled, nothing at risk" — deep links into obligations; the empty-state variant still delivers reassurance + horizon.
- **CJ-6 Trust exit:** privacy center → full export (zip: originals + JSONL) or account deletion with 14-day undo → receipts.
- **CJ-7 Upgrade:** free-tier cap reached mid-value ("processing resumes on the 1st — or upgrade") → plan screen → Stripe checkout → caps lift instantly. Cancellation: one click, no retention maze.

## 8. MVP feature list (the complete v1 surface)

| ID | Feature | Notes |
|----|---------|-------|
| F1 | Auth & account | Email+password, magic link, Google/Apple sign-in; optional TOTP MFA; Supabase Auth |
| F2 | Household & members | Single login; unlimited members (self, parents, kids); member = subject of items, not a user |
| F3 | Guided census onboarding | Caregiver-shaped checklist; creates provisional items flagged `unverified` |
| F4 | Document capture | Drag-drop, PWA camera, bulk upload (≤25 MB, PDF/JPEG/PNG/HEIC/EML) |
| F5 | Forwarding ingestion | Per-household alias; sender verification; quarantine for unknown senders |
| F6 | Gmail read-only ingestion | OAuth restricted scope; 12-mo backfill + ongoing; relevance filter before pipeline; disconnect = hard stop + purge of unprocessed queue |
| F7 | Pipeline & review queue | 8 frozen doc types: `government_id, insurance_policy, medical_bill, vehicle_registration, lease, utility_bill, warranty, subscription_receipt`; per-field auto-apply thresholds; user review UI |
| F8 | Registry | Items per member; lifecycle states; secret fields write-only w/ last4 + audited reveal |
| F9 | Obligations | Both directions (`owed_by`, `owed_to` — warranties/deposits as entitlements v0); statuses; snooze/dismiss/complete with **outcome capture** |
| F10 | Reminders & digest | Ladders per kind/priority; email + web push + in-app; quiet hours; weekly digest |
| F11 | Action Kits | Per-obligation-kind: pre-filled letter/checklist (registry mail-merge, secrets substituted client-side at render), ICS file. **User sends/files themselves** — no execution |
| F12 | Search | Keyword + filters over items/obligations/documents (FTS + vector); ⌘K; **not** a chat |
| F13 | Notifications center & prefs | In-app feed; kind × channel matrix; one-click per-kind unsubscribe |
| F14 | Billing & plans | Free (10 docs/mo, 1 elder member) / Premium $12/mo or $99/yr (pricing may be amended by G1 data — same clause as §4.1); Stripe; entitlement caps enforced at gateway; one-click cancel |
| F15 | Privacy center | Export (async zip), deletion (14-day grace), security page, "what we can/can't see" explainer |
| F16 | PWA shell | Installable; camera; web push; responsive; offline read-only view of obligations |
| F17 | Ops console (internal) | Staff review mode (Wizard-of-Oz behind queue), rulebook tooling v0, household support view (consent-scoped) |

## 9. Features explicitly postponed (with the release that owns them)

Chat assistant (v2, only if search telemetry proves demand) · autonomous execution + approval machinery (v2 — the entire doc-04 agent/approval architecture stays on paper) · multi-user logins/invites/roles (v1.x post-launch) · Outlook OAuth (v1.1) · Plaid/transactions (v2, tied to monetization ADR-011) · subscription-auditor-as-headline (v2) · SMS (v1.x, 10DLC lead time) · Google Calendar OAuth (v1.1; ICS ships now) · native apps (data-gated) · resolution rails (v2 flagship) · additional doc types (content-ops cadence post-launch) · B2B2C, public API, EU, affiliate (all Act II+). **Each postponement is a decision, not a backlog item; revisiting one requires the §21 process.**

## 10. Success metrics (targets at +60 days post-launch unless noted)

| ID | Metric | Target | Gate |
|----|--------|--------|------|
| M1 | Activation: signup → first *true* obligation | ≤ 10 min median; ≥ 50% of signups within day 1 | A-B4 |
| M2 | Coverage: censused standing captured ≤ 30 days | ≥ 70% | G2 |
| M3 | Ingestion retention: households with ≥1 new doc in week 8 | ≥ 50% (≥ 70% Gmail-connected) | G3 |
| M4 | Gmail connect rate (of new signups) | ≥ 60% | G3 |
| M5 | AI accept rate (proposals accepted unmodified) | ≥ 85% | G2/G3 |
| M6 | Reminder → action: critical reminders resolved ≤ 14 days | ≥ 60% | — |
| M7 | Digest open rate (4-week rolling) | ≥ 45% | — |
| M8 | Free → paid conversion (60-day cohort) | ≥ 8% | G3 |
| M9 | M1 paid logo churn | ≤ 6% | G3 |
| M10 | Freshness: ledger facts verified < 12 mo | ≥ 80% | ledger doctrine |

## 11. Failure metrics (red lines; any one triggers a stop-and-fix, not a sprint discussion)

| ID | Red line | Threshold |
|----|----------|-----------|
| X1 | False critical obligation (wrong date/kind on priority-1) reported by user | > 0.5% of critical obligations → auto-apply reverts to review-all for that doc type |
| X2 | Missed reminder SLO breach | any critical reminder > 5 min late at > 0.5% weekly → incident + postmortem |
| X3 | Review-queue abandonment | > 30% of review items untouched at 7 days → review UX failure, feature work halts on F7 |
| X4 | Gmail disconnect rate ≤ 30 days after connect | > 15% → trust/relevance failure investigation |
| X5 | COGS per active household | > $1.60/mo sustained → routing/caching sprint before any feature work |
| X6 | Injection canary breach in production eval run | any → ship freeze until cleared |
| X7 | Support tickets per 100 households/week | > 12 → onboarding/copy failure review |

## 12. Technical constraints (engineering contract)

Architecture set v0.2.0 (→0.3.0) is binding: stack frozen (Next.js/Vercel · FastAPI+LangGraph/ECS · Supabase · Upstash · contracts-first REST); no new vendors or runtime dependencies without ADR; all writes through `/v1`, all async through the outbox; `obligations.direction` and outcome-capture fields ship in the launch schema (A-F2/F3); freshness (`verified_at`) is a column from day one; event-sourced doctrine per A-F1; **the approvals/agent subsystem is not built** (F11 has no executor); budget: infra + model COGS ≤ $1.10/active household/mo at the M4 usage model.

## 13. Security constraints (product-visible subset; doc 12 binds in full)

Identifier-grade values only ever in `item_secrets` (write-only, last4 display, audited reveal with 15-min re-auth); Action-Kit secret substitution happens client-side at render — secrets never enter AI prompts or generated-artifact storage; documents are hostile input (scan before parse; quarantine unknown-sender email); Gmail tokens: restricted-scope, encrypted, purged on disconnect; no staff access to household data without consent-scoped support session (F17); security page + disclosure policy live at launch; one-click cancel and full export are trust features and ship as launch blockers, not fast-follows.

## 14. AI constraints

Routes frozen: classify=Haiku · extract=Sonnet (strict schemas) · hard-escalate=Opus · radar/digest reasoning=Sonnet via Batches. **No user-facing generative surface in v1** (Action Kits are deterministic templates + mail-merge; the only free-text generation is extraction-sourced titles). Extraction nodes tool-less; per-field auto-apply thresholds are eval-derived and config-deployed; every AI-created row carries `source='ai'`, confidence, and provenance; uncited dates cannot become obligations; per-household daily model budget enforced at gateway; provider fallback per ADR-006 (Bedrock-first, queue-don't-degrade for extraction); prompts versioned in-repo; model/route changes gated by the eval suite (block: classify < 97%, dates < 0.98, any canary breach).

## 15. UX principles

1. **Calm authority.** The product is the competent person in the room: plain language, no urgency theater, no gamification, no confetti. Fear is never a growth mechanic.
2. **Provenance is the interface.** Every fact shows its source; tapping a date opens the document region it came from. Trust is inspectable, not asserted.
3. **Never confidently wrong.** Below threshold → ask; above → show and allow one-tap correction. Uncertainty is rendered honestly ("we think — confirm?").
4. **The empty state is the product.** Every empty view teaches the next step and delivers reassurance ("nothing at risk this week" is a *feature*, designed, not a blank div).
5. **Ten-minute rule.** Any first-session path that can't reach a true obligation in ten minutes gets redesigned, not tooltipped.
6. **Reversible by default.** Dismiss, snooze, delete, disconnect — all undoable within grace windows; destructive = typed confirmation.
7. **Respect the register.** P1 is stretched thin and emotionally loaded. Microcopy reviewed against the register guide; "productivity" vocabulary banned.

## 16. Accessibility requirements

WCAG 2.1 AA across all surfaces (axe CI on core flows; manual audit pre-launch). Review queue and obligations inbox fully keyboard-operable (they're the power surfaces). Screen-reader-correct semantics for status/priority (never color-only). Contrast ≥ 4.5:1; text scales to 200% without loss; visible focus everywhere; motion-reduction honored; camera capture has an upload alternative; email templates pass accessible-email checks (semantic tables, alt text, ≥14px).

## 17. Performance requirements

| Surface | Requirement |
|---|---|
| API reads | p95 < 400 ms |
| App shell (LCP, p75 mobile) | < 2.5 s; INP < 200 ms |
| Document processed end-to-end | < 60 s p90 (10-page); user-visible status meanwhile |
| Gmail backfill (12 mo) | first results < 5 min; complete < 60 min p90; progressively rendered |
| Search | < 500 ms p95 |
| Reminder dispatch | 99.5% within 5 min of scheduled time |
| Availability | 99.9% (30-day) |

## 18. Analytics events (server-side from outbox; household ID hashed; no document content ever)

`signup_completed{method}` · `persona_selected{caring_for}` · `member_added{kind}` · `census_completed{items_seeded}` · `document_upload_completed{source, doc_type?}` · `alias_provisioned` · `first_forward_received` · `gmail_connected` / `gmail_disconnected{days_since}` · `gmail_backfill_completed{docs_found, docs_relevant}` · `document_processed{doc_type, confidence_band, auto_applied}` · `review_completed{action: accepted|corrected|rejected, fields_corrected}` · `obligation_created{kind, direction, source, priority}` · `obligation_resolved{via: reminder|digest|browse, days_before_due, outcome_captured}` · `obligation_snoozed|dismissed{reason?}` · `reminder_sent|opened|actioned{offset_label, channel}` · `digest_sent|opened{items_actionable}` · `action_kit_generated|downloaded{kind}` · `search_performed{result_clicked}` · `secret_revealed{field}` · `cap_reached{cap_type}` · `plan_upgraded|cancelled{plan, reason?}` · `export_requested` · `deletion_requested|undone`. Funnels: activation (M1), ingestion retention (M3), conversion (M8) are dashboard-pinned before launch; adding an event requires a metric it feeds.

## 19. Acceptance criteria (per feature; "done" = all criteria + §16/§17 applicable rows + analytics wired)

**F1 Auth:** email verify required before ingestion features; pwned-password rejection with humane copy; magic link expires 15 min, single-use; OAuth account-linking by verified email; MFA enroll/recover flows; session refresh invisible; logout kills refresh token.
**F2 Members:** create/edit/archive member; archiving hides but preserves (undo 30 d); every item/obligation attributable to exactly one member; member deletion follows doc-13 cascade with receipt.
**F3 Census:** completable in ≤ 7 min (usability-tested); every "yes" creates an `unverified` provisional item visible in registry with distinct treatment; skippable at any point without dead-ending; resumable; seeds at least one provisional obligation when any dated item is claimed (e.g., "Medicare Part B — enrollment window").
**F4 Capture:** drag-drop multi-file with per-file progress; camera flow ≤ 3 taps from home; HEIC accepted; oversize/wrong-type rejected client-side with specific copy; duplicate (same hash) short-circuits with link to existing; upload resumable on flaky mobile.
**F5 Forwarding:** alias visible + copyable + QR in settings; guided "send a test" completes CJ-2-alt; unknown-sender mail lands in quarantine with in-app accept/reject; rotation invalidates old alias immediately; forwarded multi-attachment mail creates N documents linked to one source email.
**F6 Gmail:** consent screen copy states exactly what is read and never written; scope = read-only; relevance filter runs before any document is created (target: < 20% irrelevant in backfill review); backfill review is batched, not one-by-one (accept-all-per-vendor affordance); disconnect purges tokens + unprocessed queue ≤ 60 s and confirms; token refresh failure surfaces as an in-app "reconnect" state within 24 h, never silent.
**F7 Pipeline/review:** each of the 8 types has ≥ 30 eval fixtures pre-launch and clears gate thresholds; sub-threshold extractions always route to review; review shows document + fields side-by-side with click-to-source-region; correction persists and logs to corpus; rejected documents require a reason category; unknown doc types get generic extraction + review, never silent failure; suspicious (injection-flagged) documents are visibly quarantined with plain-language explanation.
**F8 Registry:** item detail shows timeline (documents, obligations, changes) with provenance links; secret fields never render full value without explicit reveal (re-auth if session > 15 min; audit row written); item kind's attrs validated against schema version; manual item creation possible for everything (AI is an accelerant, not a gate).
**F9 Obligations:** inbox default-sorted by (priority, due date) with direction badges; entitlement items (`owed_to`) visually distinct and framed as money/value ("Deposit: $1,800 — refundable at lease end"); complete flow includes one-tap outcome capture (skippable, but skip is logged); snooze reshuffles reminder rows; dismissed obligations recoverable 30 d; recurrence spawns next occurrence on completion; every AI-sourced obligation links to its source document.
**F10 Reminders/digest:** ladders match spec per kind/priority; quiet hours respected except opted-in critical; every reminder email deep-links to the obligation and carries ICS; unsubscribe-per-kind honored ≤ 24 h; digest sends at household-local configured time ±15 min; digest renders correctly with 0, 1, and 40 items; suppression list honored absolutely.
**F11 Action Kits:** every obligation kind has ≥ 1 kit (letter or checklist); mail-merge fields visibly sourced ("from Mom's policy #···4821"); secret placeholders substituted only client-side at render/download; output as copyable text + downloadable PDF; ICS imports cleanly into Apple/Google calendar; kit content passes plain-language review (8th-grade reading level).
**F12 Search:** results grouped by type; keyboard-first (⌘K, arrows, enter); empty results suggest filters; secret values never indexed or matchable; result click-through logged.
**F13 Notifications:** matrix defaults per doc-08 spec; changes apply ≤ 60 s; in-app feed marks read state; transactional security notices non-suppressible and visually distinct.
**F14 Billing:** caps enforced server-side (gateway + API) with graceful in-product messaging *before* hard stop (80% warning); upgrade unlocks ≤ 60 s; cancel = one click → confirmation → access through period end; failed payment → 7-day grace with banner, never silent lockout; prices/plans configured, not hardcoded.
**F15 Privacy center:** export completes ≤ 24 h (target minutes) with email + signed URL (72 h TTL); zip contains originals + JSONL + audit trail; deletion sets 14-day grace with undo, then executes doc-13 cascade and emails the receipt; security page + "what we can't see" live and linked from footer + onboarding.
**F16 PWA:** installable (manifest + SW) on iOS Safari + Android Chrome; push permission requested in context (after first obligation, never at first paint); offline shows cached obligations read-only with staleness banner.
**F17 Ops console:** staff review actions attributable and audit-logged; support view requires user-granted, time-boxed consent token; rulebook entries versioned with author + evidence link; Wizard-of-Oz mode measurable (staff-completed vs auto-completed tagged in analytics).

## 20. Release checklist (G4 in checklist form; every box or no launch)

**Quality:** all §19 criteria green · eval gates green (classify ≥ 97%, dates ≥ 0.98, per-field thresholds enforced, zero canary breaches) · X-metric dashboards live with alerts.
**Reliability:** reminder SLO green 30 consecutive days in beta · deliverability warmed, DMARC at enforcement · status page public · on-call rotation + runbooks (missed-reminder postmortem process included).
**Security/privacy:** external pen test remediated · cyber insurance bound · IR tabletop done · DSR flows tested end-to-end on real accounts · subprocessor DPAs countersigned · secrets/access audit clean · CASA/Google verification complete for Gmail scope.
**Legal:** ToS + privacy policy counsel-approved · reliance disclaimers in place *and* marketing claims audited against them · 16+ gate · state privacy compliance check.
**Product:** pricing + caps final in config · cancellation one-click verified · export verified · onboarding hits ten-minute rule in 5 usability tests · accessibility audit passed · copy register review complete.
**Business:** unit-economics dashboard live (COGS/household vs $1.10 model) · support macros for §6 refusals ready · launch-wedge channel plan staffed · G3 metrics green (this checklist cannot compensate for a failed economics gate).

## 21. Change control

Amendments require: written proposal → impact on §10/§11 metrics stated → Head of Product + founder sign-off → PRD version bump with changelog. The §4.1 G1-override is pre-authorized. Everything else — including "small" additions — goes through this door. **The most likely failure mode of this document is death by a hundred reasonable exceptions; the process exists to make exceptions expensive on purpose.**
