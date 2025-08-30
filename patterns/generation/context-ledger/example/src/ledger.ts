import type { ContextEntry, GenerationEntry, LedgerEntry } from './types.js';

export class ContextLedger {
  private entries: LedgerEntry[] = [];

  logContext(sessionId: string, prompt: string, sources: Array<{ type: string; content: string }>): ContextEntry {
    const contextEntry: ContextEntry = {
      id: Date.now().toString(),
      sessionId,
      timestamp: new Date().toISOString(),
      prompt,
      sources,
      tokenCount: Math.ceil(prompt.length / 4) // rough estimate
    };
    
    this.entries.push(contextEntry);
    console.log('Context logged:', contextEntry.id);
    return contextEntry;
  }

  logGeneration(contextId: string, output: string, latencyMs: number): GenerationEntry {
    const generationEntry: GenerationEntry = {
      id: Date.now().toString(),
      contextId,
      output,
      latencyMs,
      timestamp: new Date().toISOString()
    };
    
    this.entries.push(generationEntry);
    console.log('Generation logged:', generationEntry.id);
    return generationEntry;
  }

  reproduceContext(contextId: string): ContextEntry | null {
    const context = this.entries.find(entry => entry.id === contextId && 'prompt' in entry) as ContextEntry | undefined;
    if (!context) {
      console.log('Context not found');
      return null;
    }
    
    console.log('Reproducing context:');
    console.log('Prompt:', context.prompt);
    console.log('Sources:', context.sources);
    return context;
  }

  getAllEntries(): LedgerEntry[] {
    return [...this.entries];
  }

  getContextsForSession(sessionId: string): ContextEntry[] {
    return this.entries.filter(entry => 
      'sessionId' in entry && entry.sessionId === sessionId
    ) as ContextEntry[];
  }
}
