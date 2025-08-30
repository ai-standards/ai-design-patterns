export interface ContextEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  prompt: string;
  sources: Array<{ type: string; content: string }>;
  tokenCount: number;
}

export interface GenerationEntry {
  id: string;
  contextId: string;
  output: string;
  latencyMs: number;
  timestamp: string;
}

export type LedgerEntry = ContextEntry | GenerationEntry;
