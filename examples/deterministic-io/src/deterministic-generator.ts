import { z } from 'zod';

export interface GenerationResult<T> {
  success: boolean;
  data?: T;
  rawOutput: string;
  attempts: number;
  errors: string[];
}

export interface GenerationOptions {
  maxRetries?: number;
  temperature?: number;
  seed?: number;
}

export class DeterministicGenerator {
  private defaultOptions: Required<GenerationOptions> = {
    maxRetries: 3,
    temperature: 0.1, // Low temperature for more deterministic outputs
    seed: 42
  };

  async generate<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options: GenerationOptions = {}
  ): Promise<GenerationResult<T>> {
    const opts = { ...this.defaultOptions, ...options };
    const errors: string[] = [];
    
    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
      try {
        // Simulate AI generation (replace with real API call)
        const rawOutput = await this.mockGenerate(prompt, opts);
        
        // Try to parse as JSON
        let jsonOutput: unknown;
        try {
          jsonOutput = JSON.parse(rawOutput);
        } catch (parseError) {
          const error = `Attempt ${attempt}: Invalid JSON - ${parseError instanceof Error ? parseError.message : 'Unknown error'}`;
          errors.push(error);
          console.log(error);
          continue;
        }
        
        // Validate against schema
        const result = schema.safeParse(jsonOutput);
        if (result.success) {
          return {
            success: true,
            data: result.data,
            rawOutput,
            attempts: attempt,
            errors
          };
        } else {
          const error = `Attempt ${attempt}: Schema validation failed - ${result.error.message}`;
          errors.push(error);
          console.log(error);
        }
        
      } catch (generationError) {
        const error = `Attempt ${attempt}: Generation failed - ${generationError instanceof Error ? generationError.message : 'Unknown error'}`;
        errors.push(error);
        console.log(error);
      }
    }
    
    return {
      success: false,
      rawOutput: errors[errors.length - 1] || 'No output generated',
      attempts: opts.maxRetries,
      errors
    };
  }

  private async mockGenerate(prompt: string, options: Required<GenerationOptions>): Promise<string> {
    // Simulate different types of responses based on prompt content
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate API latency
    
    if (prompt.includes('task analysis') || prompt.includes('Analyze this task')) {
      // Only return invalid JSON for specific test prompts
      if (prompt.includes('Test invalid JSON') && Math.random() < 0.7) {
        return '{"priority": "high", "estimatedHours": 5, "category": "development"'; // Missing closing brace
      }
      return JSON.stringify({
        priority: 'high',
        estimatedHours: 8.5,
        category: 'development',
        dependencies: ['design-review', 'api-setup'],
        riskLevel: 3
      });
    }
    
    if (prompt.includes('product recommendation')) {
      // Only return invalid data for specific test prompts
      if (prompt.includes('testing validation') && Math.random() < 0.5) {
        return JSON.stringify({
          productId: 'PROD-123',
          confidence: 1.5, // Invalid: > 1
          reasoning: 'Good product',
          alternatives: ['PROD-124', 'PROD-125']
        });
      }
      return JSON.stringify({
        productId: 'PROD-123',
        confidence: 0.85,
        reasoning: 'This product matches the user requirements based on price range and features',
        alternatives: ['PROD-124', 'PROD-125']
      });
    }
    
    if (prompt.includes('sentiment')) {
      return JSON.stringify({
        sentiment: 'positive',
        confidence: 0.92,
        keywords: ['great', 'excellent', 'satisfied'],
        score: 0.8
      });
    }
    
    // Default fallback
    return '{"error": "Unknown prompt type"}';
  }
}
