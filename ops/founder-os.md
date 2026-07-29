# Founder Operating System — the four weeks to G1

**Your job this month:** move H1 (will they feed the ledger?) and H2 (will they pay?) off
`untested`. Nothing else counts. This document is the daily driver; everything else in `ops/` is a
reference you open when the schedule sends you there.

**The one number that governs the schedule:** every household onboarded by **day 12**, or week-3
forwarding — the metric G1 turns on — cannot be measured in time.

---

## 1. The daily shape

Two protected blocks, two short hygiene windows. Roughly 6 hours of real work; the rest is slack you
will need.

| Time | Block | What happens |
|---|---|---|
| 09:00–11:30 | **Conversations** (protected) | 3–4 merged screening/interview calls, 30 min each, 10 min notes between. Never move this block; it is the only source of A-grade evidence. |
| 11:30–12:00 | **Evidence capture** | Log every call to the evidence sheet *while it is fresh*. Notes written after lunch are already fiction. |
| 13:00–15:00 | **Funnel + service** | Outreach batch (30–40 touches), reply to inbound, review the operator's queue, unblock. |
| 15:00–15:30 | **CRM hygiene** | Update pipeline stages. Anything stale >5 days gets chased or killed. |
| Anytime | Buffer | Onboarding calls (45 min) get scheduled here as they book. |

**Rules that protect the schedule**
- No product design, no code review, no architecture discussion Monday–Thursday. It will feel
  productive; it is the highest-quality way to fail this month.
- If a day gets destroyed, protect the conversation block and sacrifice everything else.
- Weekends off. Founder exhaustion is a named risk (R8), and a burned-out founder in week 3 loses
  the measurement week.

## 2. The weekly cadence

| Day | Focus |
|---|---|
| **Mon** | 30-min review (below), set the week's single target |
| Tue–Thu | Execution: calls, outreach, onboarding, service oversight |
| **Fri** | 60-min review (below): metrics, evidence promotion, registry update, decision journal |
| Sat/Sun | Off |

## 3. Monday review — 30 minutes, alone

Open `ops/dashboard.html` and the CRM. Answer four questions in writing (three lines each, in the
decision journal if any answer implies a choice):

1. **Are we on the day-12 line?** Households onboarded vs. the number needed. If behind, today's
   only priority is outreach volume.
2. **What is this week's single target?** One number, not a list. Week 1: "12 onboarded." Week 3:
   "week-3 forwarding measured for all 25."
3. **What did last week teach that changes this week?** If nothing, say so plainly — that is a
   finding about the instruments, not a formality.
4. **What am I doing that isn't H1 or H2?** Stop it, or say why it survives.

## 4. Friday review — 60 minutes, the week's most important hour

Run in this order; the order matters because each step feeds the next.

1. **Metrics (15 min)** — compute the Friday dashboard (`ops/friday-metrics.md`). Numbers first, so
   the narrative has to fit the data rather than the reverse.
2. **Evidence promotion (20 min)** — walk the week's raw observations
   (`ops/templates/evidence-log.csv`), grade each, and promote anything that moves a hypothesis into
   `ops/assumptions.yaml` as an evidence entry.
3. **Registry update (10 min)** — adjust confidence and status for affected hypotheses. Run
   `pnpm --filter @autobureau/ops test`. Append one row to the ledger's evidence log. Update the
   dashboard snapshot.
4. **Decisions (10 min)** — anything decided this week gets a decision-journal entry. If nothing was
   decided, that is worth noticing.
5. **Next week's constraint (5 min)** — one sentence: what will limit us, and what you'll do about it.

**The Friday test:** if no hypothesis moved this week, the week failed — regardless of how busy it
was. Write down why, out loud, in the journal.

## 5. Evidence review process

Two tiers, deliberately. Raw capture is cheap and continuous; promotion is deliberate and weekly.

```
during the week   →  raw observation logged within the hour (evidence-log.csv)
Friday            →  graded (A–D), assigned to hypotheses, promoted to assumptions.yaml
gate weeks        →  registry drives the G1 decision
```

**Promotion rules** (from `FOUNDING_PRINCIPLES` §10 and the ledger's updating rules):
- Behavior beats payment intent beats stated intent beats expert opinion beats our priors.
- Disconfirming evidence moves confidence further than confirming evidence of equal weight.
- `n` travels with every entry. Anecdotes (n<3) inform but do not move confidence — *except* a
  trust or accuracy failure, which is signal at n=1 by design.
- Nothing gets promoted the same day it is observed. Enthusiasm is not a grade.

## 6. Decision cadence

| Decision type | When | Where recorded |
|---|---|---|
| Operational (who to call, what to send) | Continuously | Nowhere — just do it |
| Tactical (change a script, drop a channel, adjust an offer) | Friday review | Decision journal, one entry |
| Strategic (wedge, pricing, scope, kill/pivot) | Gates only — **G1 on Aug 25** | Decision journal + amendment process |

**The rule that protects the month:** strategic decisions are not made on Tuesday because a call went
badly. Log the observation, let it accumulate, decide at the gate. Three enthusiastic calls are not
a pivot signal; neither are three bad ones.

## 7. Assumption update cadence

- **Weekly (Friday):** confidence and status for anything touched by the week's evidence.
- **On threshold crossing:** immediately — a kill threshold breached is not a Friday item. Open the
  journal, name the amendment door (PRD §21, an ADR, or a gate decision), and follow it.
- **Every 60 days:** anything untouched gets flagged. Either we stopped measuring what matters or it
  stopped mattering; decide which and record it.

## 8. Where everything lives

| Need | File |
|---|---|
| Run the service | `ops/concierge-operations.md` |
| Track a person | `ops/participant-crm.md` + `ops/templates/participants.csv` |
| Log an observation | `ops/evidence-system.md` + `ops/templates/evidence-log.csv` |
| Friday numbers | `ops/friday-metrics.md` |
| The gate | `ops/g1-readiness.md` |
| Record a decision | `ops/decision-journal.md` |
| Interview script | `ops/p0/interview-guide.md` |
| Landing pages | `ops/p0/landing-copy.md` |
| What we believe | `ops/assumptions.yaml` |
