import { describe, it, expect, beforeEach } from 'vitest';
import { ContextLedger } from './ledger.js';

describe('ContextLedger', () => {
  let ledger: ContextLedger;

  beforeEach(() => {
    ledger = new ContextLedger();
  });

  it('should log context entries', () => {
    const sources = [{ type: 'user', content: 'Hello' }];
    const context = ledger.logContext('session-1', 'User: Hello', sources);

    expect(context.sessionId).toBe('session-1');
    expect(context.prompt).toBe('User: Hello');
    expect(context.sources).toEqual(sources);
    expect(context.tokenCount).toBeGreaterThan(0);
  });

  it('should log generation entries', () => {
    const generation = ledger.logGeneration('context-1', 'Hi there!', 100);

    expect(generation.contextId).toBe('context-1');
    expect(generation.output).toBe('Hi there!');
    expect(generation.latencyMs).toBe(100);
  });

  it('should reproduce context by id', () => {
    const sources = [{ type: 'user', content: 'Hello' }];
    const context = ledger.logContext('session-1', 'User: Hello', sources);
    
    const reproduced = ledger.reproduceContext(context.id);
    
    expect(reproduced).toEqual(context);
  });

  it('should return null for non-existent context', () => {
    const reproduced = ledger.reproduceContext('non-existent');
    
    expect(reproduced).toBeNull();
  });

  it('should filter contexts by session', () => {
    ledger.logContext('session-1', 'Prompt 1', []);
    ledger.logContext('session-2', 'Prompt 2', []);
    ledger.logContext('session-1', 'Prompt 3', []);
    
    const session1Contexts = ledger.getContextsForSession('session-1');
    
    expect(session1Contexts).toHaveLength(2);
    expect(session1Contexts[0].prompt).toBe('Prompt 1');
    expect(session1Contexts[1].prompt).toBe('Prompt 3');
  });

  it('should maintain entry order', () => {
    const context = ledger.logContext('session-1', 'User: Hello', []);
    const generation = ledger.logGeneration(context.id, 'Hi!', 50);
    
    const allEntries = ledger.getAllEntries();
    
    expect(allEntries).toHaveLength(2);
    expect(allEntries[0]).toBe(context);
    expect(allEntries[1]).toBe(generation);
  });
});
