# Assumption Ledger — v2 (Governing Document)

**Status:** governing document, peer to the PRD and blueprint · **Upgraded:** 2026-07-28
**Purpose:** every incoming piece of evidence updates numbered hypotheses, not vibes. The dashboard (§1) is the founder's homepage before every planning meeting — rendered copy published as a live page; this file is the source of truth.

---

## 1. Dashboard (regenerated on every ledger update)

**As of 2026-07-28 · Next gate: G1 (validation sprint verdict) ~Aug 25, 2026 · Evidence drops since inception: 1**

### 🔴 Top 5 highest-risk (cost of being wrong × weakness of evidence)
| Rank | H | Why it tops the list |
|---|---|---|
| 1 | **H1** ingestion behavior | Existential cost, zero primary evidence, killed every ancestor company |
| 2 | **H2** willingness to pay | Existential cost, precedent negative, tested only by proxy so far |
| 3 | **H7** forwarding as workable channel | High cost, already weakened twice by analysis, G1-testable |
| 4 | **H8** rulebook tractability | High cost — the moat thesis rests on it; spike not yet run |
| 5 | **H11** reminders keep the ledger fresh | High cost — if wrong, we die the PKM entropy death regardless of everything else |

*(Watch-list adjacent: H15 — Rocket Money clock — high cost but externally driven; monitored, not testable.)*

### 🟡 Top 5 weakest evidence (no primary data yet)
| Rank | H | Current basis |
|---|---|---|
| 1 | H1 | Analogy + graveyard only |
| 2 | H2 | Precedent + one competitor price anchor (Ohai $9.99°) |
| 3 | H5 doc volume | A panel estimate contradicting our own model |
| 4 | H7 | Analysis only; friction test not yet run |
| 5 | H3 caregiver wedge | Expert preference + adjacent-company existence; zero interviews completed |

### 🔵 Top 5 most-moved since inception (2026-07-22 priors)
| Rank | H | Movement | Mover |
|---|---|---|---|
| 1 | H10 B2B2C bank channel | ↑↑ (low → high) | Live verification: Trustworthy/Q2°, Carefull°, Everplans channel patterns |
| 2 | H7 forwarding-primary | ↓↓ (assumed → doubted) | Red-team A-B1 argument + ancestor ingestion failures |
| 3 | H5 20 docs/mo | ↓ | Panel re-estimate (3–8 realistic) |
| 4 | H9 found-money shareability | ↑ | Rocket precedent + entitlements reframe |
| 5 | H2 WTP | → but re-anchored | Ohai $9.99° gives the first adjacent real price point |

*Honest caveat: the ledger is 6 days old; "most-moved" becomes meaningful after G1. Movement so far is analysis-driven, not user-driven — exactly what the P0 sprint fixes.*

### Planning-meeting ritual (read before every planning session)
1. Did anything this week produce evidence on H1, H2, H7, H8, or H11? If no — why did the week's work not touch a top-risk assumption?
2. Any hypothesis stale > 60 days? (Currently: none — clock started 07-22.)
3. Are we shipping features or retiring risks?

---

## 2. Updating rules (unchanged from v1)

1. **Hierarchy:** observed behavior > paid behavior > stated intent > expert opinion > priors.
2. **Asymmetric updating:** disconfirming evidence moves confidence more than confirming evidence of equal weight.
3. **Sample honesty:** n recorded; anecdotes move nothing — except X1-class trust failures, which are signal at n=1 by design.
4. **Routing:** threshold crossings open the linked artifact's documented amendment door (PRD §21, ADR process, blueprint gates); evidence never silently edits frozen documents.
5. Every update names: hypotheses moved (± why), roadmap consequence (or "none"), amendments proposed (or "none"), and appends to the Evidence Log.

## 3. Hypothesis register

> **Moved.** The register is now machine-readable and lives in **[`ops/assumptions.yaml`](assumptions.yaml)** —
> the single source of truth for every hypothesis's category, cost-of-wrong, confidence,
> status, owner, experiment, dates, evidence entries, and links to PRD sections and
> decision records.
>
> It is schema-validated in CI (`ops/schema/assumptions.ts`, `ops/tests/assumptions.test.ts`),
> which also enforces the invariants that matter under pressure: every existential
> assumption carries a kill threshold, nothing claims high confidence without evidence,
> nothing claims "supported" on our own reasoning alone, and the existential pair (H1
> ingestion, H2 willingness-to-pay) cannot be quietly downgraded.
>
> This document keeps the *narrative*: updating rules (§2), cadence (§4), and the
> chronological evidence index (§5). The dashboard renders from the YAML.
>
> Editing rule: change the YAML, run `pnpm --filter @autobureau/ops test`, then append a
> row to §5 and regenerate the dashboard.

## 4. Review cadence

- Ledger + dashboard regenerated on every evidence drop and at every gate (G1–G5).
- Monthly incumbent-watch updates H15 (and any competitor-sensitive hypothesis).
- Staleness rule: any hypothesis untouched 60 days → flagged at the next planning meeting (either we're not measuring what matters, or it stopped mattering — decide which).
- Dashboard "most-moved" list is computed against inception priors until G1, then against rolling 60-day windows.

## 5. Evidence Log — chronological index (append-only)

Per-assumption evidence entries live in `assumptions.yaml`; this table is the
chronological view of *drops* — what arrived, what it moved, what it changed.

| Date | Source (class, n) | Hypotheses moved | Consequence | Amendments proposed |
|------|-------------------|------------------|-------------|---------------------|
| 2026-07-28 | Live competitive research (secondary, market-level) | H10 ↑↑ (bank channel live-verified°) · H2 → re-anchored (Ohai $9.99°) · H15 baselined (Tier-1, 18–24 mo) | Moat directive affirmed; no roadmap change | none |
| 2026-07-28 | Governance change (not evidence): ledger upgraded to v2 — categories, cost-of-wrong, owners, validation dates, dashboard | — | Dashboard becomes pre-planning homepage | none |
| *(next: G1 sprint data)* | | | | |
