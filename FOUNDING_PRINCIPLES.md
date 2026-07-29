# AutoBureau — Founding Principles

*The constitutional document. Vendor-neutral, tool-neutral, model-neutral. If you are a new
engineer, a new collaborator, or an AI system joining this project, read this first — it takes
about eight minutes and it outranks your instincts about what should be built.*

**Status:** ratified 2026-07-28 · amended only by the process in §11.

---

## 1. Mission

Every household has a **standing**: what it holds, what it owes, and what it is owed.
Today that standing lives nowhere — it is smeared across inboxes, drawers, and the memory of
whoever worries most. AutoBureau is its system of record, and eventually the agent that acts on it.

Businesses have a system of record for every dimension of their existence. The household — the
most common economic unit on earth — has none. That is the chair we are sitting in.

## 2. Vision

Four acts, each earned by the one before it. We do not skip ahead.

| Act | Years | What becomes true |
|---|---|---|
| **Record** | 0–2 | The ledger is true and fresh at minimal user labor |
| **Resolve** | 2–4 | The platform acts from the ledger, with autonomy earned per user |
| **Interchange** | 4–7 | Institutions read and write the ledger directly, with consent |
| **Operating system** | 7–10 | Third parties build on consented standing; the claim is retrospective, never a slide |

## 3. The Ledger Thesis

Two assets compound with every interaction. They are the company; everything else is substrate.

**Ledger A — the household ledger (private).** A longitudinal, provenance-backed record of one
household's standing. It compounds with **tenure**: year five knows the insurance trajectory,
claim history, and administrative shape of a life in a way no competitor's better model can
reconstruct, because the evidence was never theirs. It appreciates while the user is idle —
*if and only if* ingestion is passive. A ledger that goes stale is not a system of record; it is a
snapshot.

**Ledger B — the institutional world model (shared).** Not what an institution's website *says* —
any language model knows that — but what actually *happens*: observed processing times, which
cancellation path works, which escalation produced the refund. This is not on the internet. It is
generated only by acting at scale and recording outcomes.

**Hard constraint, stated at birth:** Ledger B learns *procedures and statistics, never personal
facts*. De-identification is an architectural invariant, not a policy promise. Violate it once and
both ledgers are worthless, because both rest on trust.

**What is deliberately not a moat:** models, prompts, extraction accuracy, UI polish. All
commodity, all sliding toward zero margin. Spend where capital cannot follow: tenure, outcomes,
and the unglamorous authority infrastructure of managing someone else's paperwork.

## 4. Product Philosophy

1. **We prepare; the user approves.** No action with real-world consequence executes without an
   explicit, auditable approval. This is a permanent stance, not a v1 limitation.
2. **Provenance is the interface.** Every fact shows its source. Trust is inspectable, not asserted.
3. **Never confidently wrong.** Below threshold, ask. Above it, show and allow one-tap correction.
   A wrong "your passport is fine" is worse than no answer at all.
4. **Calm authority.** We are the competent person in the room: plain language, no urgency theater,
   no gamification. **Fear is never a growth mechanic.**
5. **The empty state is the product.** "Nothing at risk this week" is a designed feature, not a
   blank screen.
6. **Prevention doesn't sell; relief and recovery do.** We deliver prevention as the substance and
   lead with what people actually feel.
7. **Reversible by default.** Dismiss, snooze, disconnect, delete, export — all recoverable, all
   one click. Cancellation is never a maze.

## 5. Engineering Philosophy

1. **Boring technology, deliberately chosen.** Every vendor and dependency earns its place by
   removing work a small team should not carry. Novelty is a cost, not a feature.
2. **Seams, not services.** Module boundaries, contracts, and an event spine give us the option to
   split later. We take that option only when a measured trigger fires.
3. **Delete scope before adding abstraction.** The cheapest code is the code we didn't write.
4. **Tests prove; they do not assert.** A test that would pass with the mechanism disabled proves
   nothing. Tenant isolation is verified against a real database, as a non-privileged role, or it is
   not verified.
5. **Guardrails over vigilance.** If an invariant matters, a machine enforces it. Every guardrail is
   negative-control tested — one that cannot fire is worse than none, because it manufactures
   confidence.
6. **Learning velocity is the scarce resource.** A week that shipped code but learned nothing from a
   real household is a failed week.
7. **Fail closed, loudly.** Ambiguity resolves toward refusal and a clear error, never toward a
   silent guess.
8. **Write for the reader in eighteen months.** Comments explain *why*, especially where the obvious
   implementation is wrong.

## 6. Security Philosophy

We hold identity documents, insurance, medical bills, and financial paper. **Per user, this database
is worth more to an attacker than a bank's.** There is no second chance in this category: one breach
before the brand exists ends the company.

