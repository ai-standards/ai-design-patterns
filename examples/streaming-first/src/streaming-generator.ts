import type { StreamChunk, StreamResult, StreamOptions } from './types.js';

export class StreamingGenerator {
  private defaultOptions: Required<StreamOptions> = {
    chunkDelayMs: 50,
    maxChunkSize: 20,
    onChunk: () => {},
    onComplete: () => {},
    onError: () => {}
  };

  async *generateStream(prompt: string, options: StreamOptions = {}): AsyncGenerator<StreamChunk, StreamResult, unknown> {
    const opts = { ...this.defaultOptions, ...options };
    const streamId = `stream-${Date.now()}`;
    const startTime = new Date();
    const chunks: StreamChunk[] = [];
    let totalContent = '';

    try {
      // Simulate AI response generation
      const mockResponse = await this.mockGenerateResponse(prompt);
      const words = mockResponse.split(' ');

      // Stream words in chunks
      for (let i = 0; i < words.length; i += opts.maxChunkSize) {
        const chunkWords = words.slice(i, i + opts.maxChunkSize);
        const chunkContent = chunkWords.join(' ');
        const isLastChunk = i + opts.maxChunkSize >= words.length;

        const chunk: StreamChunk = {
          id: `${streamId}-chunk-${i}`,
          content: chunkContent + (isLastChunk ? '' : ' '),
          timestamp: new Date(),
          isComplete: isLastChunk,
          metadata: {
            chunkIndex: Math.floor(i / opts.maxChunkSize),
            wordsInChunk: chunkWords.length,
            totalWordsProcessed: Math.min(i + opts.maxChunkSize, words.length)
          }
        };

        chunks.push(chunk);
        totalContent += chunk.content;
        
        // Call chunk callback
        opts.onChunk(chunk);

        // Yield the chunk
        yield chunk;

        // Simulate processing delay
        if (!isLastChunk) {
          await new Promise(resolve => setTimeout(resolve, opts.chunkDelayMs));
        }
      }

      const result: StreamResult = {
        id: streamId,
        fullContent: totalContent.trim(),
        chunks,
        startTime,
        endTime: new Date(),
        totalTokens: words.length,
        status: 'completed'
      };

      opts.onComplete(result);
      return result;

    } catch (error) {
      const errorResult: StreamResult = {
        id: streamId,
        fullContent: totalContent,
        chunks,
        startTime,
        endTime: new Date(),
        totalTokens: 0,
        status: 'error'
      };

      opts.onError(error as Error);
      return errorResult;
    }
  }

  async generateWithStreaming(prompt: string, options: StreamOptions = {}): Promise<StreamResult> {
    const opts = { ...this.defaultOptions, ...options };
    const streamId = `stream-${Date.now()}`;
    const startTime = new Date();
    const chunks: StreamChunk[] = [];
    let totalContent = '';

    try {
      // Generate the response
      const mockResponse = await this.mockGenerateResponse(prompt);
      const words = mockResponse.split(' ');

      // Process chunks without streaming
      for (let i = 0; i < words.length; i += opts.maxChunkSize) {
        const chunkWords = words.slice(i, i + opts.maxChunkSize);
        const chunkContent = chunkWords.join(' ');
        const isLastChunk = i + opts.maxChunkSize >= words.length;

        const chunk: StreamChunk = {
          id: `${streamId}-chunk-${i}`,
          content: chunkContent + (isLastChunk ? '' : ' '),
          timestamp: new Date(),
          isComplete: isLastChunk,
          metadata: {
            chunkIndex: Math.floor(i / opts.maxChunkSize),
            wordsInChunk: chunkWords.length,
            totalWordsProcessed: Math.min(i + opts.maxChunkSize, words.length)
          }
        };

        chunks.push(chunk);
        totalContent += chunk.content;
        opts.onChunk(chunk);
      }

      const result: StreamResult = {
        id: streamId,
        fullContent: totalContent.trim(),
        chunks,
        startTime,
        endTime: new Date(),
        totalTokens: words.length,
        status: 'completed'
      };

      opts.onComplete(result);
      return result;

    } catch (error) {
      const errorResult: StreamResult = {
        id: streamId,
        fullContent: totalContent,
        chunks,
        startTime,
        endTime: new Date(),
        totalTokens: 0,
        status: 'error'
      };

      opts.onError(error as Error);
      return errorResult;
    }
  }

  private async mockGenerateResponse(prompt: string): Promise<string> {
    // Add a small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 1));
    
    // Simulate different response types based on prompt
    if (prompt.includes('explain')) {
      return 'To understand this concept, we need to break it down into several key components. First, consider the foundational principles that govern this domain. These principles serve as the building blocks for more complex ideas. Next, we examine how these components interact with each other in practical scenarios. The relationships between these elements create emergent behaviors that are often more interesting than the individual parts. Finally, we can apply this understanding to solve real-world problems and create meaningful solutions.';
    }

    if (prompt.includes('story') || prompt.includes('narrative')) {
      return 'Once upon a time, in a world not so different from our own, there lived a curious individual who questioned everything. This person spent their days exploring the boundaries of what was possible, pushing against conventional wisdom and seeking new perspectives. Through their journey, they discovered that the most profound insights often come from the simplest observations. Their adventures taught them that progress is not always about moving forward, but sometimes about looking at familiar things from entirely new angles.';
    }

    if (prompt.includes('analyze') || prompt.includes('analysis') || prompt.toLowerCase().includes('analyz')) {
      return 'The analysis reveals several important patterns in the data. Primary factors include systematic variations that correlate with external conditions. Secondary effects show temporal dependencies that suggest underlying cyclical behaviors. The methodology employed here follows established best practices while incorporating novel approaches to handle edge cases. Results indicate strong statistical significance across multiple validation metrics. These findings have implications for both theoretical understanding and practical applications in the field.';
    }

    // Default response
    return 'This is a comprehensive response that demonstrates the streaming capabilities of the system. Each word appears progressively, allowing users to see content as it is generated rather than waiting for the complete response. This approach improves perceived performance and provides immediate feedback to users about the system\'s progress.';
  }
}
