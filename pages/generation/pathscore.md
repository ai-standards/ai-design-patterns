# Pattern: PathScore

**Intent**: Evaluate candidate paths with a single metric that balances impact against cost.

---

## Introduction

AI teams often struggle to decide which path to merge. Some produce higher accuracy, others run faster, others cost less. Without a common metric, debates stall and merges become political.

The **PathScore** pattern provides a simple, comparative measure. It combines relative value (impact) with relative cost (tokens, time, evaluation effort) into one number. Anything above baseline is better, anything below is worse.

---

## Problem

- No single metric to compare paths.  
- Debates devolve into opinions.  
- Cost and value are considered separately, not together.  
- Teams delay merges because criteria are unclear.  

---

## Forces

- **Simplicity vs nuance** — one number is easy to compare but cannot capture everything.  
- **Impact vs efficiency** — higher accuracy may cost more.  
- **Safety vs speed** — evaluation must be strong enough to trust.  

---

## Solution

- Define baseline metrics for value and cost.  
- Compute relative impact vs relative cost.  
- Require hard floors (no regression in quality or safety).  
- Use PathScore to guide merge-or-kill decisions.  

---

## Consequences

**Pros**  
- Provides a clear decision-making tool.  
- Reduces subjective debate.  
- Encourages cost-aware evaluation.  
- Keeps experiments accountable.  

**Cons**  
- Over-simplifies complex trade-offs.  
- Requires careful metric design.  
- Can be gamed if misapplied.

---

## Example

See the [complete TypeScript implementation](../../examples/pathscore/) for a working example.

```typescript
import { PathScorer } from './pathscore.js';

// Define baseline and scoring criteria
const scorer = new PathScorer({
  baseline: { accuracy: 0.8, latencyMs: 1000, tokensUsed: 500, costUsd: 0.10 },
  minimums: { accuracy: 0.75, maxLatencyMs: 2000, maxCostUsd: 0.20 },
  weights: { accuracy: 2.0, latency: 1.0, cost: 1.5 }
});

// Score a candidate path
const candidate = {
  id: 'improved-model',
  metrics: { accuracy: 0.92, latencyMs: 800, tokensUsed: 450, costUsd: 0.12 }
};

const result = scorer.scoreCandidate(candidate);
console.log(`Score: ${result.score.toFixed(3)}`);           // Score: 0.847
console.log(`Recommendation: ${result.recommendation}`);     // Recommendation: merge

// Compare multiple candidates
const best = scorer.getBestCandidate([candidate1, candidate2, candidate3]);
if (best?.recommendation === 'merge') {
  deployToProduction(best.pathId);
}
```

Key insight: Instead of endless debates about trade-offs, PathScore provides a single comparable metric that balances impact against cost, making merge decisions objective and automated.  
