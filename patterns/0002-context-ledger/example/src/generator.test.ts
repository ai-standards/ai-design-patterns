import { describe, it, expect, beforeEach } from 'vitest';
import { ContextLedger } from './ledger.js';
import { AIGenerator } from './generator.js';

describe('AIGenerator', () => {
  let ledger: ContextLedger;
  let generator: AIGenerator;

  beforeEach(() => {
    ledger = new ContextLedger();
    generator = new AIGenerator(ledger);
  });

  it('should generate with context logging', async () => {
    const result = await generator.generateWithLedger(
      'session-1',
      'Hello',
      'You are helpful'
    );

    expect(result.contextEntry.sessionId).toBe('session-1');
    expect(result.contextEntry.prompt).toContain('System: You are helpful');
    expect(result.contextEntry.prompt).toContain('User: Hello');
    expect(result.generationEntry.contextId).toBe(result.contextEntry.id);
    expect(result.output).toContain('Hello');
  });

  it('should work without system prompt', async () => {
    const result = await generator.generateWithLedger('session-1', 'Hello');

    expect(result.contextEntry.prompt).toBe('User: Hello');
    expect(result.contextEntry.sources).toHaveLength(1);
    expect(result.contextEntry.sources[0].type).toBe('user');
  });

  it('should record both context and generation in ledger', async () => {
    await generator.generateWithLedger('session-1', 'Hello');

    const allEntries = ledger.getAllEntries();
    expect(allEntries).toHaveLength(2);
    
    const contextEntry = allEntries[0];
    const generationEntry = allEntries[1];
    
    expect('prompt' in contextEntry).toBe(true);
    expect('output' in generationEntry).toBe(true);
  });

  it('should measure latency', async () => {
    const result = await generator.generateWithLedger('session-1', 'Hello');

    expect(result.generationEntry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.generationEntry.latencyMs).toBe('number');
  });
});
