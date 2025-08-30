export interface PathMetrics {
  accuracy: number;      // 0-1, higher is better
  latencyMs: number;     // milliseconds, lower is better
  tokensUsed: number;    // count, lower is better
  costUsd: number;       // USD, lower is better
}

export interface PathCandidate {
  id: string;
  name: string;
  description: string;
  metrics: PathMetrics;
}

export interface BaselineMetrics {
  accuracy: number;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
}

export interface PathScoreResult {
  pathId: string;
  score: number;
  impactScore: number;
  costScore: number;
  meetsMinimums: boolean;
  recommendation: 'merge' | 'reject' | 'needs-work';
  reasoning: string;
}
