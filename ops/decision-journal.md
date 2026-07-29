# Founder Decision Journal

Every decision that would be expensive to reverse gets an entry — **written before or at the moment
of deciding, never reconstructed afterwards.** The purpose is auditability: in six months you need to
know not just what you chose but what you knew, so you can tell a bad decision from bad luck.

**What earns an entry:** anything strategic (wedge, pricing, scope, kill/pivot), anything that
amends a governing document, anything overriding a pre-committed threshold, and any tactical change
to how we're learning. Operational choices do not.

**Format rules:** one screen. Expected outcome must be falsifiable and dated. Confidence is recorded
so calibration can be checked later.

---

## Template

```markdown
### D-0NN · <decision in one line>
**Date:** YYYY-MM-DD · **Type:** strategic | tactical | amendment | override
**Decision:** what we are doing, stated so someone could execute it without asking.
**Alternatives rejected:** the two or three real ones, one line each.
**Evidence:** E-0xx records / metrics / documents. Grades stated. If the honest answer is
"none, this is judgment", write that — it is a valid basis, and knowing it later matters.
**Assumptions affected:** H-ids, and how (confidence up/down, status change, new assumption).
**Expected outcome:** falsifiable, with a date. "By Sep 15, X will be true."
**Confidence:** low | medium | high
**Review date:** YYYY-MM-DD
**Reversal cost:** low | medium | high — what it takes to undo.
**Outcome (filled at review):** what actually happened. Right for the right reasons?
```

---

## Log

### D-001 · Freeze the caregiver wedge ahead of evidence, with one override clause
**Date:** 2026-07-27 · **Type:** strategic
**Decision:** PRD v1 freezes the sandwich-generation caregiver as the entry wedge, including
`medical_bill` in the eight document types and multi-member-single-login. PRD §4.1 permits exactly
one G1-triggered swap (persona priority, one document type, copy register) and nothing else.
**Alternatives rejected:** wait for G1 to write the PRD (would have blocked all foundation work);
freeze without an override clause (would have forced a full re-spec if evidence disagreed).
**Evidence:** none first-party — expert judgment (investor/operator panel, grade C) plus adjacent
market signals (Carefull, Ohai, Milo — grade D). This is explicitly a judgment call made to unblock
work, not an evidenced conclusion.
**Assumptions affected:** H3 (created, medium confidence); shapes H1 and H12 instruments.
**Expected outcome:** by 2026-08-25 the caregiver segment leads on (pain severity × commitment) in
≥40 interviews; if not, §4.1 is exercised.
**Confidence:** medium · **Review:** 2026-08-25 · **Reversal cost:** low (the clause exists)
**Outcome:** _pending_

### D-002 · Cut chat, agent execution, and multi-user from v1
**Date:** 2026-07-27 · **Type:** strategic
**Decision:** v1 ships a search box (not chat), deterministic Action-Kit templates the user sends
themselves (not an executing agent), and a single login with multiple members. The approval
architecture stays documented for Act II.
**Alternatives rejected:** ship chat as a differentiator (weakest defensibility, largest model cost,
real injection surface); ship the agent (company-ending risk class before brand trust exists).
**Evidence:** red-team panel §18 (grade C); COGS model (grade D) showing chat as the largest line;
competitive analysis showing extraction and chat as commodity (grade D).
**Assumptions affected:** H6 created (low cost of being wrong, reversible); H14 improved
(~$2.50 → ~$1.10/household/month modeled).
**Expected outcome:** by G3, search telemetry and support tags show <10% of sessions wanting
conversational interaction. If higher, chat returns via PRD §21.
**Confidence:** medium · **Review:** G3 (~Feb 2027) · **Reversal cost:** low
**Outcome:** _pending_

### D-003 · Accept ADRs 001–008 and freeze the architecture
**Date:** 2026-07-28 · **Type:** amendment
**Decision:** All eight ADRs move Proposed → Accepted (five annotated *implemented*). The
architecture set is frozen; amendments require real-world evidence plus a new ADR.
**Alternatives rejected:** leave them Proposed (we were already building against them — the status
was simply false); re-open the debate (panel review already resolved it).
**Evidence:** principal-panel review (3 blockers, 6 majors, all resolved); 12 passing tenancy
integration tests proving the F-01 fix (grade A for the engineering claim).
**Assumptions affected:** none — engineering governance, not a business hypothesis.
**Expected outcome:** no ADR is re-litigated before G1 without new evidence.
**Confidence:** high · **Review:** at G1 · **Reversal cost:** medium (a new ADR)
**Outcome:** _pending_

### D-004 · Slip the H8 rulebook spike out of the validation sprint
**Date:** 2026-07-28 · **Type:** tactical
**Decision:** The 20-hour vendor/obligation rulebook spike moves out of the four-week sprint. Take
it only if the recruiting funnel runs ahead of schedule, or contract it out.
**Alternatives rejected:** run it in parallel (competes directly with founder conversation volume,
the sprint's binding constraint); drop it entirely (it prices the moat and must happen before
Act II planning).
**Evidence:** capacity arithmetic — ~170 outreach touches, ~50 calls, 25 onboardings and service
oversight already exceed a full-time founder month (grade D, but the constraint is arithmetic).
**Assumptions affected:** H8 stays `untested` past G1; accepted deliberately because it is
strategic, not existential.
**Expected outcome:** H1 and H2 both carry A- or B-grade evidence by 2026-08-25 — which would not
have happened had the spike consumed a quarter of the sprint.
**Confidence:** high · **Review:** 2026-08-25 · **Reversal cost:** low
**Outcome:** _pending_

### D-005 · Merge the wedge interview into the recruiting screening call
**Date:** 2026-07-28 · **Type:** tactical
**Decision:** One 30-minute conversation serves both purposes: recruiting decision and wedge
evidence. The interview guide is run inside the screening call.
**Alternatives rejected:** keep 75 interviews and 50 screening calls separate (125 conversations is
not achievable in four weeks alongside running the service).
**Evidence:** capacity arithmetic (grade D); the instruments overlap by roughly 70% in content.
**Assumptions affected:** improves feasibility of evidence for H1, H2, H3 simultaneously. Risk
noted: a recruiting frame may bias WTP answers upward — mitigated by treating stated WTP as grade C
and relying on the day-30 card ask for H2.
**Expected outcome:** ≥40 merged calls held by 2026-08-25, each producing at least one evidence
record.
**Confidence:** high · **Review:** 2026-08-11 (mid-sprint) · **Reversal cost:** low
**Outcome:** _pending_
