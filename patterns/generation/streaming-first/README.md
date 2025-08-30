# Pattern: Streaming First

**Intent**: Prefer incremental output over monolithic completions.

---

## Introduction

In traditional software, users expect responsiveness. In AI systems, free-form completions often arrive as one large block after long latency. This breaks user experience, hides partial results, and increases the risk of wasted work if something fails mid-generation.

The **Streaming First** pattern changes this by designing systems around incremental outputs. Instead of waiting for a final answer, the model streams tokens or chunks, which are processed and displayed in real time.

---

## Problem

- Users wait in silence during long completions.  
- Latency feels worse than it is.  
- Failures waste entire runs.  
- Systems cannot act on partial progress.  

---

## Forces

- **Responsiveness vs complexity** — streaming improves experience but requires pipeline support.  
- **Control vs flexibility** — streaming outputs must be handled gracefully.  
- **Cost vs usability** — incremental processing adds overhead but increases trust.  

---

## Solution

- Stream outputs by default.  
- Render or act on partial results as they arrive.  
- Design views and controllers to handle incomplete state.  
- Treat streaming as the baseline, not an afterthought.  

---

## Consequences

**Pros**  
- Improved user experience and trust.  
- Lower perceived latency.  
- Systems can act early on partial outputs.  
- Failures waste less work.  

**Cons**  
- Adds pipeline complexity.  
- Partial results may need reassembly or correction.

---

## Example

See the complete TypeScript implementation in this directory for a working example.

```typescript
import { StreamingGenerator, StreamRenderer } from './streaming-generator.js';

const generator = new StreamingGenerator();
const renderer = new StreamRenderer();

// Create a streaming generator that yields content progressively
const stream = generator.generateStream(
  'Explain how streaming improves user experience',
  {
    chunkDelayMs: 100,    // Delay between chunks for realistic streaming
    maxChunkSize: 5,      // Words per chunk
    onChunk: (chunk) => {
      // Handle each chunk as it arrives - could update UI, trigger actions, etc.
      console.log(`Received: ${chunk.content}`);
      
      // Act on partial content before completion
      if (chunk.content.includes('important_keyword')) {
        triggerEarlyAction();
      }
    },
    onComplete: (result) => {
      console.log(`Stream completed: ${result.totalTokens} tokens`);
    }
  }
);

// Render with real-time visual feedback
await renderer.renderStream(stream, {
  showProgress: true,
  showMetadata: true
});

// Alternative: consume stream manually
for await (const chunk of stream) {
  updateUI(chunk.content);  // Progressive UI updates
  if (shouldStopEarly(chunk)) {
    break;  // Can terminate early based on content
  }
}
```

Key insight: Instead of making users wait in silence for complete responses, stream content progressively. This provides immediate feedback, enables early action on partial results, and dramatically improves perceived performance even when total generation time is the same.  
