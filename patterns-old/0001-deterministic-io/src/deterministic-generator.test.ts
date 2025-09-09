import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicGenerator } from './deterministic-generator.js';
import { z } from 'zod';

export const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});

// Schema for a sentiment analysis
export const SentimentAnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()),
  score: z.number().min(-1).max(1)
});



describe('DeterministicGenerator', () => {
  let generator: DeterministicGenerator;

  beforeEach(() => {
    generator = new DeterministicGenerator();
  });

  describe('successful generation', () => {
    it('should generate and validate task analysis', async () => {
      const result = await generator.generate(
        'Analyze this task: "Build a dashboard"',
        TaskAnalysisSchema
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.attempts).toBeGreaterThan(0);
      expect(result.rawOutput).toContain('priority');
      
      if (result.success && result.data) {
        expect(['low', 'medium', 'high', 'urgent']).toContain(result.data.priority);
        expect(result.data.estimatedHours).toBeGreaterThanOrEqual(0.5);
        expect(result.data.estimatedHours).toBeLessThanOrEqual(80);
        expect(result.data.riskLevel).toBeGreaterThanOrEqual(1);
        expect(result.data.riskLevel).toBeLessThanOrEqual(5);
      }
    });

    it('should generate and validate sentiment analysis', async () => {
      const result = await generator.generate(
        'Analyze sentiment: "Great product!"',
        SentimentAnalysisSchema
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.success && result.data) {
        expect(['positive', 'negative', 'neutral']).toContain(result.data.sentiment);
        expect(result.data.confidence).toBeGreaterThanOrEqual(0);
        expect(result.data.confidence).toBeLessThanOrEqual(1);
        expect(result.data.score).toBeGreaterThanOrEqual(-1);
        expect(result.data.score).toBeLessThanOrEqual(1);
        expect(Array.isArray(result.data.keywords)).toBe(true);
      }
    });
  });

  describe('retry behavior', () => {
    it('should track attempts correctly', async () => {
      // Test that attempts are tracked properly
      const result = await generator.generate(
        'Analyze this task: "Test attempt tracking"',
        TaskAnalysisSchema,
        { maxRetries: 3 }
      );
      
      expect(result.attempts).toBeGreaterThan(0);
      expect(result.attempts).toBeLessThanOrEqual(3);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should respect maxRetries setting', async () => {
      const result = await generator.generate(
        'Generate something that might fail',
        TaskAnalysisSchema,
        { maxRetries: 1 }
      );
      
      expect(result.attempts).toBeLessThanOrEqual(1);
    });

    it('should handle generation errors gracefully', async () => {
      // Test error handling
      const result = await generator.generate(
        'Test error handling',
        TaskAnalysisSchema,
        { maxRetries: 1 }
      );
      
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.rawOutput).toBe('string');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.attempts).toBe('number');
    });
  });

  describe('schema validation', () => {
    it('should reject data that fails schema validation', async () => {
      // Create a strict schema that's likely to fail
      const StrictSchema = z.object({
        impossibleField: z.literal('impossible-value'),
        anotherField: z.number().min(1000000)
      });

      const result = await generator.generate(
        'Generate something that will fail validation',
        StrictSchema,
        { maxRetries: 1 }
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('validation failed'))).toBe(true);
    });

    it('should validate successful results against schema', async () => {
      const result = await generator.generate(
        'Analyze this task: "Build a feature"',
        TaskAnalysisSchema,
        { maxRetries: 2 }
      );
      
      // If successful, data should match schema constraints
      if (result.success && result.data) {
        expect(['low', 'medium', 'high', 'urgent']).toContain(result.data.priority);
        expect(result.data.estimatedHours).toBeGreaterThanOrEqual(0.5);
        expect(result.data.estimatedHours).toBeLessThanOrEqual(80);
        expect(result.data.riskLevel).toBeGreaterThanOrEqual(1);
        expect(result.data.riskLevel).toBeLessThanOrEqual(5);
        expect(typeof result.data.category).toBe('string');
        expect(Array.isArray(result.data.dependencies)).toBe(true);
      }
    });
  });

  describe('generation options', () => {
    it('should accept custom options', async () => {
      const result = await generator.generate(
        'Test with custom options',
        TaskAnalysisSchema,
        { 
          maxRetries: 5,
          temperature: 0.2,
          seed: 123
        }
      );
      
      expect(result.attempts).toBeLessThanOrEqual(5);
    });

    it('should use default options when none provided', async () => {
      const result = await generator.generate(
        'Test with default options',
        SentimentAnalysisSchema
      );
      
      expect(result.attempts).toBeLessThanOrEqual(3); // Default maxRetries
    });
  });
});
