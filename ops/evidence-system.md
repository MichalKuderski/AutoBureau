# Evidence Collection System

Every observation that could move a hypothesis becomes a record. Records are cheap and continuous;
**promotion** into `ops/assumptions.yaml` is deliberate and weekly. Log first, judge on Friday.

Template: `ops/templates/evidence-log.csv`.

---

## The record

| Field | Values | Notes |
|---|---|---|
| `evidence_id` | `E-001` | Referenced from the CRM and the registry |
| `date` | ISO date | The day observed, not the day logged |
| `observation` | one sentence, factual | **What happened**, not what it means. "Forwarded 3 documents unprompted in week 2" — not "seems engaged." |
| `assumptions` | `H1` · `H1;H7` | Which hypotheses this bears on. Blank means it doesn't belong here. |
| `evidence_class` | `behavioral \| paid \| stated \| expert \| secondary \| prior` | Strongest first (FOUNDING_PRINCIPLES §10) |
| `n` | integer or blank | Sample size. Blank only for desk research. |
| `direction` | `supports \| weakens \| neutral` | Against the named hypotheses |
| `grade` | `A \| B \| C \| D` | Rubric below. Assigned Friday, not at capture. |
| `confidence_impact` | `strong \| moderate \| slight \| none` | How much it *should* move the registry |
| `source_ref` | `P-007`, `LP-variantB`, URL | Pseudonymous IDs only — **never a name** |
| `next_action` | one line, or `none` | The point of the record |
| `promoted` | `yes \| no \| pending` | Whether it reached `assumptions.yaml` |

## Grading rubric

| Grade | Criteria | Typical source |
|---|---|---|
| **A** | Behavioral or paid, n≥20, representative | Week-3 forwarding across 25 households |
| **B** | Behavioral or paid, n<20; or stated with n≥20 | 8 card conversions; 22 interviews agreeing |
| **C** | Stated with n<20; or expert judgment | One person's WTP claim; a panel's view |
| **D** | Secondary research, precedent, our own reasoning | Competitor pricing; the graveyard analysis |

**The rule that keeps us honest:** a hypothesis whose best supporting evidence is C or D is
**unsupported**, whatever confidence we've written next to it. The registry's tests enforce a
version of this; the dashboard shows it; do not argue with it at the gate.

## Capture rules

1. **Within the hour.** Notes written after lunch are reconstruction, and reconstruction flatters.
2. **Observation and interpretation are different columns.** If you can't state it without an
   adjective, you're logging a feeling.
3. **Log disconfirming evidence first** when a session produces both. It is the evidence most likely
   to evaporate by Friday.
4. **One record per observation**, not per conversation. A 30-minute call often yields three.
5. **Silence is an observation.** "P-014: no inbound for 17 days despite two touches" is A-grade H1
   evidence and must be logged like any other.
6. **Never a name.** `source_ref` takes participant IDs; the CRM is the only file that maps back.

## Weekly promotion (Friday, 20 minutes)

1. Grade every ungraded record from the week.
2. Group by hypothesis.
3. For each affected hypothesis, ask: *does this change confidence, status, or neither?*
   - Use the asymmetry: disconfirming evidence moves further than confirming evidence of equal grade.
   - n<3 informs but does not move — **except** a trust/accuracy failure, which moves at n=1.
4. Write the surviving evidence into `ops/assumptions.yaml` as entries under the hypothesis
   (`date`, `source`, `evidence_class`, `n`, `direction`, `note`), and adjust
   `confidence` / `confidence_trend` / `status`.
5. Run `pnpm --filter @autobureau/ops test`. It will refuse structural rot — for example, claiming
   `supported` on prior-only evidence.
6. Mark records `promoted`. Append one row to the ledger's evidence log.
7. If a **kill threshold** was crossed, stop. That is not a Friday item — open the decision journal
   now (`ops/g1-readiness.md` §4).

## Worked example

> **Observed Tuesday.** On a screening call, a caregiver says she'd "absolutely pay" for this,
> then mentions she cancelled a $9/month photo-storage subscription last week to save money.

Two records, not one:

| id | observation | assumptions | class | n | direction | grade | impact | next_action |
|---|---|---|---|---|---|---|---|---|
| E-021 | P-011 stated she would pay for the service | H2 | stated | 1 | supports | C | slight | none — stated intent, await card ask |
| E-022 | P-011 cancelled a $9/mo subscription for cost reasons last week | H2 | behavioral | 1 | weakens | C | moderate | Ask the day-30 card question at $9, not $12 |

The stated enthusiasm is the weaker signal. Recording only the first line is how a founder talks
themselves into a price.
