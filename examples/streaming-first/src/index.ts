import { StreamingGenerator } from './streaming-generator.js';
import { StreamRenderer } from './stream-renderer.js';

async function demo() {
  console.log('Streaming First Demo');
  console.log('='.repeat(50));
  
  const generator = new StreamingGenerator();
  const renderer = new StreamRenderer();

  // Example 1: Basic streaming with visual feedback
  console.log('\n1. Basic Streaming Example:');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const stream1 = generator.generateStream(
    'Explain how streaming improves user experience',
    {
      chunkDelayMs: 100,
      maxChunkSize: 5,
      onChunk: (chunk) => {
        // This could trigger UI updates in a real application
        console.log(`[CHUNK] Received ${chunk.content.split(' ').length} words`);
      }
    }
  );

  await renderer.renderStream(stream1, { showProgress: true });

  // Example 2: Fast streaming for different content
  console.log('\n\n2. Fast Streaming Example:');
  await new Promise(resolve => setTimeout(resolve, 2000));

  const stream2 = generator.generateStream(
    'Tell me a short story about discovery',
    {
      chunkDelayMs: 30,
      maxChunkSize: 8,
      onChunk: (chunk) => {
        if (chunk.metadata) {
          console.log(`[PROGRESS] ${chunk.metadata.totalWordsProcessed} words processed`);
        }
      }
    }
  );

  await renderer.renderStream(stream2, { showProgress: true, showMetadata: true });

  // Example 3: Demonstrate early termination capability
  console.log('\n\n3. Early Action on Partial Content:');
  await new Promise(resolve => setTimeout(resolve, 2000));

  let partialContent = '';
  const stream3 = generator.generateStream(
    'Analyze the benefits of incremental processing in AI systems',
    {
      chunkDelayMs: 80,
      maxChunkSize: 6,
      onChunk: (chunk) => {
        partialContent += chunk.content;
        
        // Demonstrate acting on partial content
        if (partialContent.includes('benefits') && !partialContent.includes('systems')) {
          console.log('\n[EARLY ACTION] Detected keyword "benefits" - could trigger related suggestions');
        }
      }
    }
  );

  await renderer.renderStream(stream3);

  // Example 4: Compare streaming vs non-streaming
  console.log('\n\n4. Streaming vs Non-Streaming Comparison:');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\nNon-streaming (traditional approach):');
  console.log('Waiting for complete response...');
  
  const startTime = Date.now();
  const nonStreamResult = await generator.generateWithStreaming(
    'Explain the importance of responsive user interfaces',
    {
      chunkDelayMs: 50,
      maxChunkSize: 10,
      onChunk: () => {}, // No visual feedback
      onComplete: () => {}
    }
  );
  
  const totalTime = Date.now() - startTime;
  console.log(`\nComplete response (after ${totalTime}ms):`);
  console.log(nonStreamResult.fullContent);

  console.log('\n\nStreaming approach:');
  console.log('Immediate feedback with progressive content...');
  
  const stream4 = generator.generateStream(
    'Explain the importance of responsive user interfaces',
    {
      chunkDelayMs: 50,
      maxChunkSize: 10
    }
  );

  await renderer.renderStream(stream4);

  console.log('\n\nDemo completed! Notice how streaming provides:');
  console.log('• Immediate visual feedback');
  console.log('• Progressive content revelation');
  console.log('• Opportunity for early action');
  console.log('• Better perceived performance');
}

demo().catch(console.error);
