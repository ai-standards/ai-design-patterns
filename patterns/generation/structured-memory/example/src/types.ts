export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: Date;
  importance: number; // 1-10 scale
  category: 'conversation' | 'fact' | 'instruction' | 'context';
  metadata?: Record<string, any>;
}

export interface ShortTermMemory {
  entries: MemoryEntry[];
  maxEntries: number;
  maxTokens: number;
}

export interface LongTermMemory {
  entries: MemoryEntry[];
  searchIndex: Map<string, MemoryEntry[]>; // Simple keyword index
}

export interface MemoryRetrievalQuery {
  keywords?: string[];
  categories?: MemoryEntry['category'][];
  minImportance?: number;
  limit?: number;
  recency?: 'recent' | 'all';
}

export interface MemoryConfig {
  shortTermMaxEntries: number;
  shortTermMaxTokens: number;
  longTermRetentionThreshold: number; // importance threshold for long-term storage
  summarizationThreshold: number; // when to summarize old entries
}
