# PathScore Implementation

A TypeScript implementation of the PathScore pattern that provides a single-number evaluation metric for comparing AI path candidates before merging, balancing impact against cost.

## Why PathScore?

### The Problem

AI teams often struggle with path evaluation and merge decisions:

```typescript
// Which path should we merge?
const pathA = { accuracy: 0.85, latency: 1200, cost: 0.15 };
const pathB = { accuracy: 0.82, latency: 800, cost: 0.08 };
const pathC = { accuracy: 0.88, latency: 1500, cost: 0.20 };

// Manual comparison is subjective and inconsistent
// - Path A has good accuracy but higher cost
// - Path B is fast and cheap but less accurate  
// - Path C is most accurate but slowest and most expensive
// Which wins? Depends on who's deciding and when.
```

This leads to:
- **Inconsistent decisions**: Different people prioritize different metrics
- **Analysis paralysis**: Too many dimensions to compare manually
- **Subjective merges**: Politics and preferences override data
- **Regression risk**: No systematic way to ensure improvements

### The Solution

PathScore provides a single, objective metric that balances all dimensions:

```typescript
const scorer = new PathScorer({
  baseline: { accuracy: 0.8, latencyMs: 1000, tokensUsed: 500, costUsd: 0.10 },
  minimums: { accuracy: 0.75, maxLatencyMs: 2000, maxCostUsd: 0.20 },
  weights: { accuracy: 2.0, latency: 1.0, cost: 1.5 }
});

// Score all candidates with a single number
const results = scorer.compareCandidates([pathA, pathB, pathC]);
console.log('Best path:', results[0].pathId);
console.log('Score:', results[0].score);
console.log('Recommendation:', results[0].recommendation);

// Objective, repeatable decision
if (results[0].recommendation === 'merge') {
  deployToProduction(results[0].pathId);
}
```

Now path evaluation is:
- **Objective**: Same inputs always produce same scores
- **Balanced**: Considers impact vs. cost automatically
- **Consistent**: Same evaluation criteria across all paths
- **Actionable**: Clear merge/reject/needs-work recommendations

## How It Works

### Core Components

#### 1. **Types** (`src/types.ts`)

Defines the data structures for path evaluation:

- **PathMetrics**: Core performance metrics (accuracy, latency, tokens, cost)
- **PathCandidate**: A complete path proposal with ID, description, and metrics
- **BaselineMetrics**: Current production performance to compare against
- **PathScoreResult**: Complete scoring result with recommendation

#### 2. **PathScorer** (`src/pathscore.ts`)

The core scoring engine that evaluates path candidates:

```typescript
const scorer = new PathScorer({
  baseline: currentProductionMetrics,
  minimums: hardRequirements,
  weights: teamPriorities
});

const result = scorer.scoreCandidate(candidate);
```

**Key Methods:**
- `scoreCandidate()`: Evaluates a single path against baseline
- `compareCandidates()`: Scores and ranks multiple paths
- `getBestCandidate()`: Returns the highest-scoring mergeable path

#### 3. **Scoring Algorithm**

The PathScore calculation balances impact against cost:

```typescript
// 1. Check hard requirements (must pass to be viable)
const meetsMinimums = 
  metrics.accuracy >= minimums.accuracy &&
  metrics.latencyMs <= minimums.maxLatencyMs &&
  metrics.costUsd <= minimums.maxCostUsd;

// 2. Calculate relative improvements (vs baseline)
const accuracyImpact = (metrics.accuracy - baseline.accuracy) / baseline.accuracy;
const latencyImpact = (baseline.latencyMs - metrics.latencyMs) / baseline.latencyMs;
const costImpact = (baseline.costUsd - metrics.costUsd) / baseline.costUsd;

// 3. Weight the improvements by team priorities
const impactScore = 
  accuracyImpact * weights.accuracy +
  latencyImpact * weights.latency +
  costImpact * weights.cost;

// 4. Adjust for resource efficiency
const costScore = 2 - (tokenRatio + costRatio);

// 5. Final score: impact adjusted by efficiency
const score = impactScore * Math.max(0.1, costScore);
```

