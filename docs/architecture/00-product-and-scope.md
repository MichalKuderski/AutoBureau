# 00 — Product & Scope

## 1. Mission

Become the operating system for personal administration. Users should never need to *remember* bureaucracy — subscriptions, insurance, warranties, taxes-adjacent paperwork, medical bills, DMV and passport renewals, benefits enrollment, reimbursements, licenses, certifications, receipts. AutoBureau remembers, warns, prepares, and (with approval) acts.

## 2. Personas

| Persona | Description | Primary jobs-to-be-done |
|---|---|---|
| **The Household CFO** (primary) | 28–55, manages admin for a family. Paper arrives faster than it gets filed. | "Never miss a renewal/deadline"; "know what we're paying for"; "stop paying for zombie subscriptions" |
| **The Recent Adult** | 22–30, first apartment, first insurance, first tax season. | "Tell me what I'm supposed to do and when"; "keep my documents somewhere findable" |
| **The Caregiver** | Manages a parent's or dependent's paperwork in addition to their own. | "One place for two people's obligations"; "prove what was filed and when" |

## 3. The core abstractions

Everything in the product reduces to four nouns. These drive the data model (doc 02) and every AI workflow (doc 04):

- **Document** — a raw artifact (PDF, photo, forwarded email). Evidence, not truth.
- **Item** — a durable thing you manage: a passport, a vehicle registration, an insurance policy, a subscription, a warranty, a certification. Items have lifecycles and expiry semantics.
- **Obligation** — a dated action an item (or life) generates: *renew by*, *cancel before*, *file by*, *claim within*, *enroll during*. Obligations are the unit of value: the product exists to make sure no obligation is silently missed.
- **Task run** — an AI-assisted execution of an obligation (draft the cancellation email, fill the renewal form), always gated by an **approval** when it has external effect.

## 4. v1 scope (build this)

**Ingest**
- Upload (drag-drop, mobile camera via PWA), per-user email forwarding address, bulk import of PDFs.
- Automatic classification, structured extraction, linking to items, obligation generation — with human review when confidence is low (thresholds in doc 11 §5).

**Know**
- Household registry of items with expiry timeline ("what expires in the next 90 days").
- Obligations inbox: upcoming / action-needed / waiting / done, with snooze and dismiss.
- Subscription auditor: recurring charges detected from receipts/statements the user shares; zombie-subscription flags.
- Assistant chat: grounded Q&A over the household's documents and registry ("when does Maya's passport expire?", "what did we pay for car insurance last year?").

**Act (approval-gated)**
- Draft artifacts: cancellation emails, renewal checklists, insurance-claim letters, pre-filled PDF forms from registry data.
- Send an email the user has approved verbatim, from the user's AutoBureau alias.
- Create calendar entries (ICS download / Google Calendar via OAuth).
- Reminder engine across email / push / in-app with per-kind preferences and digests.

## 5. Explicitly out of scope for v1 (and why)

| Excluded | Why | Revisit when |
|---|---|---|
| Storing user credentials for gov/bank/utility portals | Catastrophic breach surface; also most portals prohibit it. | Phase 3+, and only via delegated OAuth or user-present co-browsing — never stored passwords (docs 12, 14) |
| Moving money (paying bills, refunds) | PCI + money-transmitter licensing + fraud surface. | Only via a licensed processor partnership |
| Tax e-filing | IRS e-file provider regulation; liability. We *organize* tax documents; we do not file. | Dedicated compliance workstream |
| Medical *advice* / bill negotiation | We track medical bills as documents/obligations; we don't interpret care or negotiate. | Partnership, not build |
| Native iOS/Android apps | PWA covers capture + notifications well enough to validate. | Post-PMF |
| B2B/teams | Consumer first. Household ≠ org; don't conflate. | Post-PMF, would fork the tenancy model deliberately |
| Autonomous browsing agents that log into third-party sites | Combines the credential problem with the injection problem. | Only with a user-present, on-device model |

The first three rows are the product's safety keel. Any roadmap pressure against them goes through a new ADR, not a sprint decision.

## 6. Success metrics

- **North star:** obligations resolved with AutoBureau's help per active household per month.
- **Activation:** signup → first document processed → first auto-created obligation, within 24h. Target ≥ 40% of signups.
- **Trust proxy:** % of AI-proposed obligations confirmed (not corrected/dismissed) by users. Target ≥ 85%; below 75% halts auto-apply (doc 11 §5).
- **Retention driver:** households with email-forwarding configured (passive ingestion predicts retention).
- **Unit economics:** LLM cost per active household per month ≤ $2.50 at consumer pricing (model in doc 14 §4).

## 7. Experience bar

"A world-class executive assistant, 24/7" translates to concrete engineering requirements:

- **Proactive, not reactive:** the weekly radar run (doc 04 §5.2) surfaces upcoming obligations before the user asks.
- **Fast where it matters:** chat first token < 1.5 s p50; document processed end-to-end < 60 s p90 for a 10-page document (SLOs in doc 10 §4).
- **Never confidently wrong:** low-confidence extractions go to a human review queue rather than silently creating wrong obligations. A wrong "your passport is fine" is worse than no answer.
- **Accessible:** WCAG 2.1 AA; the audience includes users doing paperwork *for* less-able relatives.
