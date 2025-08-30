# Streaming First Example

Minimal TypeScript implementation of the Streaming First pattern for progressive AI outputs.

## What it does

- **Streams content progressively** instead of waiting for complete responses
- **Provides immediate feedback** as content is generated
- **Enables early action** on partial results
- **Improves perceived performance** and user experience

## Key insight

Instead of making users wait for complete responses:
```ts
// Traditional approach - users wait in silence
const response = await ai.generate(prompt);
console.log(response); // All at once after long delay
```

Stream content as it's generated:
```ts
// Streaming approach - immediate progressive feedback
const stream = generator.generateStream(prompt);
for await (const chunk of stream) {
  console.log(chunk.content); // Content appears progressively
}
```

## Run it

```bash
npm install
npm run dev
```

## Test it

```bash
npm test
```

## Example Usage

```typescript
import { StreamingGenerator, StreamRenderer } from './streaming-generator.js';

const generator = new StreamingGenerator();
const renderer = new StreamRenderer();

// Create a streaming generator
const stream = generator.generateStream(
  'Explain how streaming improves user experience',
  {
    chunkDelayMs: 100,    // Delay between chunks
    maxChunkSize: 5,      // Words per chunk
    onChunk: (chunk) => {
      // Handle each chunk as it arrives
      console.log(`Received: ${chunk.content}`);
      
      // Could trigger UI updates, early actions, etc.
      if (chunk.content.includes('important_keyword')) {
        triggerRelatedSuggestions();
      }
    },
    onComplete: (result) => {
      console.log(`Stream completed: ${result.totalTokens} tokens`);
    }
  }
);

// Render with visual feedback
await renderer.renderStream(stream, {
  showProgress: true,
  showMetadata: true
});
```

## Features

- **Progressive content delivery** via async generators
- **Visual rendering** with real-time updates
- **Chunk metadata** for tracking progress and statistics  
- **Early action capabilities** through chunk callbacks
- **Flexible timing** with configurable delays and chunk sizes
- **Error handling** with graceful degradation

## Demo Scenarios

The example demonstrates:

1. **Basic streaming** with visual progress indicators
2. **Fast streaming** for different content types
3. **Early action** on partial content (keyword detection)
4. **Performance comparison** between streaming vs traditional approaches

## Benefits Shown

- **Immediate feedback** - Users see content appearing right away
- **Better perceived performance** - Feels faster even if total time is the same
- **Early intervention** - Can act on partial results before completion
- **Graceful handling** - Failures waste less work since partial progress is visible

This makes AI interactions feel more responsive and trustworthy instead of leaving users wondering if anything is happening.
