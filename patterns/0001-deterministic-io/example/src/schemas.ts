import { z } from 'zod';

// Schema for a task analysis response
export const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().min(0.5).max(80),
  category: z.string().min(1),
  dependencies: z.array(z.string()),
  riskLevel: z.number().min(1).max(5)
});

// Schema for a product recommendation
export const ProductRecommendationSchema = z.object({
  productId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10),
  alternatives: z.array(z.string()).max(3)
});

// Schema for a sentiment analysis
export const SentimentAnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()),
  score: z.number().min(-1).max(1)
});

export type TaskAnalysis = z.infer<typeof TaskAnalysisSchema>;
export type ProductRecommendation = z.infer<typeof ProductRecommendationSchema>;
export type SentimentAnalysis = z.infer<typeof SentimentAnalysisSchema>;
