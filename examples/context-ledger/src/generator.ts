import type { ContextEntry, GenerationEntry } from './types.js';
import { ContextLedger } from './ledger.js';

export class AIGenerator {
  constructor(private ledger: ContextLedger) {}

  async generateWithLedger(
    sessionId: string, 
    userMessage: string, 
    systemPrompt?: string
  ): Promise<{ contextEntry: ContextEntry; generationEntry: GenerationEntry; output: string }> {
    const startTime = Date.now();
    
    // Build context from sources
    const sources = [];
    let prompt = '';
    
    if (systemPrompt) {
      sources.push({ type: 'system', content: systemPrompt });
      prompt += `System: ${systemPrompt}\n\n`;
    }
    
    sources.push({ type: 'user', content: userMessage });
    prompt += `User: ${userMessage}`;
    
    // Log context BEFORE generation
    const contextEntry = this.ledger.logContext(sessionId, prompt, sources);
    
    try {
      // Simulate API call (replace with real OpenAI call)
      const mockResponse = `I understand: "${userMessage}". This is a mock response.`;
      
      // Log generation result
      const latencyMs = Date.now() - startTime;
      const generationEntry = this.ledger.logGeneration(contextEntry.id, mockResponse, latencyMs);
      
      return { contextEntry, generationEntry, output: mockResponse };
      
    } catch (error) {
      // Log failed generation too
      const latencyMs = Date.now() - startTime;
      this.ledger.logGeneration(contextEntry.id, `ERROR: ${(error as Error).message}`, latencyMs);
      throw error;
    }
  }
}
