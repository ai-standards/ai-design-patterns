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

---

## Example

See the [complete TypeScript implementation](../../examples/structured-memory/) for a working example.

```typescript
import { MemoryManager } from './memory-manager.js';

const memory = new MemoryManager({
  shortTermMaxEntries: 10,       // Keep recent context lean
  shortTermMaxTokens: 2000,      // Control prompt size
  longTermRetentionThreshold: 6, // Important memories persist
  summarizationThreshold: 5      // When to summarize old content
});

// Add memories with importance scores - high importance persists
memory.addMemory(
  "User wants to build a React app with TypeScript", 
  'conversation', 
  8  // High importance - will move to long-term storage
);

memory.addMemory(
  "React 18 introduced concurrent features", 
  'fact', 
  7
);

memory.addMemory(
  "The weather is nice today", 
  'conversation', 
  2  // Low importance - will be discarded when memory fills
);

// Retrieve only relevant memories for current context
const relevant = memory.retrieveRelevant({
  keywords: ['react', 'typescript'],
  categories: ['conversation', 'fact'],
  minImportance: 6,
  limit: 5
});

// Build focused context prompt within token limits
const contextPrompt = memory.buildContextPrompt({
  keywords: ['react', 'app'],
  minImportance: 7
}, 1500);  // Stay within 1500 token limit

console.log('Focused context:', contextPrompt);
// Output: Only relevant, high-importance memories within token budget
```

Key insight: Instead of cramming everything into every prompt (expensive and confusing), manage memory in structured tiers. Keep short-term memory lean, move important information to searchable long-term storage, and retrieve only what's relevant for each specific context.  
