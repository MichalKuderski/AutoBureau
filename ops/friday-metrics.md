# Friday Metrics — the 15 minutes that decide whether the week counted

Compute in this order. Formal definitions live in `docs/product/learning-dashboard-spec.md` §5 and
are not restated here — this is the *worksheet*, not the dictionary.

Everything comes from two files: the CRM and the events sheet. If a number can't be computed, that
is a finding about instrumentation, not a reason to estimate.

---

## 1. Operational — is the machine running?

| Metric | Source | This week | Watch |
|---|---|---|---|
| Households onboarded (cumulative) | CRM `onboard_date` | | **The day-12 line.** Behind → outreach is the only priority |
| Outreach sent / replies / calls held | CRM touches | | Funnel health; ratios tell you which stage is broken |
| Documents received | events sheet | | |
| Service minutes per household | events sheet | | >30/wk means the service doesn't scale even manually |
| Median minutes per document | events sheet | | Prices what automation is worth (feeds H14) |
| Response SLA breaches | events sheet | | Any breach = the service isn't credible; fix before growing |
| Silent households (>10 days) | CRM `last_inbound_date` | | Not a failure to chase — an H1 reading |

## 2. Learning — did we get smarter?

| Metric | Source | This week | Watch |
|---|---|---|---|
| Evidence records logged | evidence log | | |
| Records promoted to the registry | evidence log `promoted` | | |
| **Learning velocity** (A=4, B=3, C=2, D=1) | evidence log grades | | Trend matters more than level |
| Evidence portfolio (% A or B) | evidence log | | Must rise monthly or we're theorizing |
| Hypotheses moved this week | registry diff | | **Zero = the week failed.** Write why. |
| Days since H1 last moved / H2 last moved | registry | | Either >14 → the schedule is wrong |
| Interviews completed (by segment) | CRM | | Need ~20/segment before H3 is decidable |

## 3. Business — would anyone pay?

| Metric | Source | This week | Watch |
|---|---|---|---|
| Card asks made / cards given | CRM `card_result` | | The **only** behavioral H2 evidence |
| Decline reasons (verbatim) | CRM `decline_reason` | | Read them aloud. Patterns here beat any survey |
| Landing page: visits → waitlist → card-intent, by variant × price | LP analytics | | Fear vs greed vs relief; $6 / $12 / $99yr |
| Stated bargain price (median, by segment) | CRM `wtp_bargain_price` | | Compare to card-intent — the gap is the finding |
| Found value surfaced ($) | events sheet | | H9; also the shareable moment |
| Referrals given | CRM | | Cheapest signal of real enthusiasm |

## 4. Assumption — what do we now believe?

| Metric | Source | This week | Watch |
|---|---|---|---|
| **Week-N forwarding retention** (the H1 gate metric) | CRM `docs_wk*` | | Kill line **40%**, proceed line **50%** |
| Reminder action rate | events sheet | | Are reminders *useful*, or merely delivered? |
| **Probe response rate** | CRM `probes_*` | | H11 — the self-maintaining ledger. Below ~30% and the thesis has a hole |
| Census surprise rate | CRM `census_surprises` | | The core product moment; trending to zero = front-loaded value |
| Confidence per hypothesis | registry | | |
| Assumptions with kill thresholds crossed | registry | | **Any → stop the Friday review and open the decision journal** |

---

## The three questions to answer in writing

1. **Did any hypothesis move?** If no — why did the week's work not touch one?
2. **What's the binding constraint next week**, in one sentence?
3. **Is anything within one week of a kill threshold?** If yes, say what we do if it crosses.

Then update: `assumptions.yaml` → ledger evidence log → dashboard snapshot → decision journal.
