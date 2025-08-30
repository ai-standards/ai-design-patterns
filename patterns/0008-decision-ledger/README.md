# Pattern: Decision Ledger

**Intent**: Preserve the rationale behind decisions so teams don’t relitigate them later.

---

## Introduction

In fast-moving AI projects, decisions pile up quickly. Without documentation, history is lost. Months later, teams forget why a path was chosen or a launch was rolled back. Arguments repeat, wasting time.

The **Decision Ledger** pattern solves this by recording every major decision along with its rationale. It’s not about bureaucracy; it’s about memory. A simple log prevents old debates from resurfacing and provides context for future builders.

---

## Problem

- Decisions are forgotten and relitigated.  
- New team members lack context.  
- Institutional knowledge lives only in people’s heads.  

---

## Forces

- **Speed vs clarity** — writing things down takes time, but saves more later.  
- **Detail vs simplicity** — too much record-keeping is ignored, too little is useless.  

---

## Solution

- Record every decision with: date, decision, rationale, and alternatives considered.  
- Store in a simple, accessible ledger.  
- Reference the ledger in future debates.  

---

## Consequences

**Pros**  
- Prevents wasted time on repeated debates.  
- Creates institutional memory.  
- Onboards new members faster.  

**Cons**  
- Requires discipline to keep updated.  
- Can become noise if over-detailed.

---

## Example

See the complete TypeScript implementation in this directory for a working example.

```typescript
import { DecisionLedger } from './decision-ledger.js';

const ledger = new DecisionLedger();

// Record a decision with full context and alternatives
const decision = ledger.recordDecision(
  'Choose LLM Provider',
  'Use OpenAI GPT-4 for our AI features',
  'GPT-4 provides the best balance of capability, reliability, and cost for our use case',
  'alice@company.com',
  {
    alternatives: [
      {
        option: 'Anthropic Claude',
        pros: ['Good safety features', 'Long context window'],
        cons: ['Higher cost', 'Less mature API'],
        whyRejected: 'Cost concerns and API stability questions'
      },
      {
        option: 'Open-source Llama',
        pros: ['No API costs', 'Full control'],
        cons: ['Infrastructure complexity', 'Lower quality'],
        whyRejected: 'Team lacks ML infrastructure expertise'
      }
    ],
    stakeholders: ['alice@company.com', 'bob@company.com', 'charlie@company.com'],
    context: 'Building customer support chatbot for Q2 launch',
    tags: ['architecture', 'llm', 'vendor-selection']
  }
);

// Later, record what actually happened
ledger.updateOutcome(
  decision.id,
  'GPT-4 integration successful. 95% user satisfaction, 40% reduction in support tickets.'
);

// Months later, avoid re-debating by querying past decisions
const llmDecisions = ledger.query({
  tags: ['llm'],
  status: 'active'
});

console.log('Previous LLM decisions:');
llmDecisions.forEach(d => {
  console.log(`${d.title}: ${d.decision}`);
  console.log(`Rationale: ${d.rationale}`);
  if (d.outcome) console.log(`Outcome: ${d.outcome}`);
});
```

Key insight: Instead of forgetting why decisions were made and re-debating them months later, preserve the full context and rationale. This creates institutional memory that prevents wasted time and helps new team members understand the reasoning behind current choices.  
