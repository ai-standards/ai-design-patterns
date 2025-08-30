# Structured Memory Example

Minimal TypeScript implementation of the Structured Memory pattern for efficient AI context management.

## What it does

- **Separates short-term and long-term memory** to keep prompts focused and costs low
- **Automatically manages memory size** by moving important entries to long-term storage
- **Enables targeted retrieval** by keywords, categories, and importance
- **Builds efficient context prompts** within specified token limits

## Key insight

Instead of cramming everything into every prompt:
```ts
// Bloated approach - everything in context
const prompt = `${allHistory}\n${allFacts}\n${allInstructions}\nUser: ${question}`;
```

Manage memory in structured tiers:
```ts
// Structured approach - targeted retrieval
const memory = new MemoryManager();
const context = memory.buildContextPrompt({
  keywords: ['react', 'typescript'],
  categories: ['conversation', 'fact'],
  minImportance: 6
}, 1500); // Stay within token limit
```

## Run it

```bash
npm install
npm run dev
```

## Test it

```bash
npm test
```

## Example Usage

```typescript
import { MemoryManager } from './memory-manager.js';

const memory = new MemoryManager({
  shortTermMaxEntries: 10,     // Keep recent context lean
  shortTermMaxTokens: 2000,    // Control prompt size
  longTermRetentionThreshold: 6, // Important memories persist
  summarizationThreshold: 5    // When to summarize old content
});

// Add different types of memories with importance scores
memory.addMemory(
  "User wants to build a React app with TypeScript", 
  'conversation', 
  8  // High importance - will be retained
);

memory.addMemory(
  "React 18 introduced concurrent features", 
  'fact', 
  7
);

memory.addMemory(
  "The weather is nice today", 
  'conversation', 
  2  // Low importance - will be discarded
);

// Retrieve relevant memories for a specific context
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
}, 1500);  // Max 1500 tokens

console.log('Focused context:', contextPrompt);
```

## Features

- **Tiered memory management** - Short-term (immediate context) vs Long-term (searchable knowledge)
- **Automatic overflow handling** - Important memories move to long-term, unimportant ones are discarded
- **Keyword indexing** - Simple but effective search across stored memories
- **Category-based organization** - Separate conversation, facts, instructions, and context
- **Importance-based prioritization** - Higher importance memories are retained and prioritized
- **Token-aware context building** - Respects token limits when building prompts
- **Memory statistics** - Track usage and optimize memory configuration

## Memory Categories

- **`conversation`** - Dialog history and user interactions
- **`fact`** - Factual information and knowledge
- **`instruction`** - System instructions and guidelines  
- **`context`** - Background information and situational context

## Benefits

- **Lower costs** - Smaller, focused prompts use fewer tokens
- **Better performance** - Less irrelevant context improves model accuracy
- **Predictable scaling** - Memory usage stays bounded as conversations grow
- **Targeted retrieval** - Get exactly the context you need for each query

This transforms AI memory from "dump everything" to "retrieve what matters," making systems more efficient and effective.
