# Pattern: ACV (Agent / Controller / View)

**Also known as**: Agentic MVC  
**Intent**: Separate reasoning, orchestration, and presentation to avoid brittle, tangled systems.

---

## Introduction

When teams first wire AI into a product, prompts, tool calls, and UI logic often end up fused together. The model plans and executes, the code calls tools directly, and the interface updates all in the same flow. It works for demos, but quickly becomes unmanageable: you can’t test one piece without the others, and every change risks breaking the whole system.

The **ACV pattern** adapts the classic MVC (Model–View–Controller) idea for AI. It divides responsibilities into three clean roles:  

- **Agent**: plans, reasons, and proposes actions — but never takes them.  
- **Controller**: executes tool calls and enforces safety, retries, and rollbacks.  
- **View**: renders the state to the user, ideally as a streaming experience.  

This separation creates modularity, debuggability, and scalability for AI-driven systems.

---

## Problem

Without separation of concerns:  

- Plans, execution, and presentation are entangled.  
- Failures cascade, and debugging becomes guesswork.  
- Testing is impossible without running the whole stack.  
- Adding new tools or UI surfaces requires rewriting the agent prompt.  
- Latency and cost balloon because every piece is crammed into one model call.  

---

## Forces

- **Reusability vs specialization** — should one agent know everything or can roles be specialized?  
- **Latency vs correctness** — more hops can add delay, but improve safety.  
- **Flexibility vs clarity** — tightly coupled code feels faster to build, but harder to evolve.  
- **Safety vs autonomy** — the agent can propose, but execution must be guarded.  

---

## Solution

Split the system into three roles:  

1. **Agent (reasoning)**  
   - Runs in the LLM.  
   - Accepts context and goals.  
   - Produces a typed list of actions.  
   - No side effects.  

2. **Controller (orchestration)**  
   - Runs in code.  
   - Validates actions against schemas.  
   - Executes tools with retries, timeouts, and rollbacks.  
   - Ensures determinism and observability.  

3. **View (presentation)**  
   - Pure rendering layer.  
   - Takes state and renders it for the user.  
   - Streams updates, but no business logic.  

---

## Implementation

- Define a strict **action contract** that agents must output.  
- Parse and validate every output before execution.  
- Keep controllers idempotent and log every action.  
- Views consume only state, never call the model directly.  

---

## Consequences

**Pros**  
- Modularity: swap agents, tools, or UIs independently.  
- Debuggable: logs and tests focus on one layer at a time.  
- Scalable: add new tools or views without rewriting prompts.  
- Safer: controllers enforce guardrails around every tool call.  

**Cons**  
- Slightly more complexity than a single-agent design.  
- Extra hops may add latency.  
- Requires clear schemas and discipline to maintain boundaries.  