### Decision Logic

PathScore provides clear, automated recommendations:

- **Reject**: Fails minimum requirements or strongly negative score
- **Merge**: Meets minimums and has positive score above threshold
- **Needs Work**: Meets minimums but marginal score - consider optimization

## Configuration

### Baseline Metrics
Current production performance to compare against:

```typescript
baseline: {
  accuracy: 0.8,        // Current model accuracy
  latencyMs: 1000,      // Current response time
  tokensUsed: 500,      // Current token usage
  costUsd: 0.10         // Current cost per request
}
```

### Minimum Requirements
Hard floors and ceilings that candidates must meet:

```typescript
minimums: {
  accuracy: 0.75,       // Never accept below 75% accuracy
  maxLatencyMs: 2000,   // Never accept above 2 second latency
  maxCostUsd: 0.20      // Never accept above $0.20 per request
}
```

### Priority Weights
How much each improvement dimension matters to your team:

```typescript
weights: {
  accuracy: 2.0,        // Accuracy improvements are highly valued
  latency: 1.0,         // Latency improvements are moderately valued  
  cost: 1.5             // Cost improvements are valued
}
```

## Usage Examples

### Basic Scoring
```typescript
const scorer = new PathScorer(config);

const candidate = {
  id: 'improved-model',
  name: 'GPT-4 Turbo',
  description: 'Higher accuracy with lower cost',
  metrics: {
    accuracy: 0.92,      // 15% improvement
    latencyMs: 800,      // 20% improvement
    tokensUsed: 450,     // 10% reduction
    costUsd: 0.12        // 20% increase
  }
};

const result = scorer.scoreCandidate(candidate);
console.log(`Score: ${result.score.toFixed(3)}`);
console.log(`Recommendation: ${result.recommendation}`);
```

### Comparing Multiple Paths
```typescript
const candidates = [
  { id: 'fast-path', metrics: { accuracy: 0.82, latencyMs: 600, ... } },
  { id: 'accurate-path', metrics: { accuracy: 0.95, latencyMs: 1200, ... } },
  { id: 'cheap-path', metrics: { accuracy: 0.79, latencyMs: 1000, ... } }
];

const results = scorer.compareCandidates(candidates);
results.forEach(result => {
  console.log(`${result.pathId}: ${result.score.toFixed(3)} (${result.recommendation})`);
});
```

### Automated Decision Making
```typescript
const best = scorer.getBestCandidate(allCandidates);

if (best?.recommendation === 'merge') {
  console.log(`Deploying ${best.pathId} with score ${best.score.toFixed(3)}`);
  deployToProduction(best.pathId);
} else {
  console.log('No candidates meet merge criteria');
  console.log('Top candidate needs work:', best?.reasoning);
}
```

## Benefits in Practice

### 1. **Objective Decisions**
```typescript
// Before: Subjective debates
// "I think we should prioritize accuracy over cost"
// "But latency is more important to users"
// "Let's just ship the one that feels right"

// After: Data-driven decisions
const result = scorer.scoreCandidate(candidate);
console.log(`Score: ${result.score}, Recommendation: ${result.recommendation}`);
console.log(`Reasoning: ${result.reasoning}`);
```

### 2. **Consistent Evaluation**
- Same scoring criteria applied to all paths
- Reproducible results across team members
- Historical comparison of path decisions

### 3. **Balanced Trade-offs**
- Automatically balances multiple competing metrics
- Prevents over-optimization of single dimensions
- Considers both impact and resource efficiency

### 4. **Clear Thresholds**
- Hard minimums prevent regressions
- Score thresholds create consistent merge criteria
- "Needs work" category guides optimization efforts

## Real-World Scenarios