1. **The keel** (§10) removes whole categories of risk by declining to hold them.
2. **Defense in depth, by different mechanisms.** Tenant isolation is enforced in code *and* in the
   database, so a single mistake is not a breach.
3. **Documents are hostile input.** Anything a user or an institution sends may be adversarial to
   the extraction pipeline and to the platform. Reading content and holding capabilities are
   mutually exclusive states.
4. **Least privilege, always.** Identifier-grade values live in one encrypted place; the runtime
   that reads documents holds no key to it.
5. **Architecture is not maturity.** A strong design in a small team is still exposed by key
   custody, laptop hygiene, and social engineering. Operational posture is reviewed, not assumed.
6. **Say plainly what we can and cannot see.** The security page is written for humans, not lawyers.

## 7. Architecture Invariants

Violating one of these is a defect, not a stylistic choice.

1. All household data access flows through the scoped client; no bare database handle in
   application code.
2. Tenant scope is transaction-local. Never session-level — it leaks across pooled connections.
3. Scoped transactions stay short: no network I/O while holding one.
4. Side effects are published through the transactional outbox, in the same transaction as the
   domain write. Never dual-write to a queue from a request handler.
5. Identifier-grade PII exists only in the encrypted secrets table — never in attributes, logs,
   prompts, analytics, or search.
6. Application code never imports a model-provider SDK; all model access goes through the gateway.
7. Every AI-derived row carries provenance: source, confidence, originating document. Uncited dates
   never become obligations.
8. Money is integer minor units. Always.
9. Every state mutation writes an audit record. The audit log is append-only.
10. The user can export everything and delete everything, verifiably.

## 8. Scope Discipline

The frozen product specification defines version one. **Anything not in it is out of scope.**

Requests from outside it face one test: *does this retire a known risk more cheaply than something
already in scope?* Almost always the answer is no, and the honest response is a postponement with a
reason attached.

- Postponements are decisions, not backlog items.
- Reintroducing one requires the amendment process, not a conversation.
- "While we're in there" is how a small team acquires a large surface area.
- The most likely death of a specification is a hundred reasonable exceptions. Exceptions are
  expensive on purpose.

## 9. Definition of Done

A change is done when *all* of the following are true. "It runs" is not on the list.

- [ ] Acceptance criteria in the product specification are met.
- [ ] Unit tests for logic; integration tests if it touches the database or the event spine.
- [ ] Tenant-isolation suite passes.
- [ ] Contract updated if the API shape changed; breaking changes routed through review.
- [ ] Evaluation fixtures added if it changes model-facing behavior.
- [ ] Analytics events wired if it creates a measurable moment.
- [ ] Audit coverage for new mutations.
- [ ] Documentation touched: this file, the architecture set, or a runbook.
- [ ] Rollback story stated for migrations, with lock impact at projected scale.

## 10. Decision-Making Hierarchy

When sources conflict, higher wins. Write down which level settled it.

1. **Law, safety, and user trust.** Never traded for velocity.
2. **Evidence from real users** — observed behavior first, then paid behavior, then stated intent.
   Evidence outranks every plan below it, including plans we love.
3. **The product specification** — for questions of scope.
4. **The architecture set and its decision records** — for questions of engineering constraint.
5. **Strategy documents** — for questions of direction and sequencing.
6. **Expert judgment**, including panels, advisors, and AI systems.
7. **Individual preference.** Last, always, including the founder's.

Corollary: evidence does not silently edit a frozen document. It opens the amendment door.

## 11. Things We Will Never Do

Permanent, absent a documented amendment with a named owner and a stated reason.

**Never, as a matter of principle:**
- Sell, rent, or broker personal data; monetize through advertising; or build an identity graph for
  anyone but the user.
- Allow user data to train third-party models.
- Use fear, urgency, or manufactured anxiety as a growth mechanic.
- Make cancellation, export, or deletion harder than signing up.
- Overclaim capability — especially model capability — in a domain where being wrong costs someone
  a deadline, a benefit, or a legal right.
- Ship a tenancy or encryption change that has not been verified against a real database.
- Hide a known defect from the people it affects.

**Not in version one, and not without an architecture decision record:**
- Store credentials for government, bank, or utility portals; or operate logged-in browsing agents.
- Move money.
- Prepare or file taxes.
- Give financial, legal, or medical advice.

The first list is who we are. The second is a sequencing decision — each carries a risk class we
have not yet earned the right to hold.

---

**Amending this document:** propose in writing, state which principle changes and what evidence
compels it, obtain founder and engineering-lead sign-off, and record the date and reason inline.
Principles are meant to constrain future us — including future us under pressure, which is precisely
when they matter.
