# Structured Memory Implementation

A TypeScript implementation of the Structured Memory pattern that manages AI model memory explicitly by separating short-term and long-term context with importance-based retention and keyword-based retrieval.

## Why Structured Memory?

### The Problem

Most AI applications handle context memory poorly, leading to several critical issues:

```typescript
// Naive approach: Dump everything into context
const conversationHistory = [
  "User wants to build a React app",
  "User prefers TypeScript", 
  "The weather is nice today",
  "User mentioned they like pizza",
  "Database should be PostgreSQL",
  "User asked about authentication",
  "Random comment about sports",
  "Important: This is an e-commerce platform",
  // ... 50 more messages
];

// Problems:
// 1. Context bloat: Irrelevant info consumes tokens
// 2. Token limits: Eventually hits model context window
// 3. Poor relevance: Important info buried in noise
// 4. No prioritization: All memories treated equally
// 5. No retrieval: Can't find specific information efficiently
```

This leads to:
- **Prompt bloat**: Wasted tokens on irrelevant context
- **Lost information**: Important details pushed out by token limits
- **Poor performance**: Model confused by too much irrelevant context
- **Unreliable behavior**: Critical information randomly excluded

### The Solution

Structured Memory manages context in tiers with explicit importance and retrieval:

```typescript
const memory = new MemoryManager({
  shortTermMaxEntries: 10,       // Keep recent context lean
  shortTermMaxTokens: 2000,      // Control prompt size
  longTermRetentionThreshold: 6, // Important memories persist
  summarizationThreshold: 5      // When to summarize old content
});

// Add memories with importance scores
memory.addMemory(
  "User wants to build a React app with TypeScript", 
  'conversation', 
  8  // High importance - will persist
);

memory.addMemory(
  "The weather is nice today", 
  'conversation', 
  2  // Low importance - will be discarded
);

// Retrieve only relevant memories for current context
const relevant = memory.retrieveRelevant({
  keywords: ['react', 'typescript'],
  categories: ['conversation', 'fact'],
  minImportance: 6,
  limit: 5
});

// Build focused context prompt within token limits
const contextPrompt = memory.buildContextPrompt({
  keywords: ['react', 'app'],
  minImportance: 7
}, 1500);  // Stay within 1500 token limit
```

Now memory management is:
- **Tiered**: Short-term for recent context, long-term for important information
- **Selective**: Only relevant memories included in prompts
- **Bounded**: Explicit token and entry limits prevent bloat
- **Searchable**: Keyword-based retrieval finds specific information

## How It Works

### Core Components

#### 1. **Types** (`src/types.ts`)

Defines the memory data structures:

- **MemoryEntry**: Individual memory with content, importance, category, and metadata
- **ShortTermMemory**: Recent context with size limits
- **LongTermMemory**: Persistent memories with search indexing
- **MemoryRetrievalQuery**: Flexible query interface for finding relevant memories

#### 2. **MemoryManager** (`src/memory-manager.ts`)

The core memory management system:

```typescript
const memory = new MemoryManager({
  shortTermMaxEntries: 10,
  shortTermMaxTokens: 2000,
  longTermRetentionThreshold: 6,
  summarizationThreshold: 5
});
```

**Key Methods:**
- `addMemory()`: Add new memories with importance scoring
- `retrieveRelevant()`: Find memories matching query criteria
- `buildContextPrompt()`: Create focused context within token limits
- `summarizeOldMemories()`: Compress old, low-importance memories

### Memory Tiers

#### Short-Term Memory
- **Purpose**: Recent conversation context
- **Limits**: Max entries and token count
- **Behavior**: FIFO with importance-based retention
- **Use Case**: Immediate context for current interaction

#### Long-Term Memory
- **Purpose**: Important information that should persist
- **Limits**: No size limits, but searchable by relevance
- **Behavior**: Importance-based storage with keyword indexing
- **Use Case**: Domain knowledge, user preferences, critical facts

### Memory Lifecycle

1. **Addition**: New memories added to short-term with importance scores
2. **Management**: Short-term overflow moves important memories to long-term
3. **Indexing**: Keywords extracted and indexed for fast retrieval
4. **Retrieval**: Relevant memories found via keyword and category search
5. **Context Building**: Selected memories formatted into prompts within token limits
6. **Summarization**: Old, low-importance memories compressed to save space

```typescript
// Lifecycle example
memory.addMemory("User wants authentication", 'conversation', 8);
// 1. Added to short-term
// 2. Keywords extracted: ["user", "wants", "authentication"]
// 3. Indexed for future retrieval

// When short-term overflows:
// 4. High importance (8 >= 6) → moved to long-term
// 5. Low importance → discarded

// Later retrieval:
const relevant = memory.retrieveRelevant({
  keywords: ['authentication'],
  minImportance: 6
});
// 6. Finds the memory via keyword index
// 7. Returns because importance meets threshold
```

