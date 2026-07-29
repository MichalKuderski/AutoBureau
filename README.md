# AutoBureau

**An AI-powered personal bureaucracy assistant.** AutoBureau tracks, reminds, prepares, and — with explicit user approval — completes the administrative work of being a person: renewals, subscriptions, insurance, warranties, filings, claims, and paperwork.

> **Status: `VALIDATION` (pre-G1)** — architecture frozen and accepted; foundation engineering
> complete and verified; **product feature work is deliberately paused** until the four-week
> validation sprint returns a verdict (gate G1, ~2026-08-25).
>
> The company's critical path right now is customer evidence, not code. See
> [`ops/founder-os.md`](ops/founder-os.md) for the live sprint and
> [`docs/product/pre-g1-backlog.md`](docs/product/pre-g1-backlog.md) for what engineering may and
> may not build before the gate.

## Start here

| If you are… | Read |
|---|---|
| Anyone, first day | [`FOUNDING_PRINCIPLES.md`](FOUNDING_PRINCIPLES.md) — the constitution (~8 min) |
| An engineer | [`CLAUDE.md`](CLAUDE.md) → [`docs/architecture/`](docs/architecture/README.md) → [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) |
| Asking "why does this exist?" | [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — including what is deliberately absent |
| Asking "what do we believe?" | [`ops/assumptions.yaml`](ops/assumptions.yaml) — the hypothesis registry |
| Scoping product work | [`docs/product/PRD-v1.md`](docs/product/PRD-v1.md) — anything not in it is out of scope |

## The one-paragraph pitch

People lose money and peace of mind to administrative entropy: the forgotten free trial, the lapsed registration, the unclaimed warranty, the missed enrollment window. AutoBureau ingests the paper trail of your life (uploads, forwarded emails, photos), turns it into a structured registry of **items** (passport, policy, subscription, vehicle…) and **obligations** (renew by, cancel before, file by, claim within…), and then acts as a 24/7 executive assistant: it warns you before deadlines, drafts the letter or form, and executes the safe parts of the task once you approve.

## Product principles (non-negotiable)

1. **We prepare, you approve.** No action with real-world consequences executes without an explicit, auditable user approval.
2. **No credentials, no money movement — in v1.** AutoBureau never stores government/bank logins and never moves funds. This is a security posture, not a missing feature.
3. **Documents are untrusted input.** Every uploaded file is treated as potentially adversarial to the AI pipeline (prompt injection) and to the platform (malware).
4. **The household is the unit of life admin.** People manage paperwork for partners, kids, and dependents. The data model is household-shaped from day one.
5. **Deletion is a feature.** This product holds some of the most sensitive data a consumer product can hold. Full, verifiable erasure is a first-class workflow.

## Repository layout

What exists today. Directories are created when the work that needs them is authorized — an empty
scaffold is an invitation to build the wrong thing early.

```
autobureau/
├── packages/
│   ├── contracts/      Zod domain schemas, event taxonomy, canonical hashing  ✅ built
│   └── db/             Prisma schema, RLS migrations, scoped client, outbox   ✅ built
├── ops/                assumption registry + schema/tests, dashboard, P0 kit  ✅ built
├── docs/               architecture · product · strategy · traceability       ✅ built
└── .github/workflows/  CI: build, tests, guardrails, governance               ✅ built
```

Planned, and gated on G1 (see the backlog for why each is deferred): `apps/web` (Next.js — UI and
domain API), `services/ai` (FastAPI + LangGraph), `packages/ui`, `packages/config`,
`infra/terraform`.

## How to review

Start at [`docs/architecture/README.md`](docs/architecture/README.md) — it contains the reading order, the list of decisions that most need scrutiny, and the open questions deliberately left for the reviewer.
