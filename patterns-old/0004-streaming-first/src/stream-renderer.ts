import type { StreamChunk, StreamResult } from './types.js';

export class StreamRenderer {
  private currentContent: string = '';
  private isRendering: boolean = false;

  async renderStream(
    streamGenerator: AsyncGenerator<StreamChunk, StreamResult, unknown>,
    options: { 
      showProgress?: boolean;
      clearOnStart?: boolean;
      showMetadata?: boolean;
    } = {}
  ): Promise<StreamResult> {
    const { showProgress = true, clearOnStart = true, showMetadata = false } = options;
    
    if (clearOnStart) {
      this.clear();
    }

    this.isRendering = true;
    let chunkCount = 0;

    try {
      for await (const chunk of streamGenerator) {
        chunkCount++;
        this.currentContent += chunk.content;
        
        // Clear and redraw content
        this.clear();
        console.log('Generated Content:');
        console.log('─'.repeat(50));
        console.log(this.currentContent);
        
        if (showProgress) {
          console.log('─'.repeat(50));
          console.log(`Streaming... (chunk ${chunkCount})`);
        }

        if (showMetadata && chunk.metadata) {
          console.log(`Metadata: ${JSON.stringify(chunk.metadata)}`);
        }

        // Add visual separator for incomplete chunks
        if (!chunk.isComplete) {
          console.log('▌'); // Cursor-like indicator
        }
      }

      // Get final result
      const finalIteration = await streamGenerator.next();
      const result = finalIteration.value;

      // Final render
      this.clear();
      console.log('Final Result:');
      console.log('═'.repeat(50));
      console.log(result.fullContent);
      console.log('═'.repeat(50));
      console.log(`✓ Completed in ${this.getElapsedTime(result.startTime, result.endTime)} ms`);
      console.log(`✓ Total tokens: ${result.totalTokens}`);
      console.log(`✓ Total chunks: ${result.chunks.length}`);

      this.isRendering = false;
      return result;

    } catch (error) {
      this.isRendering = false;
      console.error('Streaming error:', error);
      throw error;
    }
  }

  renderProgressBar(current: number, total: number, width: number = 30): string {
    const progress = Math.min(current / total, 1);
    const filled = Math.floor(progress * width);
    const empty = width - filled;
    
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(progress * 100)}%`;
  }

  private clear(): void {
    // Clear console (works in most terminals)
    console.clear();
  }

  private getElapsedTime(start: Date, end?: Date): number {
    if (!end) return 0;
    return end.getTime() - start.getTime();
  }

  getCurrentContent(): string {
    return this.currentContent;
  }

  isCurrentlyRendering(): boolean {
    return this.isRendering;
  }

  reset(): void {
    this.currentContent = '';
    this.isRendering = false;
  }
}
