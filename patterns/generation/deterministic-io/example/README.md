# Deterministic IO Implementation

A TypeScript implementation of the Deterministic IO pattern using Zod schemas to enforce structured, reliable AI outputs with automatic validation and retry logic.

## Why Deterministic IO?

### The Problem

Most AI applications treat model outputs as unpredictable text:

```typescript
// What format will this return? Can we trust it?
const response = await openai.chat.completions.create({
  messages: [{ role: "user", content: "Analyze this task complexity" }]
});

// Hope and pray it's usable
const result = response.choices[0].message.content;
// Could be anything: "It's complex", JSON, bullet points, or gibberish
```

This leads to:
- **Fragile parsing**: String manipulation and regex hell
- **Runtime failures**: Unexpected formats breaking production
- **Inconsistent outputs**: Same prompt returning different structures
- **Debugging nightmares**: No way to validate what you actually need

### The Solution

Deterministic IO treats AI generation like any other API contract:

```typescript
// Define exactly what you expect
const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});

// Generate with automatic validation and retry
const result = await generator.generate(
  'Analyze this task: "Implement user authentication"',
  TaskAnalysisSchema,
  { maxRetries: 3, temperature: 0.1 }
);

if (result.success) {
  // result.data is fully typed and validated
  console.log(`Priority: ${result.data.priority}`);        // TypeScript knows this exists
  console.log(`Estimated: ${result.data.estimatedHours} hours`);
  console.log(`Risk Level: ${result.data.riskLevel}/5`);
} else {
  console.log(`Failed after ${result.attempts} attempts`);
  console.log('Errors:', result.errors);
}
```

Now every generation is:
- **Validated**: Guaranteed to match your schema or fail explicitly
- **Typed**: Full TypeScript support with compile-time safety
- **Reliable**: Automatic retries on validation failures
- **Debuggable**: Clear error messages when things go wrong

## How It Works

### Core Components

#### 1. **Schemas** (`src/schemas.ts`)

Defines strict contracts for AI outputs using Zod:

```typescript
export const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});

export type TaskAnalysis = z.infer<typeof TaskAnalysisSchema>;
```

**Benefits of Schema-First Design:**
- **Explicit Contracts**: Exactly what fields you expect and their constraints
- **Type Generation**: Automatic TypeScript types from schemas
- **Validation Rules**: Min/max values, string lengths, enum restrictions
- **Composition**: Schemas can reference other schemas for complex structures

#### 2. **DeterministicGenerator** (`src/deterministic-generator.ts`)

The core generator that enforces schemas with retry logic:

```typescript
const generator = new DeterministicGenerator();

const result = await generator.generate(
  prompt,
  schema,
  { maxRetries: 3, temperature: 0.1 }
);
```

**Key Features:**
- **Automatic Retry**: Retries on JSON parse errors or schema validation failures
- **Low Temperature**: Uses temperature 0.1 for more consistent outputs
- **Detailed Errors**: Tracks all failure reasons across attempts
- **Type Safety**: Returns properly typed data on success

#### 3. **Generation Flow**

The generator follows a strict validation pipeline:

1. **Generate**: Call AI with low temperature for consistency
2. **Parse JSON**: Attempt to parse response as JSON
3. **Validate Schema**: Use Zod to validate against expected structure
4. **Retry on Failure**: If validation fails, retry with the same prompt
5. **Return Result**: Success with typed data or failure with detailed errors

```typescript
// Internal flow
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  const rawOutput = await this.mockGenerate(prompt, options);
  
  // Parse JSON
  const jsonOutput = JSON.parse(rawOutput);
  
  // Validate schema
  const result = schema.safeParse(jsonOutput);
  if (result.success) {
    return { success: true, data: result.data, ... };
  }
  
  // Log error and retry
  errors.push(`Schema validation failed: ${result.error.message}`);
}
```

### Example Schemas

#### Task Analysis
```typescript
const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});
```

#### Product Recommendation
```typescript
const ProductRecommendationSchema = z.object({
  productId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10),
  alternatives: z.array(z.string()).max(3)
});
```

#### Sentiment Analysis
```typescript
const SentimentAnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()),
  score: z.number().min(-1).max(1)
});
```

## Usage Examples