## Usage Examples

### Basic Memory Management
```typescript
const memory = new MemoryManager();

// Add conversation context
memory.addMemory(
  "User is building an e-commerce platform", 
  'conversation', 
  9  // Very important
);

memory.addMemory(
  "User prefers React over Vue", 
  'conversation', 
  7  // Important
);

memory.addMemory(
  "User mentioned the weather", 
  'conversation', 
  2  // Not important
);

// Check memory distribution
console.log(memory.getMemoryStats());
// { shortTerm: { count: 3, tokens: 45 }, longTerm: { count: 0, indexed: 6 } }
```

### Targeted Retrieval
```typescript
// Find memories about React
const reactMemories = memory.retrieveRelevant({
  keywords: ['react', 'components'],
  categories: ['conversation', 'fact'],
  minImportance: 6,
  limit: 3
});

// Find recent high-importance memories
const recentImportant = memory.retrieveRelevant({
  minImportance: 8,
  recency: 'recent',
  limit: 5
});
```

### Context Prompt Building
```typescript
// Build focused context for AI generation
const contextPrompt = memory.buildContextPrompt({
  keywords: ['react', 'typescript', 'authentication'],
  categories: ['conversation', 'instruction'],
  minImportance: 6
}, 1500);  // Stay within 1500 tokens

console.log('Context for AI:');
console.log(contextPrompt);
// Output:
// [CONVERSATION]: User wants to build a React app with TypeScript
// [CONVERSATION]: User needs authentication system
// [INSTRUCTION]: Use JWT tokens for authentication
```

### Memory Categories
```typescript
// Different types of memories
memory.addMemory("User prefers dark mode", 'conversation', 6);
memory.addMemory("React 18 has concurrent features", 'fact', 8);
memory.addMemory("Always validate user input", 'instruction', 9);
memory.addMemory("Working on e-commerce platform", 'context', 8);

// Retrieve by category
const instructions = memory.retrieveRelevant({
  categories: ['instruction'],
  minImportance: 7
});
```

## Benefits in Practice

### 1. **Controlled Context Size**
```typescript
// Before: Uncontrolled growth
let context = "";
messages.forEach(msg => context += msg); // Eventually hits token limits

// After: Bounded, relevant context
const contextPrompt = memory.buildContextPrompt(query, maxTokens);
// Always stays within limits, prioritizes relevance
```

### 2. **Importance-Based Retention**
```typescript
// High-importance memories persist
memory.addMemory("User's main goal: build CRM system", 'context', 10);

// Low-importance memories get discarded
memory.addMemory("User said hello", 'conversation', 1);

// Later: CRM context available, hello forgotten
const relevant = memory.retrieveRelevant({ minImportance: 5 });
```

### 3. **Efficient Information Retrieval**
```typescript
// Find specific information quickly
const authMemories = memory.retrieveRelevant({
  keywords: ['authentication', 'login', 'security'],
  categories: ['conversation', 'instruction']
});

// No need to scan entire conversation history
```

### 4. **Adaptive Memory Management**
```typescript
// Memory automatically adapts to usage patterns
memory.summarizeOldMemories(); // Compresses old, low-importance entries

// Keeps memory lean while preserving important information
```

## Real-World Applications

### Conversational AI Assistant
```typescript
const assistantMemory = new MemoryManager({
  shortTermMaxEntries: 15,     // Recent conversation
  shortTermMaxTokens: 2500,    // Generous recent context
  longTermRetentionThreshold: 7, // Important preferences persist
  summarizationThreshold: 4    // Aggressive summarization
});

// Track user preferences
assistantMemory.addMemory("User prefers concise explanations", 'context', 8);

// Track conversation flow
assistantMemory.addMemory("User asked about machine learning", 'conversation', 6);

// Build context for response
const context = assistantMemory.buildContextPrompt({
  keywords: ['machine', 'learning'],
  categories: ['context', 'conversation']
}, 2000);
```

### Code Review Assistant
```typescript
const codeMemory = new MemoryManager({
  shortTermMaxEntries: 8,      // Recent code context
  longTermRetentionThreshold: 6, // Code standards persist
  summarizationThreshold: 3    // Quick summarization
});

// Remember code standards
codeMemory.addMemory("Team uses ESLint with Airbnb config", 'instruction', 9);

// Remember current context
codeMemory.addMemory("Reviewing authentication module", 'context', 7);

// Find relevant standards for review
const standards = codeMemory.retrieveRelevant({
  keywords: ['authentication', 'security'],
  categories: ['instruction']
});
```

