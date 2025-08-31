import { DeterministicGenerator } from './deterministic-generator';
import { z } from 'zod';

// Define exactly what you expect back
const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});

const generator = new DeterministicGenerator();

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