### Basic Generation
```typescript
const generator = new DeterministicGenerator();

const result = await generator.generate(
  'Analyze this task: "Build a REST API"',
  TaskAnalysisSchema
);

if (result.success) {
  // Fully typed access
  console.log(`Priority: ${result.data.priority}`);
  console.log(`Hours: ${result.data.estimatedHours}`);
  console.log(`Dependencies: ${result.data.dependencies.join(', ')}`);
}
```

### Custom Options
```typescript
const result = await generator.generate(
  prompt,
  schema,
  {
    maxRetries: 5,        // More retries for critical operations
    temperature: 0.0,     // Maximum determinism
    seed: 12345          // Reproducible outputs
  }
);
```

### Error Handling
```typescript
const result = await generator.generate(prompt, schema);

if (!result.success) {
  console.log(`Failed after ${result.attempts} attempts`);
  console.log('Error history:', result.errors);
  
  // Fall back to default values or alternative logic
  const fallbackData = getDefaultTaskAnalysis();
}
```

## Benefits in Practice

### 1. **Type Safety**
```typescript
// Before: Runtime guessing
const priority = response.split('\n')[0]; // Hope it's there
const hours = parseInt(response.match(/\d+/)?.[0] || '0'); // Fragile parsing

// After: Compile-time guarantees
const priority = result.data.priority; // TypeScript knows it's 'low' | 'medium' | 'high' | 'urgent'
const hours = result.data.estimatedHours; // TypeScript knows it's a number between 0.5 and 80
```

### 2. **Reliability**
- **Automatic Retries**: Bad outputs are retried automatically
- **Validation**: Only valid data reaches your application logic
- **Error Tracking**: Complete history of what went wrong and when

### 3. **Debugging**
- **Schema Violations**: Exact field and constraint that failed
- **Attempt History**: See how many retries were needed
- **Raw Output**: Access to original AI response for debugging

### 4. **Testing**
```typescript
// Easy to test with known schemas
const testResult = await generator.generate(
  'Test prompt',
  TaskAnalysisSchema
);

expect(testResult.success).toBe(true);
expect(testResult.data.priority).toBeOneOf(['low', 'medium', 'high', 'urgent']);
expect(testResult.data.estimatedHours).toBeGreaterThan(0);
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
1. **Task Analysis**: Structured project estimation
2. **Product Recommendation**: E-commerce recommendation with confidence
3. **Sentiment Analysis**: Text sentiment with keywords and scoring
4. **Retry Behavior**: How the system handles failures and retries

## Production Considerations

### Schema Design
```typescript
// Good: Specific constraints
const UserProfileSchema = z.object({
  age: z.number().min(13).max(120),
  email: z.string().email(),
  preferences: z.array(z.string()).max(10)
});

// Bad: Too permissive
const UserProfileSchema = z.object({
  age: z.number(),
  email: z.string(),
  preferences: z.array(z.string())
});
```

### Error Strategies
- **Critical Operations**: Higher retry counts, fallback values
- **User-Facing**: Graceful degradation with default responses
- **Background Tasks**: Aggressive retries with exponential backoff

### Performance
- **Caching**: Cache validated responses for identical prompts
- **Batching**: Process multiple generations in parallel
- **Streaming**: For large outputs, validate incrementally

### Monitoring
- **Success Rates**: Track validation success across schemas
- **Retry Patterns**: Identify prompts that consistently fail
- **Schema Evolution**: Monitor when schemas need updates

## Integration with Real AI Providers

### OpenAI Example
```typescript
private async realGenerate(prompt: string, options: GenerationOptions): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You must respond with valid JSON matching the requested schema.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: options.temperature,
    seed: options.seed
  });
  
  return response.choices[0].message.content || '';
}
```

### Anthropic Example
```typescript
private async realGenerate(prompt: string, options: GenerationOptions): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    messages: [{ role: 'user', content: prompt }],
    temperature: options.temperature,
    max_tokens: 1000
  });
  
  return response.content[0].text;
}
```

## Key Insights

1. **Schema-First**: Define your data contract before generating
2. **Fail Fast**: Invalid outputs are caught immediately, not in production
3. **Retry Logic**: Temporary AI inconsistencies are handled automatically
4. **Type Safety**: Full TypeScript support from schema to usage
5. **Explicit Errors**: Clear feedback on what went wrong and why

This implementation shows how Deterministic IO transforms unreliable AI text into reliable, typed data structures that your application can trust and use safely.
