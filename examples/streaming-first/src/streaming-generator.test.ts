import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamingGenerator } from './streaming-generator.js';
import type { StreamChunk } from './types.js';

describe('StreamingGenerator', () => {
  let generator: StreamingGenerator;

  beforeEach(() => {
    generator = new StreamingGenerator();
  });

  describe('generateStream', () => {
    it('should generate chunks progressively', async () => {
      const chunks: StreamChunk[] = [];
      const stream = generator.generateStream(
        'Test prompt',
        { 
          chunkDelayMs: 1, // Fast for testing
          maxChunkSize: 2,
          onChunk: (chunk) => chunks.push(chunk)
        }
      );

      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        expect(chunk.id).toContain('chunk');
        expect(chunk.content).toBeTruthy();
        expect(chunk.timestamp).toBeInstanceOf(Date);
        expect(typeof chunk.isComplete).toBe('boolean');
      }

      expect(chunkCount).toBeGreaterThan(1);
      expect(chunks.length).toBe(chunkCount);
      
      // Last chunk should be marked as complete
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.isComplete).toBe(true);
    });

    it('should call onChunk callback for each chunk', async () => {
      const onChunkMock = vi.fn();
      const stream = generator.generateStream(
        'Test callback',
        { 
          chunkDelayMs: 1,
          maxChunkSize: 3,
          onChunk: onChunkMock
        }
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(onChunkMock).toHaveBeenCalledTimes(chunks.length);
      onChunkMock.mock.calls.forEach((call, index) => {
        expect(call[0]).toEqual(chunks[index]);
      });
    });

    it('should include metadata in chunks', async () => {
      const stream = generator.generateStream(
        'Test metadata',
        { 
          chunkDelayMs: 1,
          maxChunkSize: 2
        }
      );

      for await (const chunk of stream) {
        expect(chunk.metadata).toBeDefined();
        expect(chunk.metadata?.chunkIndex).toBeTypeOf('number');
        expect(chunk.metadata?.wordsInChunk).toBeTypeOf('number');
        expect(chunk.metadata?.totalWordsProcessed).toBeTypeOf('number');
      }
    });

    it('should respect maxChunkSize setting', async () => {
      const maxChunkSize = 3;
      const stream = generator.generateStream(
        'One two three four five six seven eight',
        { 
          chunkDelayMs: 1,
          maxChunkSize
        }
      );

      for await (const chunk of stream) {
        const wordCount = chunk.content.trim().split(/\s+/).length;
        expect(wordCount).toBeLessThanOrEqual(maxChunkSize);
      }
    });

    it('should call onComplete callback with final result', async () => {
      const onCompleteMock = vi.fn();
      const stream = generator.generateStream(
        'Test completion',
        { 
          chunkDelayMs: 1,
          onComplete: onCompleteMock
        }
      );

      // Consume the stream
      for await (const chunk of stream) {
        // Just consume
      }

      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      const result = onCompleteMock.mock.calls[0][0];
      expect(result.id).toBeTruthy();
      expect(result.fullContent).toBeTruthy();
      expect(result.status).toBe('completed');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });
  });

  describe('generateWithStreaming', () => {
    it('should return complete result after consuming stream', async () => {
      const result = await generator.generateWithStreaming(
        'Test complete result',
        { chunkDelayMs: 1 }
      );

      expect(result.id).toBeTruthy();
      expect(result.fullContent).toBeTruthy();
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.status).toBe('completed');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should call all callbacks during streaming', async () => {
      const onChunkMock = vi.fn();
      const onCompleteMock = vi.fn();

      const result = await generator.generateWithStreaming(
        'Test all callbacks',
        {
          chunkDelayMs: 1,
          maxChunkSize: 2,
          onChunk: onChunkMock,
          onComplete: onCompleteMock
        }
      );

      expect(onChunkMock).toHaveBeenCalled();
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledWith(result);
    });

    it('should assemble full content from chunks correctly', async () => {
      const chunks: StreamChunk[] = [];
      const result = await generator.generateWithStreaming(
        'Test content assembly',
        {
          chunkDelayMs: 1,
          maxChunkSize: 1,
          onChunk: (chunk) => chunks.push(chunk)
        }
      );

      const assembledContent = chunks.map(c => c.content).join('').trim();
      expect(result.fullContent).toBe(assembledContent);
      expect(result.chunks).toEqual(chunks);
    });
  });

  describe('different prompt types', () => {
    it('should generate appropriate content for explanation prompts', async () => {
      const result = await generator.generateWithStreaming(
        'Please explain this concept',
        { chunkDelayMs: 1 }
      );

      expect(result.fullContent).toContain('understand');
      expect(result.fullContent.length).toBeGreaterThan(100);
    });

    it('should generate appropriate content for story prompts', async () => {
      const result = await generator.generateWithStreaming(
        'Tell me a story about adventure',
        { chunkDelayMs: 1 }
      );

      expect(result.fullContent).toContain('Once upon a time');
      expect(result.fullContent.length).toBeGreaterThan(100);
    });

    it('should generate appropriate content for analysis prompts', async () => {
      const result = await generator.generateWithStreaming(
        'Analyze this data pattern',
        { chunkDelayMs: 1 }
      );

      expect(result.fullContent).toContain('analysis');
      expect(result.fullContent.length).toBeGreaterThan(100);
    });
  });

  describe('timing and performance', () => {
    it('should respect chunk delay timing', async () => {
      const chunkDelayMs = 50;
      const startTime = Date.now();
      let chunkTimes: number[] = [];

      const stream = generator.generateStream(
        'Test timing with multiple chunks',
        {
          chunkDelayMs,
          maxChunkSize: 2,
          onChunk: () => {
            chunkTimes.push(Date.now() - startTime);
          }
        }
      );

      for await (const chunk of stream) {
        // Just consume
      }

      // Should have multiple chunks with delays between them
      if (chunkTimes.length > 1) {
        const timeDiff = chunkTimes[1] - chunkTimes[0];
        expect(timeDiff).toBeGreaterThanOrEqual(chunkDelayMs - 10); // Allow some tolerance
      }
    });

    it('should track elapsed time correctly', async () => {
      const result = await generator.generateWithStreaming(
        'Test elapsed time tracking',
        { chunkDelayMs: 10 }
      );

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.endTime!.getTime()).toBeGreaterThan(result.startTime.getTime());
    });
  });
});
