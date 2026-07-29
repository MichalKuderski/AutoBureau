# G1 Readiness Checklist — 2026-08-25

The gate decides: **proceed · re-roll · pivot · stop.** Thresholds were written before any data
existed, precisely so they can't be renegotiated by whoever is most tired on the day.

Run this in order. Section 1 is not a formality — a decision made on insufficient data isn't a
decision, it's a coin flip with extra steps.

---

## 1. Can we decide at all? (data-sufficiency gate)

| # | Requirement | Minimum | Actual | ✅ |
|---|---|---|---|---|
| 1.1 | Households onboarded | ≥18 (target 25) | | |
| 1.2 | Households with ≥3 weeks elapsed since onboarding | ≥15 | | |
| 1.3 | Merged screening/interview calls held | ≥40 | | |
| 1.4 | Interviews per segment | ≥12 in the leading segment | | |
| 1.5 | Card asks made (≥ day 30) | ≥12 | | |
| 1.6 | Landing-page card-intent sessions | ≥300 across variants | | |
| 1.7 | Evidence records promoted to the registry | ≥25 | | |
| 1.8 | A- or B-grade evidence exists for H1 **and** H2 | both | | |

**If fewer than six of these pass → EXTEND, do not decide.** Add two weeks, keep the cohort running,
and record the extension as a decision. A thin verdict is worse than a late one: it burns the option
to re-roll, because you'll have spent the credibility of the gate.

## 2. The verdict (pre-committed thresholds)

| Hypothesis | Metric | Kill | Proceed | Actual | Verdict |
|---|---|---|---|---|---|
| **H1** | Week-3 forwarding retention | **<40%** | **≥50%** | | |
| **H2** | Card conversion at day 30 | **<25%** *(with H1 failing)* | **≥25%** | | |
| **H3** | Leading segment on (pain × commitment) | no separation | clear leader | | |
| H7 | Unaided ingestion setup | <50% | ≥50% | | |
| H11 | Probe response rate | <30% | ≥30% | | |
| H8 | Hours per vendor (if the spike ran) | >4h sustained | ≤4h | | |

**Between 40–50% on H1** is the honest middle: not dead, not proven. Treat as *re-roll*, not proceed.

## 3. Decision tree

```
H1 ≥50%  AND  H2 ≥25%           → PROCEED    · wedge confirms · PRD §4.1 clause self-deletes
                                             · engineering starts the walking skeleton
H1 40–50%  OR  H2 15–25%        → RE-ROLL    · one only · 4 weeks · single wedge · sharper offer
H1 ≥50%  AND  H2 <15%           → PIVOT      · demand is real, the model isn't
                                             · test: found-money share · B2B2C · annual-only
H1 <40%  AND  H2 <25%           → STOP       · the behavior thesis failed
                                             · this is the graveyard pattern; take the answer
one wedge pulls, shape doesn't  → RE-ROLL on that wedge only
data insufficient (§1)          → EXTEND two weeks
```

## 4. If a kill threshold is crossed before August 25

Do not wait for the date. Same day: log it in the decision journal, notify anyone affected, convene
the gate early. The calendar serves the decision, not the other way round.

## 5. Decision protocol on the day

1. **Numbers before narrative** (60 min alone). Fill §1 and §2 from the CRM, events sheet, and
   registry. No interpretation yet.
2. **Read the decline reasons and the "what would make you stop" answers aloud.** Verbatim, all of
   them. This is the step most likely to change your mind, which is why it's mandatory.
3. **Apply §3 as written.** If you want to override the tree, write the override and its
   justification in the journal *first* — then decide. Overriding is permitted; overriding
   silently is not.
4. **Record the decision** (`ops/decision-journal.md`), including the evidence, the assumptions
   affected, and the expected outcome with a review date.
5. **Update the registry** to final G1 state; confidence and status for every hypothesis touched.
6. **Communicate**: households (either "we're continuing" or a graceful wind-down with their data
   returned), and any investors or advisors owed an update.

## 6. Whatever the verdict

- [ ] Every household has their ledger returned in readable form.
- [ ] Every household's documents deleted from the service inbox and drive, confirmed in writing.
- [ ] Exit interviews complete for anyone leaving.
- [ ] Registry reflects final state; dashboard regenerated.
- [ ] Decision journal entry written, with the review date set.
- [ ] Blueprint P1 either starts (proceed) or is formally paused (everything else).

**On stopping:** it is the correct outcome roughly half the time, and the point of spending four
weeks and a spreadsheet instead of a year and a seed round. A clean stop with returned data and
honest communication is a better founding story than a slow decline.
