# PathScore Example

TypeScript implementation of the PathScore pattern for evaluating AI model candidates.

## What is PathScore?

PathScore is a pattern that provides a single metric to compare different AI model paths by balancing **impact** (accuracy, latency improvements) against **cost** (tokens, money, resources). Instead of debating opinions, teams can make data-driven merge decisions.

## The Problem

When you have multiple AI model candidates, how do you decide which one to deploy?

- Path A: 95% accuracy, 2000ms latency, $0.50 per request
- Path B: 85% accuracy, 500ms latency, $0.10 per request  
- Path C: 90% accuracy, 800ms latency, $0.15 per request

Without PathScore, teams debate endlessly about trade-offs. With PathScore, you get a single comparable number for each path.

## How It Works

```typescript
import { PathScorer } from './pathscore.js';

// Define your baseline (current production system)
const scorer = new PathScorer({
  baseline: {
    accuracy: 0.8,      // 80% accuracy
    latencyMs: 1000,    // 1 second response
    tokensUsed: 500,    // 500 tokens per request
    costUsd: 0.10       // $0.10 per request
  },
  minimums: {
    accuracy: 0.75,        // Never go below 75% accuracy
    maxLatencyMs: 2000,    // Never exceed 2 seconds
    maxCostUsd: 0.20       // Never exceed $0.20 per request
  },
  weights: {
    accuracy: 2.0,         // Accuracy improvements are highly valued
    latency: 1.0,          // Latency improvements are moderately valued
    cost: 1.5             // Cost improvements are valued
  }
});

// Score a candidate
const candidate = {
  id: 'improved-model',
  name: 'GPT-4 Fine-tuned',
  description: 'Higher accuracy, slightly more expensive',
  metrics: {
    accuracy: 0.92,        // 15% improvement over baseline
    latencyMs: 800,        // 20% faster
    tokensUsed: 450,       // 10% fewer tokens
    costUsd: 0.12          // 20% more expensive
  }
};

const result = scorer.scoreCandidate(candidate);
console.log(`Score: ${result.score.toFixed(3)}`);
console.log(`Recommendation: ${result.recommendation}`);
console.log(`Reasoning: ${result.reasoning}`);
```

## Score Calculation

PathScore combines three components:

### 1. Impact Score (Weighted)
```
accuracyImpact = (candidate.accuracy - baseline.accuracy) / baseline.accuracy
latencyImpact = (baseline.latency - candidate.latency) / baseline.latency  // Inverted
costImpact = (baseline.cost - candidate.cost) / baseline.cost             // Inverted

impactScore = accuracyImpact * weight.accuracy + 
              latencyImpact * weight.latency + 
              costImpact * weight.cost
```

### 2. Cost Score (Resource Efficiency)
```
tokenRatio = candidate.tokens / baseline.tokens
costRatio = candidate.cost / baseline.cost
costScore = 2 - (tokenRatio + costRatio)  // Higher is better
```

### 3. Final PathScore
```
pathScore = impactScore * max(0.1, costScore)  // Prevent extreme negatives
```

## Decision Logic

| Score Range | Recommendation | Meaning |
|-------------|----------------|---------|
| > 0.1 | **merge** | Strong improvement over baseline |
| -0.05 to 0.1 | **needs-work** | Marginal improvement, optimize further |
| < -0.05 | **reject** | Worse than baseline |
| Any score | **reject** | If fails minimum requirements |

## Usage Examples

### Basic Scoring
```typescript
const candidates = [
  { id: 'fast', metrics: { accuracy: 0.85, latencyMs: 400, tokensUsed: 300, costUsd: 0.08 }},
  { id: 'accurate', metrics: { accuracy: 0.95, latencyMs: 1200, tokensUsed: 600, costUsd: 0.15 }},
  { id: 'cheap', metrics: { accuracy: 0.82, latencyMs: 900, tokensUsed: 400, costUsd: 0.06 }}
];

// Get all candidates ranked by score
const ranked = scorer.compareCandidates(candidates);
ranked.forEach(result => {
  console.log(`${result.pathId}: ${result.score.toFixed(3)} (${result.recommendation})`);
});
```

### Find Best Candidate
```typescript
// Get the highest-scoring candidate that meets minimums
const best = scorer.getBestCandidate(candidates);
if (best) {
  console.log(`Deploy: ${best.pathId} with score ${best.score.toFixed(3)}`);
} else {
  console.log('No candidates meet minimum requirements');
}
```

### Custom Scoring Weights
```typescript
// For a latency-critical application
const latencyFocusedScorer = new PathScorer({
  baseline: { accuracy: 0.8, latencyMs: 1000, tokensUsed: 500, costUsd: 0.10 },
  minimums: { accuracy: 0.75, maxLatencyMs: 800, maxCostUsd: 0.20 },
  weights: {
    accuracy: 1.0,     // Accuracy less important
    latency: 3.0,      // Latency very important
    cost: 1.0          // Cost moderately important
  }
});
```

## Run the Example

```bash
# Install dependencies
npm install

# Run the demo
npm run dev

# Run tests
npm test
```

## Key Benefits

1. **Objective decisions**: Replace subjective debates with quantitative scoring
2. **Cost awareness**: Automatically factors resource usage into decisions  
3. **Safety guardrails**: Hard minimums prevent regressions in critical metrics
4. **Customizable**: Adjust weights based on your application's priorities
5. **Comparable**: Single number makes it easy to rank and compare candidates

## When to Use PathScore

✅ **Good for:**
- Comparing multiple model candidates
- Making merge/deploy decisions  
- Balancing accuracy vs cost trade-offs
- Teams that get stuck in endless debates

❌ **Not ideal for:**
- Single-candidate evaluation (use evals instead)
- Complex multi-objective optimization
- When trade-offs are highly contextual
- Early exploration (too rigid for discovery phase)

## Integration with CI/CD

```typescript
// In your deployment pipeline
const scorer = new PathScorer(productionConfig);
const candidate = await evaluateModel(newModelPath);
const result = scorer.scoreCandidate(candidate);

if (result.recommendation === 'merge' && result.score > 0.2) {
  await deployToProduction(newModelPath);
  console.log(`Deployed ${candidate.id} with PathScore ${result.score.toFixed(3)}`);
} else {
  console.log(`Blocked deployment: ${result.reasoning}`);
  process.exit(1);
}
```

This makes deployment decisions automatic and auditable based on objective criteria.
