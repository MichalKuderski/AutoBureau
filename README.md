# Pellum

**A little less to carry.** A household record and next-step workspace for people managing their family’s paperwork.

> **Status: launch implementation, staging only.** The founder approved the caregiver scope, Pellum brand, and Stripe test-mode work. Plaid is deferred. This is not evidence that validation hypotheses passed or that the product is ready for public launch. See [approved direction](docs/product/launch-direction-2026-09-11.md).
>
> The repository, package namespace, database and infrastructure retain the stable AutoBureau identifiers. Historical governance keeps its original name.

## Start here

| If you are… | Read |
|---|---|
| Anyone, first day | [`FOUNDING_PRINCIPLES.md`](FOUNDING_PRINCIPLES.md) — the constitution (~8 min) |
| An engineer | [`CLAUDE.md`](CLAUDE.md) → [`docs/architecture/`](docs/architecture/README.md) → [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) |
| Asking "why does this exist?" | [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — including what is deliberately absent |
| Asking "what do we believe?" | [`ops/assumptions.yaml`](ops/assumptions.yaml) — the hypothesis registry |
| Scoping product work | [`docs/product/PRD-v1.md`](docs/product/PRD-v1.md) — anything not in it is out of scope |

## The one-paragraph pitch

Pellum is being built to keep important household records, their sources and the next steps together. The launch scope covers caregiver-led households, document review, obligations and reminders. It does not include bank connections, money movement, chat or autonomous action. Implementation and provider verification remain in progress; a feature is not operational merely because it appears in the specification.

## Product principles (non-negotiable)

1. **We prepare, you approve.** No action with real-world consequences executes without an explicit, auditable user approval.
2. **No credentials, no money movement — in v1.** Pellum never stores government/bank logins and never moves funds. This is a security posture, not a missing feature.
3. **Documents are untrusted input.** Every uploaded file is treated as potentially adversarial to the AI pipeline (prompt injection) and to the platform (malware).
4. **The household is the unit of life admin.** People manage paperwork for partners, kids, and dependents. The data model is household-shaped from day one.
5. **Deletion is a feature.** This product holds some of the most sensitive data a consumer product can hold. Full, verifiable erasure is a first-class workflow.

## Repository layout

What exists today. Directories are created when the work that needs them is authorized — an empty
scaffold is an invitation to build the wrong thing early.

```
autobureau/
├── apps/
│   └── web/            Next.js App Router — UI and domain API                 ✅ built
├── packages/
│   ├── contracts/      Zod domain schemas, event taxonomy, canonical hashing  ✅ built
│   └── db/             Prisma schema, RLS migrations, scoped client, outbox   ✅ built
├── ops/                assumption registry + schema/tests, dashboard, P0 kit  ✅ built
├── docs/               architecture · product · strategy · traceability       ✅ built
└── .github/workflows/  CI: lint, build, typecheck, tests, guardrails          ✅ built
```

Not yet created (see the backlog for why each is deferred): `services/ai` (FastAPI + LangGraph),
`packages/ui`, `packages/config`, `infra/terraform`.

## How to review

Start at [`docs/architecture/README.md`](docs/architecture/README.md) — it contains the reading order, the list of decisions that most need scrutiny, and the open questions deliberately left for the reviewer.
