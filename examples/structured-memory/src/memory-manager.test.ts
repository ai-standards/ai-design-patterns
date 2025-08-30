import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager } from './memory-manager.js';

describe('MemoryManager', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager({
      shortTermMaxEntries: 3,
      shortTermMaxTokens: 200,
      longTermRetentionThreshold: 6,
      summarizationThreshold: 5
    });
  });

  describe('addMemory', () => {
    it('should add memory entry with correct properties', () => {
      const entry = memory.addMemory('Test content', 'conversation', 7);

      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe('Test content');
      expect(entry.category).toBe('conversation');
      expect(entry.importance).toBe(7);
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it('should add metadata when provided', () => {
      const metadata = { source: 'user', context: 'test' };
      const entry = memory.addMemory('Test', 'fact', 5, metadata);

      expect(entry.metadata).toEqual(metadata);
    });
  });

  describe('short-term memory management', () => {
    it('should limit entries by count', () => {
      // Add more entries than the limit
      memory.addMemory('Entry 1', 'conversation', 5);
      memory.addMemory('Entry 2', 'conversation', 5);
      memory.addMemory('Entry 3', 'conversation', 5);
      memory.addMemory('Entry 4', 'conversation', 5);

      const stats = memory.getMemoryStats();
      expect(stats.shortTerm.count).toBeLessThanOrEqual(3);
    });

    it('should move important memories to long-term when evicted', () => {
      // Add high-importance memories that exceed short-term limit
      memory.addMemory('Important 1', 'conversation', 8);
      memory.addMemory('Important 2', 'conversation', 9);
      memory.addMemory('Important 3', 'conversation', 7);
      memory.addMemory('Important 4', 'conversation', 8);

      const stats = memory.getMemoryStats();
      expect(stats.shortTerm.count).toBe(3);
      expect(stats.longTerm.count).toBeGreaterThan(0);
    });

    it('should not move low-importance memories to long-term', () => {
      // Add low-importance memories
      memory.addMemory('Unimportant 1', 'conversation', 3);
      memory.addMemory('Unimportant 2', 'conversation', 4);
      memory.addMemory('Unimportant 3', 'conversation', 2);
      memory.addMemory('Unimportant 4', 'conversation', 1);

      const stats = memory.getMemoryStats();
      expect(stats.longTerm.count).toBe(0);
    });
  });

  describe('retrieveRelevant', () => {
    beforeEach(() => {
      memory.addMemory('React is a JavaScript library', 'fact', 8);
      memory.addMemory('User wants to learn TypeScript', 'conversation', 7);
      memory.addMemory('TypeScript adds type safety', 'fact', 9);
      memory.addMemory('The weather is sunny', 'conversation', 2);
      memory.addMemory('Use functional components in React', 'instruction', 6);
    });

    it('should retrieve memories by keywords', () => {
      const results = memory.retrieveRelevant({
        keywords: ['react', 'typescript']
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.content.toLowerCase().includes('react'))).toBe(true);
    });

    it('should filter by category', () => {
      const results = memory.retrieveRelevant({
        categories: ['fact']
      });

      expect(results.every(r => r.category === 'fact')).toBe(true);
    });

    it('should filter by minimum importance', () => {
      const results = memory.retrieveRelevant({
        minImportance: 7
      });

      expect(results.every(r => r.importance >= 7)).toBe(true);
    });

    it('should limit results when specified', () => {
      const results = memory.retrieveRelevant({
        limit: 2
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should sort by importance and recency', () => {
      const results = memory.retrieveRelevant({});

      // Check that results are sorted by importance (descending)
      for (let i = 0; i < results.length - 1; i++) {
        if (results[i].importance !== results[i + 1].importance) {
          expect(results[i].importance).toBeGreaterThanOrEqual(results[i + 1].importance);
        }
      }
    });
  });

  describe('buildContextPrompt', () => {
    beforeEach(() => {
      memory.addMemory('React is a UI library', 'fact', 8);
      memory.addMemory('User is building a dashboard', 'conversation', 7);
      memory.addMemory('Use TypeScript for better types', 'instruction', 6);
    });

    it('should build prompt within token limit', () => {
      const prompt = memory.buildContextPrompt({}, 100);
      
      // Rough token estimation: ~4 chars per token
      expect(prompt.length).toBeLessThanOrEqual(400); // 100 tokens * 4 chars
    });

    it('should include category labels', () => {
      const prompt = memory.buildContextPrompt({});
      
      expect(prompt).toMatch(/\[FACT\]:|\[CONVERSATION\]:|\[INSTRUCTION\]:/);
    });

    it('should return relevant content based on query', () => {
      const prompt = memory.buildContextPrompt({
        keywords: ['react']
      });
      
      expect(prompt.toLowerCase()).toContain('react');
    });
  });

  describe('memory statistics', () => {
    it('should track short-term and long-term counts', () => {
      memory.addMemory('Test 1', 'conversation', 5);
      memory.addMemory('Test 2', 'fact', 8);
      
      const stats = memory.getMemoryStats();
      
      expect(stats.shortTerm.count).toBeGreaterThan(0);
      expect(stats.shortTerm.tokens).toBeGreaterThan(0);
      expect(typeof stats.longTerm.count).toBe('number');
      expect(typeof stats.longTerm.indexed).toBe('number');
    });
  });

  describe('clear', () => {
    it('should clear all memories', () => {
      memory.addMemory('Test 1', 'conversation', 5);
      memory.addMemory('Test 2', 'fact', 8);
      
      memory.clear();
      
      const stats = memory.getMemoryStats();
      expect(stats.shortTerm.count).toBe(0);
      expect(stats.longTerm.count).toBe(0);
      expect(stats.longTerm.indexed).toBe(0);
    });
  });

  describe('keyword extraction and indexing', () => {
    it('should retrieve memories based on keyword matching', () => {
      memory.addMemory('JavaScript is a programming language', 'fact', 7);
      memory.addMemory('Python is also programming', 'fact', 6);
      memory.addMemory('The cat is sleeping', 'conversation', 3);

      const results = memory.retrieveRelevant({
        keywords: ['programming']
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.content.includes('JavaScript'))).toBe(true);
    });

    it('should handle case-insensitive keyword matching', () => {
      memory.addMemory('React Components are reusable', 'fact', 8);

      const results = memory.retrieveRelevant({
        keywords: ['REACT', 'components']
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty queries', () => {
      memory.addMemory('Test content', 'conversation', 5);

      const results = memory.retrieveRelevant({});
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle queries with no matches', () => {
      memory.addMemory('React content', 'fact', 7);

      const results = memory.retrieveRelevant({
        keywords: ['nonexistent']
      });

      // Should still return short-term memories even if keywords don't match
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(1000);
      const entry = memory.addMemory(longContent, 'conversation', 5);

      expect(entry.content).toBe(longContent);
      
      const stats = memory.getMemoryStats();
      expect(stats.shortTerm.tokens).toBeGreaterThan(200);
    });
  });
});
