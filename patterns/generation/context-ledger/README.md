# Pattern: Context Ledger

**Intent**: Make prompt assembly explicit, auditable, and reproducible.

---

## Introduction

When building with LLMs, context is everything: prompts, system messages, retrieved documents, and user history all combine to shape outputs. Without discipline, context assembly becomes invisible. Failures cannot be reproduced, and success cannot be explained.

The **Context Ledger** pattern ensures every input is logged and auditable. Prompt construction is treated as a transparent process, not hidden glue. A ledger shows exactly what was included, in what order, and why.

---

## Problem

- Failures cannot be reproduced because context is ephemeral.  
- Successes cannot be explained or repeated.  
- Debugging relies on guesswork.  
- Prompt assembly logic is scattered across codebases.  

---

## Forces

- **Transparency vs speed** — logging everything feels slow, but prevents wasted time later.  
- **Cost vs observability** — storing context adds overhead but enables replay.  
- **Flexibility vs consistency** — context can be dynamic, but rules must be clear.  

---

## Solution

- Record every component of prompt construction.  
- Store the final assembled context alongside outputs.  
- Include metadata such as source, timestamp, and agent.  
- Make ledgers queryable for debugging, evaluation, and audits.  

---

## Consequences

**Pros**  
- Reproducibility of every generation.  
- Debugging based on evidence, not speculation.  
- Easier evaluation and benchmarking.  
- Clear understanding of why a model behaved a certain way.  

**Cons**  
- Requires storage and discipline.  
- May expose sensitive data if not secured properly.

---

## Example

See the complete TypeScript implementation in this directory for a working example.

```typescript
import { ContextLedger } from './ledger.js';
import { AIGenerator } from './generator.js';

const ledger = new ContextLedger();
const generator = new AIGenerator(ledger);

// Context is automatically logged before generation
const result = await generator.generateWithLedger(
  'session-123',
  'What is the capital of France?',
  'You are a helpful geography assistant.'
);

// Both context and generation are now in the ledger
console.log('Result:', result.output);

// Later: reproduce the exact context that led to this result
const reproduced = ledger.reproduceContext(result.contextEntry.id);
console.log('Original prompt:', reproduced?.prompt);
```

Key insight: Instead of calling AI directly, wrap every generation with context logging. This makes failures debuggable and successes repeatable.  
