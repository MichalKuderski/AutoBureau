# Concierge Operations Manual

The concierge service *is* the product this month, delivered by humans. Households get real value; we get the only A-grade evidence available.

**Two operating truths.** First: everything here is disposable — none of it becomes software.
Second: the service must feel like a product, not like a founder's inbox. A reminder that reads as a
personal favor tests a different hypothesis than the one we're measuring.

**Roles.** OPS runs the service day to day. FOUNDER runs conversations and owns the evidence.
Where they overlap, OPS owns delivery and FOUNDER owns learning.

---

## 1. Setup (once, day 1–2)

- Service inbox `concierge@`, with per-household aliases `concierge+h{NN}@` — free routing, no tooling.
- **Household ledger sheet:** one tab per household, columns mirroring the real schema —
  `member · item · obligation · direction (owed_by / owed_to) · due date · priority · source doc ·
  status · outcome`. Keeping this shape is free schema validation and makes migration trivial.
- **Events sheet:** `date · household · event · minutes · notes`. Events:
  `doc_received · reminder_sent · reminder_actioned · correction · question · found_value`.
  This sheet is the analytics pipeline; if it isn't logged, it didn't happen.
- Reminder templates (T-30 / T-14 / T-7 / T-1) written once, reused verbatim.

## 2. Onboarding SOP (45-minute call, recorded with consent)

| # | Step | Time | Notes |
|---|---|---|---|
| 1 | Consent + framing | 3 min | "Human-powered today, software soon. We're proving what's worth building." Never imply an app exists. |
| 2 | Household map | 5 min | Who are we managing for? Self, parent, both. Capture members. |
| 3 | **Census** | 20 min | The intake checklist below, read aloud as prompts, not as a form. |
| 4 | First document | 5 min | Get one document forwarded **during the call**. This is the activation moment; do not end the call without it. |
| 5 | Expectations | 5 min | Sunday digest, reminders as deadlines approach, reply anytime. |
| 6 | Alias test | 5 min | Have them send a test forward from their own mail client while you're on the line. |
| 7 | Close | 2 min | "In 30 days I'll ask whether this is worth paying for." Set the expectation early so the ask isn't a surprise. |