### Educational Tutor
```typescript
const tutorMemory = new MemoryManager({
  shortTermMaxEntries: 12,     // Recent learning context
  longTermRetentionThreshold: 8, // Learning progress persists
  summarizationThreshold: 5    // Moderate summarization
});

// Track learning progress
tutorMemory.addMemory("Student struggles with recursion concepts", 'context', 9);

// Track successful explanations
tutorMemory.addMemory("Visual tree diagram helped explain recursion", 'instruction', 8);

// Build personalized context
const context = tutorMemory.buildContextPrompt({
  keywords: ['recursion'],
  categories: ['context', 'instruction']
}, 1800);
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

The demo demonstrates:
1. **Memory Addition**: Adding memories with different importance levels
2. **Automatic Management**: How overflow triggers long-term storage
3. **Targeted Retrieval**: Finding specific memories by keywords and categories
4. **Context Building**: Creating focused prompts within token limits
5. **Mixed Categories**: Working with conversation, facts, and instructions

## Production Considerations

### Memory Persistence
```typescript
// Save/load memory state
class PersistentMemoryManager extends MemoryManager {
  async save(): Promise<void> {
    const state = {
      shortTerm: this.shortTerm,
      longTerm: this.longTerm.entries,
      searchIndex: Array.from(this.longTerm.searchIndex.entries())
    };
    await fs.writeFile('memory.json', JSON.stringify(state));
  }
  
  async load(): Promise<void> {
    const state = JSON.parse(await fs.readFile('memory.json', 'utf8'));
    this.shortTerm = state.shortTerm;
    this.longTerm.entries = state.longTerm;
    this.longTerm.searchIndex = new Map(state.searchIndex);
  }
}
```

### Advanced Retrieval
```typescript
// Semantic similarity (requires embedding model)
async retrieveBySimilarity(query: string, limit: number = 5): Promise<MemoryEntry[]> {
  const queryEmbedding = await this.embedText(query);
  const similarities = await Promise.all(
    this.getAllMemories().map(async (memory) => ({
      memory,
      similarity: await this.cosineSimilarity(queryEmbedding, memory.embedding)
    }))
  );
  
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(item => item.memory);
}
```

### Memory Analytics
```typescript
// Track memory effectiveness
class AnalyticsMemoryManager extends MemoryManager {
  private retrievalStats = new Map<string, number>();
  
  retrieveRelevant(query: MemoryRetrievalQuery): MemoryEntry[] {
    const results = super.retrieveRelevant(query);
    
    // Track which memories are retrieved most
    results.forEach(memory => {
      this.retrievalStats.set(
        memory.id, 
        (this.retrievalStats.get(memory.id) || 0) + 1
      );
    });
    
    return results;
  }
  
  getPopularMemories(): MemoryEntry[] {
    const sortedStats = Array.from(this.retrievalStats.entries())
      .sort(([,a], [,b]) => b - a);
    
    return sortedStats.map(([id]) => this.findMemoryById(id)).filter(Boolean);
  }
}
```

### Performance Optimization
- **Batch Operations**: Process multiple memories efficiently
- **Index Optimization**: Use more sophisticated indexing (e.g., inverted index)
- **Memory Pooling**: Reuse memory objects to reduce GC pressure
- **Async Processing**: Handle summarization in background

## Testing Strategies

### Unit Tests
```typescript
describe('MemoryManager', () => {
  it('should move high-importance memories to long-term storage', () => {
    const memory = new MemoryManager({ shortTermMaxEntries: 2 });
    
    memory.addMemory('Important info', 'conversation', 8);
    memory.addMemory('Less important', 'conversation', 4);
    memory.addMemory('Trigger overflow', 'conversation', 3);
    
    const longTermCount = memory.getMemoryStats().longTerm.count;
    expect(longTermCount).toBe(1); // High-importance memory moved
  });
});
```

### Integration Tests
```typescript
describe('Memory Retrieval', () => {
  it('should find relevant memories across tiers', async () => {
    const memory = new MemoryManager();
    
    // Add memories that will end up in different tiers
    memory.addMemory('React application', 'conversation', 8);
    // ... trigger tier movement ...
    
    const results = memory.retrieveRelevant({
      keywords: ['react'],
      minImportance: 6
    });
    
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('React application');
  });
});
```

## Key Insights

1. **Tiered Storage**: Separate short-term and long-term memory with different purposes
2. **Importance Scoring**: Explicit priority system determines what persists
3. **Bounded Context**: Token and entry limits prevent uncontrolled growth
4. **Selective Retrieval**: Query-based access to relevant information only
5. **Automatic Management**: System handles tier transitions and summarization
6. **Category Organization**: Different types of memories for different use cases

This implementation demonstrates how Structured Memory transforms chaotic context management into organized, efficient, and scalable memory systems that keep AI interactions focused and relevant while preventing context bloat.
