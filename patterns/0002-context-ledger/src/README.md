# Context Ledger Implementation

A TypeScript implementation of the Context Ledger pattern that makes AI prompt assembly explicit, auditable, and reproducible.

## Why Context Ledger?

### The Problem

Most AI applications treat prompt construction as an invisible step:

```typescript
// What actually happened here?
const response = await openai.chat.completions.create({
  messages: [{ role: "user", content: "What is the capital of France?" }]
});
```

When something goes wrong, you have no record of:
- What sources contributed to the prompt
- How the prompt was assembled
- What context led to this specific generation
- Whether you can reproduce the exact same conditions

This makes debugging impossible and evaluation unreliable.

### The Solution

The Context Ledger pattern separates prompt assembly from generation and logs both:

```typescript
// 1. Log context BEFORE generation
const contextEntry = ledger.logContext(sessionId, prompt, sources);

// 2. Generate with logged context
const response = await generateResponse(prompt);

// 3. Log the generation result
const generationEntry = ledger.logGeneration(contextEntry.id, response, latencyMs);
```

Now every generation is:
- **Auditable**: You can see exactly what went in
- **Reproducible**: You can replay the exact same context
- **Debuggable**: You can trace problems back to their source

## How It Works

### Core Components

#### 1. **Types** (`src/types.ts`)

Defines the data structures for context and generation entries:

- **ContextEntry**: Records what went into a prompt (sources, session, timing)
- **GenerationEntry**: Records what came out (output, latency, errors)
- **LedgerEntry**: Union type for both entry types

#### 2. **ContextLedger** (`src/ledger.ts`)

The central ledger that manages all context and generation logging:

```typescript
const ledger = new ContextLedger();

// Log context before generation
const contextEntry = ledger.logContext(sessionId, prompt, sources);

// Log generation after completion
const generationEntry = ledger.logGeneration(contextId, output, latencyMs);

// Later: reproduce the exact context
const reproduced = ledger.reproduceContext(contextEntry.id);
```

**Key Methods:**
- `logContext()`: Records prompt assembly with sources and metadata
- `logGeneration()`: Records generation results linked to context
- `reproduceContext()`: Retrieves exact context for replay
- `getContextsForSession()`: Finds all contexts for a session

#### 3. **AIGenerator** (`src/generator.ts`)

Wraps AI generation with automatic context logging:

```typescript
const generator = new AIGenerator(ledger);

// Context is automatically logged before generation
const result = await generator.generateWithLedger(
  'session-123',
  'What is the capital of France?',
  'You are a helpful geography assistant.'
);

// Both context and generation are now in the ledger
console.log('Result:', result.output);
```

The generator ensures that:
- Context is always logged before generation
- Generation results are always logged after completion
- Errors are logged as failed generations
- All entries are linked by IDs

### Data Flow

1. **Assembly**: Sources (system prompt, user message, context) are combined into a prompt
2. **Context Logging**: The complete prompt and its sources are logged with metadata
3. **Generation**: The AI generates a response using the logged prompt
4. **Result Logging**: The generation output, timing, and any errors are logged
5. **Linking**: Generation entries reference their context entries by ID

### Example Usage

```typescript
import { ContextLedger } from './ledger.js';
import { AIGenerator } from './generator.js';

const ledger = new ContextLedger();
const generator = new AIGenerator(ledger);

// Generate with automatic context logging
const result = await generator.generateWithLedger(
  'session-123',
  'What is the capital of France?',
  'You are a helpful geography assistant.'
);

// Later: debug by reproducing the exact context
const reproduced = ledger.reproduceContext(result.contextEntry.id);
console.log('Original prompt:', reproduced?.prompt);
console.log('Original sources:', reproduced?.sources);
```

## Benefits in Practice

### 1. **Debugging**
When a generation fails or produces unexpected results, you can:
- See the exact prompt that was sent
- Identify which sources contributed what
- Replay the exact same context to test fixes

### 2. **Evaluation**
When evaluating model performance, you can:
- Compare results across identical contexts
- Ensure test conditions are truly reproducible
- Track which prompt variations perform better

### 3. **Auditing**
For compliance and quality assurance, you can:
- Prove what information was used in decisions
- Show the complete chain from input to output
- Maintain an audit trail for sensitive applications

### 4. **Session Management**
For conversational AI, you can:
- Track all contexts within a user session
- Understand conversation flow and context evolution
- Debug session-specific issues

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
1. Context being logged before generation
2. Generation results being logged after completion
3. Complete ledger contents with linked entries
4. How to reproduce any previous context

## Production Considerations

### Storage
In production, you'd typically:
- Store ledger entries in a database
- Index by session ID and timestamp for efficient queries
- Implement retention policies for old entries

### Performance
For high-volume applications:
- Log asynchronously to avoid blocking generation
- Batch writes to reduce database load
- Consider sampling for non-critical contexts

### Privacy
When handling sensitive data:
- Implement data masking for PII in logs
- Provide mechanisms to purge user data
- Consider encryption for stored contexts

### Integration
The pattern works with any AI provider:
- Replace the mock generation with real API calls
- Add provider-specific metadata (model, temperature, etc.)
- Log provider responses and error codes

## Key Insights

1. **Separation of Concerns**: Context assembly and generation are separate, logged steps
2. **Explicit Sources**: Every piece of context is tracked with its source and type
3. **Linked Entries**: Context and generation entries are connected by IDs
4. **Reproducibility**: Any generation can be exactly reproduced from its logged context
5. **Auditability**: Complete chain of custody from input sources to final output

This implementation demonstrates how the Context Ledger pattern transforms opaque AI interactions into transparent, debuggable, and reliable systems.