**Log immediately:** census duration, items found, **items they were wrong about** (thought it was
handled, wasn't), and whether step 4 succeeded unaided.

## 3. Household intake checklist (the census)

Read as conversation. Tick what exists; note renewal dates when known.

**Identity & travel** — driver's licence / state ID · passport(s) · REAL ID status · Global Entry/TSA
**Vehicles** — registration(s) · title · auto insurance · loan or lease · inspection/emissions
**Home** — lease or mortgage · homeowners/renters insurance · HOA · utilities (electric, gas, water,
internet, phone) · security deposit held
**Health** — health insurance · Medicare/Medicaid (parts A/B/D, supplemental) · dental/vision ·
recent bills or EOBs · prescriptions requiring renewal
**Money & benefits** — life insurance · disability · pension/annuity · Social Security · FSA/HSA ·
open-enrollment window
**Legal & estate** — power of attorney · advance directive · will/trust · guardianship
**Subscriptions** — streaming · memberships · software · anything auto-renewing they can name
**Warranties** — appliances · electronics · vehicle · home systems
**Caregiving-specific** — whose accounts do you have access to, and how? What are you *not* able to
see? (This question surfaces the authority problem and produces H12 evidence.)

Close with: **"What worries you most that we haven't listed?"** — the highest-yield question in the
script.

## 4. Document intake workflow

```
inbound (forward / photo / attachment)
  → acknowledge within 4 business hours (template, one line)
  → classify by hand → extract fields into the household ledger
  → derive obligations (dates, windows, entitlements)
  → log: doc_received + minutes spent
  → if it reveals something they didn't know → log a `surprise`, and tell them
```

Rules: process within 24 hours, always. **Record identifier-grade values as last-4 only** — never
transcribe a full passport, SSN, or account number into a spreadsheet (this rehearses the real
`item_secrets` discipline and is simply correct). If a document is unreadable, ask for a re-send with
one specific instruction ("a photo of the top third, in daylight"), never a generic "please resend".

## 5. Communication standards

The voice is the product. Every message is **calm authority**: plain, brief, specific.

- **Never manufacture urgency.** "Due in 30 days, here's the one step" — not "URGENT: don't lose your
  licence!" Fear is banned as a mechanic (FOUNDING_PRINCIPLES §4).
- **Lead with the action**, then the context. One deadline per message.
- **Always name the source:** "from the renewal notice you forwarded on the 12th."
- **Never guess a date.** If we're unsure, we say we're checking. A confidently wrong date is the
  fastest way to destroy the premise we're testing.
- No jargon, no emoji, 8th-grade reading level, under 120 words.
- Response SLA: 4 business hours for anything; same day for anything with a date inside 7 days.

## 6. Weekly touchpoints

| When | What | Purpose |
|---|---|---|
| **Sunday 17:00 local** | Digest: "N need attention · N handled · nothing at risk" | The retention instrument. Must be useful when empty — say what's on the horizon. |
| As dated | Reminder ladder T-30 / T-14 / T-7 / T-1 | The core value delivery |
| Every 14 days | **Found-value hunt** — one per household: expiring warranty, refundable deposit, unused subscription, unclaimed benefit | Tests H9 and produces the shareable moment |
| Every digest | One **freshness probe** — "is this still true?" on one aging fact | Tests H11 directly; this is the mechanism the whole ledger thesis rests on |

## 7. Reminder workflow

1. Schedule the ladder when the obligation is created (not when it's near).
2. Send from the service inbox, templated, with the deep context inline.
3. Log `reminder_sent`.
4. Watch for a reply or a stated action → log `reminder_actioned` with days-before-due.
5. No response by T-1 on a **priority-1** obligation → phone call. This is a real service; a lapsed
   registration on our watch is a company-level failure of the thing we claim to do.
6. After the deadline: log the outcome, including "they handled it without us."

## 8. Escalation

| Situation | Action | Owner |
|---|---|---|
| Priority-1 deadline inside 72h, no response | Phone call, then text | OPS |
| We gave a wrong date or missed a reminder | **Immediate correction to the household, same day**, plainly stated. Log as an X1-class trust failure — signal at n=1 — and tell FOUNDER today. | OPS → FOUNDER |
| Household asks for something out of scope (pay a bill, log into a portal, give advice) | Use the "not yet, and here's why" script. Log the request — repeated asks are roadmap evidence. | OPS |
| Household shares a credential unprompted | Do not store it. Tell them we don't hold credentials, delete the message, confirm deletion. | OPS |
| Distress, medical or legal crisis | Stop the service framing. Be a person. Point to real help. Never improvise advice. | OPS → FOUNDER |
| Household goes silent 10+ days | Silence protocol (§9) | OPS |

## 9. Silence protocol (the H1 instrument)

Silence is not a failure to chase — it *is* the measurement. Handle it deliberately:

- Day 10: one light touch ("anything I should be watching for you?").
- Day 17: one more, different angle — offer to do something specific for them.
- Day 24: stop touching. Mark dormant. **Do not rescue the number.**

Chasing a household into forwarding one document to protect a metric corrupts the only evidence
that matters. Record dormancy honestly; it is the answer to H1, not an operational embarrassment.

## 10. Offboarding

Triggered by: request, dormancy through the sprint, or sprint end.

1. Exit interview — 20 minutes (script in `ops/p0/interview-guide.md`), always including
   **"what would make you stop using this?"**
2. The card ask if not already made (day 30+).
3. Hand back their data: send the household ledger as a readable document. They gave us four weeks;
   they keep the work.
4. Delete their documents from the service inbox and drive; confirm in writing.
5. Referral ask: "who's the most organized *and* most drowning person you know?"
6. Log final state in the CRM and file an evidence record.
