# Pattern: Agentic Redux (AI-Assisted State Reduction)

**Also known as**: Reducer-First State, Proposal-and-Reduce  
**Intent**: Keep a **small, canonical store** while AI agents continuously **propose** derived/summary updates that deterministic reducers **accept or reject**.

---

## Introduction

Large AI systems accumulate sprawling “global” state: long chat histories, tool outputs, embeddings, feature flags, user prefs, and audit trails. As that **common state** grows, everything slows down—more tokens to fetch, more cache misses, more bugs from cross-coupling.

Redux solved this class of problems for web apps with a few sharp ideas: a **single source of truth**, **pure reducers**, and **explicit actions**. This pattern adapts that discipline to AI systems: let **agents explore and propose**, but keep **reducers in charge** so common state stays **minimal, canonical, and auditable**.

---

## Problem

- **State sprawl** — shared stores balloon with logs, histories, and partial results.  
- **Hidden coupling** — features read/write each other’s fields without contracts.  
- **Non-deterministic mutation** — LLMs or tools write directly into state, making bugs irreproducible.  
- **Cost/latency creep** — bigger state means bigger prompts, more I/O, slower systems.

---

## Forces

- **Discovery vs determinism** — agents must explore; production state must stay predictable.  
- **Completeness vs compactness** — we want all the evidence, but the store should hold only what’s needed.  
- **Throughput vs safety** — aggressive compaction saves tokens but risks losing facts.  
- **Local autonomy vs global coherence** — teams move fast locally without breaking the canonical store.

---

## Solution

Adopt a **Redux-style contract** with an **agentic proposal loop**:

1. **Canonical Store (single source of truth)**  
   - A lean, typed schema for **common state only** (facts, indices, pointers).  
   - Everything else (raw logs, transcripts, embeddings) lives in **ledgers** or **side stores** referenced by ID.

2. **Actions (proposals, never mutations)**  
   - Agents and services emit **Action proposals**: “add_facts”, “upsert_profile”, “rotate_key”, “compact_thread”.  
   - Proposals include **evidence pointers** (ledger IDs) and **confidence**.

3. **Reducers (deterministic, pure)**  
   - Reducers validate proposals against **schemas, guards, and policies**.  
   - They **accept/reject** and output the **next state** plus any **side-effects intents** (e.g., “schedule_compaction”).

4. **Selectors (derived views)**  
   - Read paths use **selectors** to compute views on demand (or cached), not stored redundantly in the store.

5. **Compactors (agentic summarizers behind reducers)**  
   - When state exceeds thresholds, reducers **request compaction**; agents produce summaries **as proposals**.  
   - Reducers verify summaries (checksums, sample diffs, policy checks) before replacing verbose state with compact forms.

6. **Ledger (audit, replay, provenance)**  
   - Every proposal, reducer decision, and state hash is logged.  
   - You can **replay** from an initial hash + action stream to recover state.

**Key rule**: *Agents never write state directly.* They **propose**; **reducers decide**.

---

## Implementation

- **Define the store schema** for common state only. Keep it small and typed.  
- **Enumerate action types** and their validation rules (required evidence, allowed transitions, quotas).  
- **Write pure reducers** that:  
  - Verify evidence (exists, not stale, signed).  
  - Enforce invariants (idempotency, monotonic counters, referential integrity).  
  - Emit side-effect intents instead of calling tools inline.  
- **Introduce compactors** as *paths*: when thresholds trip (size, age, token cost), open a compaction path that proposes summaries (e.g., thread → key facts + citations).  
- **Cache derived views** via selectors; expire on matching action types.  
- **Measure** with PathScore before enabling any compaction policy (impact vs token cost).  
- **Guard rails**:  
  - Reject proposals without verifiable provenance.  
  - Cap compaction frequency and size deltas.  
  - Keep **raw ledgers** for a retention window so summaries are reversible.

---

## Consequences

**Pros**  
- **Determinism** — reproducible state from actions + reducers.  
- **Compactness** — global store stays small; heavy data moves to ledgers.  
- **Safety** — agents can explore without corrupting state.  
- **Observability** — full provenance via the action/decision ledger.  
- **Performance** — smaller prompts and faster selectors reduce token and latency costs.

**Cons**  
- **Upfront design** — requires clear schemas, action taxonomy, and reducer discipline.  
- **Compaction risk** — poor summaries can drop important detail; needs audits and rollback.  
- **Two-tier storage** — you must manage ledgers/side stores alongside the canonical state.

---

## When to use

- Multi-agent systems where different components “learn” and suggest updates.  
- Products with chat/history growth that threatens prompt budgets.  
- Any system that needs **provable state transitions** for audit, safety, or compliance.

---

## Notes

- Works naturally with **ACV** (agents propose; controllers dispatch; views select).  
- Pair with **Context Ledger** to keep heavy inputs out of the store while preserving replay.  
- Treat compaction as a **Path** with **Eval as Contract** and **PathScore** before merge to production.
