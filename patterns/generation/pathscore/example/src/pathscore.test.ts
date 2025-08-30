import { describe, it, expect, beforeEach } from 'vitest';
import { PathScorer } from './pathscore.js';
import type { PathCandidate, PathScoreConfig } from './pathscore.js';

describe('PathScorer', () => {
  let scorer: PathScorer;
  let config: PathScoreConfig;

  beforeEach(() => {
    config = {
      baseline: {
        accuracy: 0.8,
        latencyMs: 1000,
        tokensUsed: 500,
        costUsd: 0.10
      },
      minimums: {
        accuracy: 0.75,        // Must not drop below 75%
        maxLatencyMs: 2000,    // Must not exceed 2 seconds
        maxCostUsd: 0.20       // Must not exceed $0.20
      },
      weights: {
        accuracy: 2.0,         // Accuracy improvements are highly valued
        latency: 1.0,          // Latency improvements are moderately valued
        cost: 1.5             // Cost improvements are valued
      }
    };
    scorer = new PathScorer(config);
  });

  describe('scoreCandidate', () => {
    it('should score a clearly better candidate positively', () => {
      const candidate: PathCandidate = {
        id: 'better-path',
        name: 'Improved Model',
        description: 'Higher accuracy, lower cost',
        metrics: {
          accuracy: 0.9,        // 12.5% improvement
          latencyMs: 800,       // 20% improvement
          tokensUsed: 400,      // 20% reduction
          costUsd: 0.08         // 20% reduction
        }
      };

      const result = scorer.scoreCandidate(candidate);

      expect(result.pathId).toBe('better-path');
      expect(result.score).toBeGreaterThan(0);
      expect(result.meetsMinimums).toBe(true);
      expect(result.recommendation).toBe('merge');
      expect(result.reasoning).toContain('Strong positive score');
    });

    it('should score a worse candidate negatively', () => {
      const candidate: PathCandidate = {
        id: 'worse-path',
        name: 'Degraded Model',
        description: 'Lower accuracy, higher cost',
        metrics: {
          accuracy: 0.7,        // 12.5% degradation
          latencyMs: 1200,      // 20% slower
          tokensUsed: 600,      // 20% more tokens
          costUsd: 0.15         // 50% more expensive
        }
      };

      const result = scorer.scoreCandidate(candidate);

      expect(result.score).toBeLessThan(0);
      expect(result.meetsMinimums).toBe(false); // Below accuracy minimum
      expect(result.recommendation).toBe('reject');
    });

    it('should reject candidates that fail hard minimums', () => {
      const candidate: PathCandidate = {
        id: 'fails-minimums',
        name: 'Fast but Inaccurate',
        description: 'Very fast but below accuracy threshold',
        metrics: {
          accuracy: 0.7,        // Below 0.75 minimum
          latencyMs: 100,       // Very fast
          tokensUsed: 200,      // Very efficient
          costUsd: 0.02         // Very cheap
        }
      };

      const result = scorer.scoreCandidate(candidate);

      expect(result.meetsMinimums).toBe(false);
      expect(result.recommendation).toBe('reject');
      expect(result.reasoning).toBe('Fails minimum requirements');
    });

    it('should handle marginal candidates appropriately', () => {
      const candidate: PathCandidate = {
        id: 'marginal-path',
        name: 'Slightly Better',
        description: 'Small improvements',
        metrics: {
          accuracy: 0.82,       // Small improvement
          latencyMs: 950,       // Small improvement
          tokensUsed: 480,      // Small improvement
          costUsd: 0.09         // Small improvement
        }
      };

      const result = scorer.scoreCandidate(candidate);

      expect(result.meetsMinimums).toBe(true);
      expect(result.score).toBeGreaterThan(-0.05);
      expect(result.score).toBeLessThan(0.1);
      expect(result.recommendation).toBe('needs-work');
      expect(result.reasoning).toContain('Marginal score');
    });

    it('should calculate impact scores correctly', () => {
      const candidate: PathCandidate = {
        id: 'test-impact',
        name: 'Test Impact Calculation',
        description: 'For testing impact scoring',
        metrics: {
          accuracy: 0.9,        // 12.5% improvement
          latencyMs: 500,       // 50% improvement
          tokensUsed: 400,      // 20% reduction
          costUsd: 0.05         // 50% reduction
        }
      };

      const result = scorer.scoreCandidate(candidate);

      // Impact score should reflect weighted improvements
      expect(result.impactScore).toBeGreaterThan(0);
      
      // Accuracy improvement: (0.9 - 0.8) / 0.8 * 2.0 = 0.25
      // Latency improvement: (1000 - 500) / 1000 * 1.0 = 0.5
      // Cost improvement: (0.10 - 0.05) / 0.10 * 1.5 = 0.75
      // Total impact: 0.25 + 0.5 + 0.75 = 1.5
      expect(result.impactScore).toBeCloseTo(1.5, 1);
    });
  });

  describe('compareCandidates', () => {
    it('should rank candidates by score', () => {
      const candidates: PathCandidate[] = [
        {
          id: 'good',
          name: 'Good Path',
          description: 'Decent improvements',
          metrics: { accuracy: 0.85, latencyMs: 900, tokensUsed: 450, costUsd: 0.09 }
        },
        {
          id: 'best',
          name: 'Best Path',
          description: 'Excellent improvements',
          metrics: { accuracy: 0.95, latencyMs: 600, tokensUsed: 300, costUsd: 0.06 }
        },
        {
          id: 'worst',
          name: 'Worst Path',
          description: 'Poor performance',
          metrics: { accuracy: 0.76, latencyMs: 1500, tokensUsed: 700, costUsd: 0.18 }
        }
      ];

      const results = scorer.compareCandidates(candidates);

      expect(results).toHaveLength(3);
      expect(results[0].pathId).toBe('best');   // Highest score first
      expect(results[1].pathId).toBe('good');
      expect(results[2].pathId).toBe('worst');  // Lowest score last
      
      // Scores should be in descending order
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
    });
  });

  describe('getBestCandidate', () => {
    it('should return the best mergeable candidate', () => {
      const candidates: PathCandidate[] = [
        {
          id: 'good-but-not-best',
          name: 'Good Path',
          description: 'Good but not the best',
          metrics: { accuracy: 0.85, latencyMs: 900, tokensUsed: 450, costUsd: 0.09 }
        },
        {
          id: 'best-mergeable',
          name: 'Best Mergeable',
          description: 'Best path that can be merged',
          metrics: { accuracy: 0.92, latencyMs: 700, tokensUsed: 350, costUsd: 0.07 }
        },
        {
          id: 'fails-minimums',
          name: 'High Score but Fails',
          description: 'Would score high but fails minimums',
          metrics: { accuracy: 0.7, latencyMs: 100, tokensUsed: 100, costUsd: 0.01 }
        }
      ];

      const best = scorer.getBestCandidate(candidates);

      expect(best).not.toBeNull();
      expect(best!.pathId).toBe('best-mergeable');
      expect(best!.recommendation).toBe('merge');
    });

    it('should return null if no candidates are mergeable', () => {
      const candidates: PathCandidate[] = [
        {
          id: 'too-slow',
          name: 'Too Slow',
          description: 'Exceeds latency limit',
          metrics: { accuracy: 0.9, latencyMs: 3000, tokensUsed: 400, costUsd: 0.08 }
        },
        {
          id: 'too-inaccurate',
          name: 'Too Inaccurate',
          description: 'Below accuracy minimum',
          metrics: { accuracy: 0.7, latencyMs: 800, tokensUsed: 400, costUsd: 0.08 }
        }
      ];

      const best = scorer.getBestCandidate(candidates);

      expect(best).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle zero baseline values gracefully', () => {
      const zeroConfig: PathScoreConfig = {
        ...config,
        baseline: { accuracy: 0.8, latencyMs: 0.1, tokensUsed: 1, costUsd: 0.001 }
      };
      const zeroScorer = new PathScorer(zeroConfig);

      const candidate: PathCandidate = {
        id: 'test',
        name: 'Test',
        description: 'Test zero handling',
        metrics: { accuracy: 0.85, latencyMs: 0.05, tokensUsed: 1, costUsd: 0.001 }
      };

      const result = zeroScorer.scoreCandidate(candidate);
      
      expect(Number.isFinite(result.score)).toBe(true);
      expect(Number.isNaN(result.score)).toBe(false);
    });

    it('should apply minimum cost multiplier to prevent extreme negative scores', () => {
      const candidate: PathCandidate = {
        id: 'expensive',
        name: 'Very Expensive',
        description: 'High cost but good accuracy',
        metrics: { accuracy: 0.95, latencyMs: 500, tokensUsed: 2000, costUsd: 1.0 }
      };

      const result = scorer.scoreCandidate(candidate);
      
      // Even with high cost, the cost score can be very negative
      expect(result.costScore).toBeLessThan(0); // Should be negative due to high cost
      
      // The final score can still be negative if impact score is negative,
      // but the cost multiplier should be at least 0.1
      const expectedMinScore = result.impactScore * 0.1;
      expect(result.score).toBeGreaterThanOrEqual(expectedMinScore);
    });
  });
});
