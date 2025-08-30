import type { 
  MemoryEntry, 
  ShortTermMemory, 
  LongTermMemory, 
  MemoryRetrievalQuery, 
  MemoryConfig 
} from './types.js';

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;
  private config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      shortTermMaxEntries: 10,
      shortTermMaxTokens: 2000,
      longTermRetentionThreshold: 6,
      summarizationThreshold: 5,
      ...config
    };

    this.shortTerm = {
      entries: [],
      maxEntries: this.config.shortTermMaxEntries,
      maxTokens: this.config.shortTermMaxTokens
    };

    this.longTerm = {
      entries: [],
      searchIndex: new Map()
    };
  }

  addMemory(content: string, category: MemoryEntry['category'], importance: number = 5, metadata?: Record<string, any>): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      timestamp: new Date(),
      importance,
      category,
      metadata
    };

    // Add to short-term memory
    this.shortTerm.entries.push(entry);

    // Manage short-term memory size
    this.manageShortTermMemory();

    // Index for long-term retrieval
    this.indexEntry(entry);

    return entry;
  }

  private manageShortTermMemory(): void {
    // Remove excess entries by count
    while (this.shortTerm.entries.length > this.shortTerm.maxEntries) {
      const removed = this.shortTerm.entries.shift();
      if (removed && removed.importance >= this.config.longTermRetentionThreshold) {
        this.moveToLongTerm(removed);
      }
    }

    // Remove excess entries by token count (rough estimation)
    let totalTokens = this.estimateTokens(this.shortTerm.entries);
    while (totalTokens > this.shortTerm.maxTokens && this.shortTerm.entries.length > 1) {
      const removed = this.shortTerm.entries.shift();
      if (removed && removed.importance >= this.config.longTermRetentionThreshold) {
        this.moveToLongTerm(removed);
      }
      totalTokens = this.estimateTokens(this.shortTerm.entries);
    }
  }

  private moveToLongTerm(entry: MemoryEntry): void {
    this.longTerm.entries.push(entry);
    console.log(`Moved to long-term: ${entry.content.substring(0, 50)}...`);
  }

  private indexEntry(entry: MemoryEntry): void {
    // Simple keyword indexing
    const keywords = this.extractKeywords(entry.content);
    keywords.forEach(keyword => {
      if (!this.longTerm.searchIndex.has(keyword)) {
        this.longTerm.searchIndex.set(keyword, []);
      }
      this.longTerm.searchIndex.get(keyword)!.push(entry);
    });
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - split on spaces, filter short words
    return text.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !/^(the|and|but|for|are|with|they|this|that|from|have|been|will|would|could|should)$/.test(word))
      .slice(0, 5); // Limit keywords per entry
  }

  private estimateTokens(entries: MemoryEntry[]): number {
    // Rough token estimation: ~4 characters per token
    return entries.reduce((total, entry) => total + Math.ceil(entry.content.length / 4), 0);
  }

  retrieveRelevant(query: MemoryRetrievalQuery): MemoryEntry[] {
    let candidates: MemoryEntry[] = [];

    // Start with short-term memory (always included)
    candidates = [...this.shortTerm.entries];

    // Add relevant long-term memories
    if (query.keywords && query.keywords.length > 0) {
      const longTermMatches = this.searchLongTerm(query.keywords);
      candidates = [...candidates, ...longTermMatches];
    }

    // Filter by category if specified
    if (query.categories && query.categories.length > 0) {
      candidates = candidates.filter(entry => query.categories!.includes(entry.category));
    }

    // Filter by importance if specified
    if (query.minImportance) {
      candidates = candidates.filter(entry => entry.importance >= query.minImportance!);
    }

    // Filter by recency if specified
    if (query.recency === 'recent') {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      candidates = candidates.filter(entry => entry.timestamp > oneHourAgo);
    }

    // Remove duplicates and sort by importance and recency
    const unique = Array.from(new Map(candidates.map(e => [e.id, e])).values());
    unique.sort((a, b) => {
      // Sort by importance first, then by recency
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    // Apply limit
    if (query.limit) {
      return unique.slice(0, query.limit);
    }

    return unique;
  }

  private searchLongTerm(keywords: string[]): MemoryEntry[] {
    const matches = new Set<MemoryEntry>();
    
    keywords.forEach(keyword => {
      const entries = this.longTerm.searchIndex.get(keyword.toLowerCase());
      if (entries) {
        entries.forEach(entry => matches.add(entry));
      }
    });

    return Array.from(matches);
  }

  buildContextPrompt(query: MemoryRetrievalQuery, maxTokens: number = 1500): string {
    const relevantMemories = this.retrieveRelevant(query);
    let prompt = '';
    let tokenCount = 0;

    // Add memories until we hit token limit
    for (const memory of relevantMemories) {
      const memoryTokens = Math.ceil(memory.content.length / 4);
      if (tokenCount + memoryTokens > maxTokens) {
        break;
      }

      prompt += `[${memory.category.toUpperCase()}]: ${memory.content}\n`;
      tokenCount += memoryTokens;
    }

    return prompt.trim();
  }

  summarizeOldMemories(): void {
    // Find old, low-importance memories to summarize
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const oldMemories = this.longTerm.entries.filter(
      entry => entry.timestamp < cutoffDate && entry.importance < this.config.summarizationThreshold
    );

    if (oldMemories.length > 5) {
      // Group by category and create summaries
      const categories = new Set(oldMemories.map(m => m.category));
      categories.forEach(category => {
        const categoryMemories = oldMemories.filter(m => m.category === category);
        if (categoryMemories.length > 3) {
          const summary = this.createSummary(categoryMemories);
          
          // Remove old memories and add summary
          this.longTerm.entries = this.longTerm.entries.filter(
            entry => !categoryMemories.includes(entry)
          );
          
          // Add summary as new memory
          this.addMemory(summary, category, this.config.summarizationThreshold + 1, {
            isSummary: true,
            originalCount: categoryMemories.length
          });
        }
      });
    }
  }

  private createSummary(memories: MemoryEntry[]): string {
    // Simple summarization - extract key points
    const contents = memories.map(m => m.content);
    const wordFreq = new Map<string, number>();
    
    contents.forEach(content => {
      const words = this.extractKeywords(content);
      words.forEach(word => {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      });
    });

    const topWords = Array.from(wordFreq.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);

    return `Summary of ${memories.length} ${memories[0].category} entries: Key topics include ${topWords.join(', ')}. Contains information about recent interactions and context.`;
  }

  getMemoryStats(): {
    shortTerm: { count: number; tokens: number };
    longTerm: { count: number; indexed: number };
  } {
    return {
      shortTerm: {
        count: this.shortTerm.entries.length,
        tokens: this.estimateTokens(this.shortTerm.entries)
      },
      longTerm: {
        count: this.longTerm.entries.length,
        indexed: this.longTerm.searchIndex.size
      }
    };
  }

  clear(): void {
    this.shortTerm.entries = [];
    this.longTerm.entries = [];
    this.longTerm.searchIndex.clear();
  }
}
