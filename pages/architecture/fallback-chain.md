# Pattern: Fallback Chain

**Also known as**: Structured Retry, Plan B  
**Intent**: Ensure reliability by defining ordered alternatives when primary actions fail.

---

## Introduction

LLMs and tools fail — sometimes silently, sometimes spectacularly. A single failure shouldn’t take down the whole system. Instead of hoping for the best, the **Fallback Chain** pattern defines explicit alternatives in advance.

When the primary approach fails, the system automatically falls back to the next safe option, and continues until a result is produced or all options are exhausted.

---

## Problem

Without fallback:  
- One tool failure blocks the entire workflow.  
- Users see errors instead of results.  
- Failures must be debugged manually every time.  

---

## Forces

- **Resilience vs cost** — more fallbacks improve reliability, but add tokens and complexity.  
- **Determinism vs flexibility** — fallback order must be predictable, but adaptable.  
- **Speed vs completeness** — fallback may add latency, but avoids dead ends.  

---

## Solution

Define a fallback chain for each critical action:  

- Primary path runs first.  
- If it fails (timeout, validation error, cost threshold), secondary path runs.  
- Continue until success or exhaustion.  
- Always log which path succeeded.  

---

## Implementation

- Write fallback rules explicitly, not ad-hoc.  
- Include clear criteria for failure detection.  
- Keep chains short: two or three options are usually enough.  
- Monitor fallback usage as a signal of system health.  

---

## Consequences

**Pros**  
- Reliability: system degrades gracefully instead of failing hard.  
- Predictability: clear rules, no surprises.  
- Observability: fallback logs highlight weak points.  

**Cons**  
- Can hide systemic issues if over-used.  
- Adds complexity and token cost.  
- Poorly designed fallbacks create infinite loops or waste.  
