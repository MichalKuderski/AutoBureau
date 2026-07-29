# Participant CRM — specification

One spreadsheet, one row per person, from first outreach to final state. Import
`ops/templates/participants.csv` into Sheets and start today.

**The privacy split, and it is not optional.** This sheet holds contact details because you must
actually email people. **Every other artifact — evidence log, metrics, dashboard, registry — uses
`participant_id` only.** Names never leave this file. If a person asks to be deleted, this is the one
place you have to look.

---

## Pipeline stages

```
sourced → contacted → responded → screened → qualified → onboarded → active
                ↘ no_response      ↘ declined     ↘ disqualified      ↘ dormant → converted
                                                                              ↘ churned
```

| Stage | Means | Exit rule |
|---|---|---|
| `sourced` | Identified, not yet contacted | Contact within 3 days or drop |
| `contacted` | Outreach sent | No reply in 7 days → `no_response` |
| `responded` | Replied, call not yet held | Schedule within 5 days |
| `screened` | Merged screening/interview call held | Always produces an evidence record |
| `qualified` | Fits a segment, has ≥5 admin items, willing to forward | Offer onboarding |
| `disqualified` | Doesn't fit — still valuable interview data | Terminal; evidence kept |
| `declined` | Offered, said no | Terminal; **log the reason — this is H2 evidence** |
| `onboarded` | Census complete, first document received | → `active` |
| `active` | Forwarding documents | Silence 24 days → `dormant` |
| `dormant` | Silent through the protocol | Counts against H1. Do not rescue. |
| `converted` | Gave a card at day 30 | The H2 datum |
| `churned` | Asked to stop | Terminal; exit interview required |

## Fields

**Identity & routing** (this file only)
| Field | Type | Notes |
|---|---|---|
| `participant_id` | `P-001` | The only ID used anywhere else |
| `name` · `email` · `phone` | text | Never copied out of this sheet |
| `alias` | text | `concierge+h07@` once onboarded |
| `segment` | `caregiver \| visa \| generalist` | Drives the H3 comparison |
| `source` | `network \| community \| referral \| landing_page \| other` | Which channel actually works (feeds CAC thinking) |
| `referred_by` | `participant_id` | Referral tracking |

**Outreach**
| Field | Type | Notes |
|---|---|---|
| `stage` | enum above | The one field that must always be current |
| `first_contact_date` · `last_touch_date` | date | Anything untouched >5 days gets chased or killed on Tuesday |
| `touch_count` | int | Outreach effort per conversion, by channel |

**Interview** (from `ops/p0/interview-guide.md` scoring)
| Field | Type |
|---|---|
| `interview_date` | date |
| `pain_severity` · `pain_frequency` · `current_spend` · `workaround_effort` · `wtp_signal` · `commitment` · `access` | 1–5 |
| `wtp_bargain_price` | dollars — their "this is a bargain" number |
| `quote` | one verbatim line — the copy-harvest seed |
| `evidence_id` | link to the evidence record |

**Onboarding**
| Field | Type | Notes |
|---|---|---|
| `onboard_date` | date | **The day-12 line is measured on this column** |
| `census_minutes` · `census_items` | int | How long intake takes, how much standing exists |
| `census_surprises` | int | Items they were wrong about — the product's core moment |
| `first_doc_unaided` | bool | Did they forward without hand-holding? **Direct H1/H7 evidence.** |

**Engagement** (the H1 instruments)
| Field | Type | Notes |
|---|---|---|
| `docs_wk1` … `docs_wk4` | int | Documents received per week |
| `last_inbound_date` | date | Drives the silence protocol |
| `reminders_sent` · `reminders_actioned` | int | Reminder action rate |
| `probes_sent` · `probes_answered` | int | **H11** — freshness probes |
| `found_value_usd` | dollars | H9 |
| `service_minutes_total` | int | Effort economics → H14 |

**Payment** (the H2 instruments)
| Field | Type | Notes |
|---|---|---|
| `card_ask_date` | date | Must be ≥ day 30 |
| `card_result` | `gave \| declined \| deferred \| not_asked` | |
| `card_price_offered` | dollars | Which price they actually faced |
| `decline_reason` | text | **The most valuable free-text field in the sheet** |

**Close-out**
| Field | Type |
|---|---|
| `exit_date` · `exit_reason` · `stop_using_answer` | date / text / text |
| `referrals_given` | int |
| `notes` | text |

## Weekly hygiene (Tuesday, 30 minutes)

1. Every `contacted` row older than 7 days → `no_response`.
2. Every `responded` row without a scheduled call → schedule or drop.
3. Every `active` row with `last_inbound_date` >10 days → silence protocol.
4. Recompute funnel conversion by `source` — kill the channel that isn't producing.
5. Confirm `onboard_date` count against the day-12 line.