### E-commerce Recommendation System
```typescript
const ecommerceScorer = new PathScorer({
  baseline: { accuracy: 0.75, latencyMs: 500, tokensUsed: 200, costUsd: 0.05 },
  minimums: { accuracy: 0.70, maxLatencyMs: 1000, maxCostUsd: 0.10 },
  weights: { accuracy: 3.0, latency: 2.0, cost: 1.0 } // Accuracy and speed critical
});
```

### Content Moderation
```typescript
const moderationScorer = new PathScorer({
  baseline: { accuracy: 0.95, latencyMs: 2000, tokensUsed: 800, costUsd: 0.20 },
  minimums: { accuracy: 0.90, maxLatencyMs: 5000, maxCostUsd: 0.50 },
  weights: { accuracy: 5.0, latency: 1.0, cost: 0.5 } // Accuracy paramount
});
```

### Customer Support Chatbot
```typescript
const supportScorer = new PathScorer({
  baseline: { accuracy: 0.85, latencyMs: 1500, tokensUsed: 600, costUsd: 0.15 },
  minimums: { accuracy: 0.80, maxLatencyMs: 3000, maxCostUsd: 0.25 },
  weights: { accuracy: 2.0, latency: 3.0, cost: 1.0 } // Response time critical
});
```

## Running the Example

```bash
# Install dependencies
npm install

# Run the demo
npm run dev

# Run tests
npm test
```

The demo shows:
1. **Basic Scoring**: How individual paths are evaluated
2. **Comparison**: Ranking multiple candidates by score
3. **Decision Logic**: Automatic merge/reject/needs-work recommendations
4. **Edge Cases**: Handling paths that fail minimum requirements

## Production Considerations

### Baseline Updates
```typescript
// Update baseline as production improves
const newBaseline = await measureCurrentProductionMetrics();
scorer.updateBaseline(newBaseline);
```

### Dynamic Weights
```typescript
// Adjust weights based on business priorities
const weights = isBlackFriday ? 
  { accuracy: 2.0, latency: 5.0, cost: 0.5 } :  // Speed critical during peak
  { accuracy: 3.0, latency: 1.0, cost: 2.0 };   // Normal priorities
```

### A/B Testing Integration
```typescript
// Score A/B test results automatically
const abTestResults = await runABTest(candidate);
const pathWithResults = { ...candidate, metrics: abTestResults };
const score = scorer.scoreCandidate(pathWithResults);
```

### Historical Tracking
```typescript
// Track scoring decisions over time
const decision = {
  timestamp: new Date(),
  pathId: result.pathId,
  score: result.score,
  recommendation: result.recommendation,
  actualOutcome: null // Fill in later
};
decisionHistory.push(decision);
```

## Testing Strategies

### Unit Tests
```typescript
describe('PathScorer', () => {
  it('should prefer accuracy improvements when weighted highly', () => {
    const highAccuracyWeights = { accuracy: 5.0, latency: 1.0, cost: 1.0 };
    const scorer = new PathScorer({ ...config, weights: highAccuracyWeights });
    
    const result = scorer.scoreCandidate(highAccuracyCandidate);
    expect(result.score).toBeGreaterThan(baselineScore);
  });
});
```

### Integration Tests
```typescript
it('should handle real-world metric variations', async () => {
  const realMetrics = await collectProductionMetrics();
  const result = scorer.scoreCandidate({ ...candidate, metrics: realMetrics });
  expect(result.recommendation).toBeOneOf(['merge', 'reject', 'needs-work']);
});
```

## Key Insights

1. **Single Metric**: One number that captures all trade-offs
2. **Baseline Relative**: Scores are relative to current performance, not absolute
3. **Minimum Gates**: Hard requirements prevent unacceptable regressions
4. **Weighted Impact**: Team priorities are encoded in weights, not debates
5. **Actionable Output**: Clear recommendations drive consistent decisions

This implementation shows how PathScore transforms subjective path evaluation into objective, data-driven merge decisions that balance impact against cost while respecting hard constraints.
