# Generation Patterns

Generation patterns describe **how models produce and manage outputs**.  
They answer the question: *how do we turn raw model completions into reliable, evaluable, and useful building blocks?*  

These patterns cover **schemas, context, memory, streaming, and evaluation**.  
They turn stochastic behavior into structured systems that teams can trust, measure, and improve.  

---

## Catalog

### [Deterministic IO](../patterns/generation/deterministic-io/)  
Schema-first prompting. Define contracts for every output so results are testable, reproducible, and debuggable.  

### [Context Ledger](../patterns/generation/context-ledger/)  
Make prompt assembly explicit and auditable. Log what went in and what came out so every generation can be replayed.  

### [Structured Memory](../patterns/generation/structured-memory/)  
Separate short-term context from long-term knowledge. Prevent prompt bloat and improve reliability by treating memory as tiers.  

### [Streaming First](../patterns/generation/streaming-first/)  
Prefer incremental output over monoliths. Improves UX, reduces perceived latency, and creates more responsive systems.  

### [PathScore](../patterns/generation/pathscore/)  
A single-number evaluation metric for comparing paths before merging. Balances value (impact) against cost (tokens, time, eval bill).  

---

## Why Generation Matters

Raw model completions are not enough. Without structure, context discipline, and evaluation, you get demos that can't be trusted in production.  

Generation patterns provide the **contracts and controls** that transform LLM output into reliable components of a system.  
They make it possible to debug, compare, and evolve — turning chance into discovery, and discovery into progress.  
