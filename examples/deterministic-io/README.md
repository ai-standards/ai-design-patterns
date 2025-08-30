# Deterministic IO Example

Minimal TypeScript implementation of the Deterministic IO pattern for reliable AI outputs.

## What it does

- **Defines schemas** for every AI output using Zod validation
- **Validates responses** against schemas before accepting them
- **Retries on failure** when outputs don't match expected format
- **Provides structured results** with success/failure status and error details

## Key insight

Instead of hoping the AI returns the right format:
```ts
const response = await ai.generate("Analyze this task...");
// Hope it's valid JSON with the right fields
```

We enforce it with schemas:
```ts
const result = await generator.generate(prompt, TaskAnalysisSchema);
if (result.success) {
  // Guaranteed to have: priority, estimatedHours, category, dependencies, riskLevel
  console.log(result.data.priority);
}
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
import { DeterministicGenerator } from './deterministic-generator.js';
import { TaskAnalysisSchema } from './schemas.js';

const generator = new DeterministicGenerator();

// Define what you expect back
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
  console.log(`Priority: ${result.data.priority}`);
  console.log(`Estimated: ${result.data.estimatedHours} hours`);
  console.log(`Risk Level: ${result.data.riskLevel}/5`);
} else {
  console.log(`Failed after ${result.attempts} attempts`);
  console.log('Errors:', result.errors);
}
```

## Features

- **Schema validation** using Zod for runtime type safety
- **Automatic retries** on invalid JSON or schema validation failures  
- **Error collection** to understand why generation failed
- **Low temperature** (0.1) for more deterministic outputs
- **Attempt tracking** to monitor retry behavior
- **Raw output preservation** for debugging

This makes AI outputs reliable and integration-ready instead of hoping for the best.
