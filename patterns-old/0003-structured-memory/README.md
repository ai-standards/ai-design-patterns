# Pattern: Structured Memory

**Intent**: Manage model memory explicitly by separating short-term and long-term context.

---

## Introduction

Language models do not have true memory. They only “remember” what is passed in the prompt, which leads many teams to overcompensate by stuffing every piece of history, instruction, and document into each request. This quickly results in bloated prompts, higher costs, and degraded performance.  

The **Structured Memory** pattern treats memory as layered and intentional. Short-term context is kept lean and focused on what is immediately relevant, while long-term knowledge is stored separately and retrieved only when needed. The result mirrors how humans think: recall what matters, not everything all at once.  

- LLMs rely only on tokens in context  
- Prompt stuffing leads to cost and confusion  
- Memory works best when tiered and intentional  

---

## Problem

Without structure, memory grows unchecked. Long histories inflate token counts, irrelevant details confuse the model, and truly important knowledge gets lost once token limits are exceeded. As systems scale, the unpredictability of overflowing context undermines reliability and performance.  

- Prompt bloat increases cost and latency  
- Irrelevant history dilutes focus  
- Important details are lost in overflow  
- Systems become fragile at scale  

---

## Forces

Managing memory means balancing competing pressures. Including everything feels safe, but it’s wasteful. Filtering aggressively improves efficiency, but risks omitting key details. External memory retrieval improves accuracy, but it introduces latency.  

- Completeness vs efficiency  
- Relevance vs recall  
- Latency vs accuracy  

---

## Solution

Treat memory as a managed resource, not an unlimited buffer. Define layers of memory: short-term for immediate conversational or task context, and long-term for durable knowledge. Summarization and retrieval keep prompts focused, while irrelevant history is discarded or archived. This structure creates predictable scaling and reliable performance.  

- Separate memory into short-term and long-term layers  
- Use retrieval or summarization to stay lean  
- Discard or archive what’s not relevant  
- Manage memory explicitly, not passively  

---

## Consequences

The benefits of structured memory are clear: token costs drop, performance improves, and prompts become sharper and easier to reason about. Systems scale more predictably because memory is under control. On the other hand, this approach requires additional infrastructure for storage and retrieval, and summarization introduces the risk of losing nuance.  

- Pros: lower cost, better performance, clearer prompts, scalable design  
- Cons: requires storage/retrieval systems, summarization may lose detail  

---

**Key Insight**: Don’t treat memory as an ever-growing log. By structuring it into short-term and long-term layers, you create a system that is lean, scalable, and capable of recalling only what truly matters.  
