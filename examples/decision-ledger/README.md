# Decision Ledger Example

Minimal TypeScript implementation of the Decision Ledger pattern for preserving decision rationale and preventing re-litigation.

## What it does

- **Records decisions** with full context, rationale, and alternatives considered
- **Prevents re-litigation** by preserving the "why" behind each choice
- **Enables querying** past decisions by tags, stakeholders, or content
- **Tracks outcomes** and decision reversals over time

## Key insight

Instead of forgetting why decisions were made:
```ts
// Undocumented decision - context lost
const decision = "We'll use GPT-4";
// 6 months later: "Why did we choose GPT-4 again?"
```

Preserve the rationale:
```ts
// Documented decision with full context
ledger.recordDecision(
  'Choose LLM Provider',
  'Use OpenAI GPT-4 for our AI features',
  'GPT-4 provides the best balance of capability, reliability, and cost for our use case',
  'alice@company.com',
  {
    alternatives: [
      { option: 'Claude', whyRejected: 'Higher cost and API stability concerns' },
      { option: 'Llama', whyRejected: 'Team lacks ML infrastructure expertise' }
    ],
    tags: ['architecture', 'llm', 'vendor-selection']
  }
);
```

## Run it

```bash
npm install
npm run dev
```

## Test it

```bash
npm test
```

## Example Usage

```typescript
import { DecisionLedger } from './decision-ledger.js';

const ledger = new DecisionLedger();

// Record a decision with full context
const decision = ledger.recordDecision(
  'API Rate Limiting Strategy',
  'Implement exponential backoff with jitter',
  'Provides best balance of user experience and API protection. Jitter prevents thundering herd.',
  'bob@company.com',
  {
    alternatives: [
      {
        option: 'Fixed delay retry',
        pros: ['Simple to implement'],
        cons: ['Can cause thundering herd'],
        whyRejected: 'Risk of overwhelming API during outages'
      },
      {
        option: 'Circuit breaker only',
        pros: ['Fast failure'],
        cons: ['Poor user experience'],
        whyRejected: 'Users would see too many errors'
      }
    ],
    stakeholders: ['alice@company.com', 'charlie@company.com'],
    context: 'Preparing for high-traffic launch in Q2',
    tags: ['api', 'reliability', 'performance']
  }
);

// Later, record the outcome
ledger.updateOutcome(
  decision.id,
  'Implementation successful. 99.9% uptime during launch, no API overload issues.'
);

// Query past decisions to avoid re-debating
const apiDecisions = ledger.query({
  tags: ['api'],
  status: 'active'
});

console.log('Previous API decisions:');
apiDecisions.forEach(d => {
  console.log(`- ${d.title}: ${d.decision}`);
  console.log(`  Rationale: ${d.rationale}`);
});
```

## Features

- **Structured decision recording** with title, decision, rationale, and alternatives
- **Alternative tracking** - capture what was considered and why it was rejected
- **Stakeholder management** - track who was involved in each decision
- **Decision lifecycle** - active, superseded, or reversed status
- **Outcome tracking** - record what actually happened after the decision
- **Flexible querying** - search by tags, stakeholders, date, or content
- **Decision history** - track chains of related decisions
- **Report generation** - summarize decision patterns and outcomes

## Decision Statuses

- **`active`** - Current decision in effect
- **`superseded`** - Replaced by a newer decision
- **`reversed`** - Explicitly reversed due to problems

## Query Examples

```typescript
// Find all architecture decisions
const archDecisions = ledger.query({ tags: ['architecture'] });

// Find decisions by a specific person
const aliceDecisions = ledger.query({ decisionMaker: 'alice@company.com' });

// Search decision content
const apiDecisions = ledger.query({ searchText: 'API' });

// Find recent decisions
const recentDecisions = ledger.query({
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date()
  }
});
```

## Benefits

- **Prevents wasted time** on repeated debates
- **Creates institutional memory** that survives team changes
- **Enables faster onboarding** - new members can understand past decisions
- **Improves decision quality** by forcing explicit consideration of alternatives
- **Provides accountability** with clear decision makers and outcomes

This transforms decision-making from "arguing from memory" to "building on documented knowledge," making teams more efficient and decisions more durable.
