import type { PathCandidate, BaselineMetrics, PathScoreResult } from './types';

export interface PathScoreConfig {
  baseline: BaselineMetrics;
  minimums: {
    accuracy: number;      // Hard floor - must not regress below this
    maxLatencyMs: number;  // Hard ceiling - must not exceed this
    maxCostUsd: number;    // Hard ceiling - must not exceed this
  };
  weights: {
    accuracy: number;      // How much accuracy improvement matters
    latency: number;       // How much latency reduction matters
    cost: number;          // How much cost reduction matters
  };
}

export class PathScorer {
  constructor(private config: PathScoreConfig) {}

  scoreCandidate(candidate: PathCandidate): PathScoreResult {
    const { metrics } = candidate;
    const { baseline, minimums, weights } = this.config;

    // Check hard floors/ceilings
    const meetsMinimums = 
      metrics.accuracy >= minimums.accuracy &&
      metrics.latencyMs <= minimums.maxLatencyMs &&
      metrics.costUsd <= minimums.maxCostUsd;

    // Calculate relative impact (higher = better)
    const accuracyImpact = (metrics.accuracy - baseline.accuracy) / baseline.accuracy;
    const latencyImpact = (baseline.latencyMs - metrics.latencyMs) / baseline.latencyMs; // Inverted: lower latency is better
    const costImpact = (baseline.costUsd - metrics.costUsd) / baseline.costUsd; // Inverted: lower cost is better

    // Weighted impact score
    const impactScore = 
      accuracyImpact * weights.accuracy +
      latencyImpact * weights.latency +
      costImpact * weights.cost;

    // Simple cost score based on resource usage relative to baseline
    const tokenRatio = metrics.tokensUsed / baseline.tokensUsed;
    const costRatio = metrics.costUsd / baseline.costUsd;
    const costScore = 2 - (tokenRatio + costRatio); // Higher is better (lower resource usage)

    // Final PathScore: impact adjusted by cost efficiency
    const score = impactScore * Math.max(0.1, costScore); // Prevent negative scores

    // Decision logic
    let recommendation: 'merge' | 'reject' | 'needs-work';
    let reasoning: string;

    if (!meetsMinimums) {
      recommendation = 'reject';
      reasoning = 'Fails minimum requirements';
    } else if (score > 0.1) {
      recommendation = 'merge';
      reasoning = `Strong positive score: ${score.toFixed(3)}`;
    } else if (score > -0.05) {
      recommendation = 'needs-work';
      reasoning = `Marginal score: ${score.toFixed(3)}. Consider optimization.`;
    } else {
      recommendation = 'reject';
      reasoning = `Negative score: ${score.toFixed(3)}. Worse than baseline.`;
    }

    return {
      pathId: candidate.id,
      score,
      impactScore,
      costScore,
      meetsMinimums,
      recommendation,
      reasoning
    };
  }

  compareCandidates(candidates: PathCandidate[]): PathScoreResult[] {
    return candidates
      .map(candidate => this.scoreCandidate(candidate))
      .sort((a, b) => b.score - a.score); // Highest score first
  }

  getBestCandidate(candidates: PathCandidate[]): PathScoreResult | null {
    const scored = this.compareCandidates(candidates);
    const mergeable = scored.filter(result => result.recommendation === 'merge');
    return mergeable.length > 0 ? mergeable[0] : null;
  }
}
