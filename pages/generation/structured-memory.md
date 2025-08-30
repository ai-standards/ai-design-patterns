# Pattern: Structured Memory

**Intent**: Manage model memory explicitly by separating short-term and long-term context.

---

## Introduction

LLMs do not have true memory. They rely on tokens passed in context. Teams often try to cram everything into every prompt — chat history, documents, instructions. This leads to bloated prompts, rising costs, and degraded performance.

The **Structured Memory** pattern addresses this by treating memory as tiers. Short-term context is kept lean, containing only what is immediately relevant. Long-term knowledge is stored separately and retrieved selectively. This mimics how humans work: recall what is needed, not everything at once.

---

## Problem

- Prompt bloat leads to high costs and latency.  
- Irrelevant history confuses the model.  
- Important knowledge gets lost in token overflow.  
- Systems become unpredictable as context size grows.  

---

## Forces

- **Completeness vs efficiency** — including everything feels safe but is wasteful.  
- **Relevance vs recall** — keeping only what matters requires smart retrieval.  
- **Latency vs accuracy** — fetching external memory adds time but improves results.  

---

## Solution

- Define memory layers (short-term vs long-term).  
- Use retrieval or summarization to keep prompts focused.  
- Discard or archive irrelevant history.  
- Treat memory as a managed resource, not an unlimited buffer.  

---

## Consequences

**Pros**  
- Lower token costs.  
- Improved model performance.  
- Clearer, more relevant prompts.  
- Predictable scaling as context grows.  

**Cons**  
- Requires infrastructure for storage and retrieval.  
- Summarization may lose detail.  
