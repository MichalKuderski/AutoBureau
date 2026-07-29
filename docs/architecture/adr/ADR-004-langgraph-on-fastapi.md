# ADR-004: LangGraph + FastAPI for AI workflows; Postgres checkpointing

**Status:** Accepted (2026-07-28; not yet implemented) · **Date:** 2026-07-22

## Context
Five workflows (doc 04 §3) share needs: multi-step orchestration, durable state across interrupts (human approvals park runs for hours or days), retries at node granularity, and full traceability. The brief lists LangGraph + FastAPI.

## Decision
All AI workflows are LangGraph graphs hosted in the FastAPI service, with:
- **Postgres checkpointer in our own DB** (not LangGraph Cloud) — graph state inherits our backup, RLS-adjacent scoping, and deletion-cascade story; `task_runs.langgraph_thread_id` links domain ↔ graph state.
- **Interrupt-based HITL**: approval gates are graph interrupts resumed by an internal endpoint (doc 04 §4/§6) — no compute held while humans think.
- Typed Pydantic state per graph; nodes I/O only via injected clients (unit-testable with a fake gateway).
- LangChain usage confined to LangGraph itself + provider adapters we control; **no chains/agents abstractions** from the wider ecosystem — prompts and control flow stay explicit and in-repo.

## Consequences
- ✅ Durable, resumable, inspectable executions; the approval-gated agent pattern is native rather than hand-rolled state machines.
- ✅ Checkpoints in our Postgres keeps the compliance story one story.
- ⚠️ LangGraph API churn risk → pinned versions, adapters at the boundary, and the graphs are small enough to rewrite onto a successor runtime if the ecosystem shifts (state schema is ours, not the framework's).
- ⚠️ Checkpoint tables grow → TTL sweep for finished threads (30 d) in the scheduler.
- ❌ Rejected: hand-rolled state machines over the queue (reinventing checkpointing/interrupts poorly); Temporal (superb durability but a whole new operational surface a 6-person team doesn't need — revisit if workflow complexity outgrows LangGraph); LangGraph Cloud / Managed Agents platforms (data-locality and deletion guarantees are harder to reason about for this data class; revisit as offerings mature).
