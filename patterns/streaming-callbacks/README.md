# Streaming & Callbacks

Observer applied to LLMs: stream partial outputs and notify clients incrementally. This pattern sends a sequence of small, structured events—tokens, text deltas, tool calls, intermediate steps—to observers as they happen. Instead of waiting for the full result, clients render, react, or route the model’s output in real time. The result is a more responsive user experience and better control over long-running or tool-using LLM workflows.

---

## Introduction

The Streaming & Callbacks pattern adapts the classic Observer pattern to large language models. An LLM emits partial results over time. Observers register callbacks to receive these events and handle them promptly—rendering text as it appears, speaking partial audio, calling tools when requested, or updating progress indicators. The model becomes a producer of a stream; application code becomes a set of subscribers that respond to each item in the stream.

This pattern fits both human-facing interfaces (e.g., chat UIs) and machine-facing pipelines (e.g., agent tool-use). It cleanly separates generation from consumption, makes latency visible and manageable, and enables composition with other streaming systems such as speech and UI frameworks.

- Typical events: start, token/text delta, tool_call, tool_result, reasoning/step update, error, done.
- Typical transports: Server-Sent Events (SSE), WebSockets, HTTP/2 streaming, or gRPC.
- Typical consumers: UI renderers, state aggregators, speech synth, logging/telemetry, and agent controllers.

---

## When and Why to Use It

Use this pattern when latency matters and meaningful partial results are available. Users perceive responsiveness as soon as tokens start to arrive. Developers gain hooks to adapt behavior mid-generation—cancelling, throttling, or branching based on early signals. For tool-using models, streaming tool calls lets the system execute actions as soon as they’re emitted rather than after the full completion.

This approach shines when generation is long-running, when intermediate steps are valuable, or when integrating with real-time media like text-to-speech or live editing. It also helps in back-end pipelines where downstream services should begin work without waiting for the final output.

- Latency-sensitive UX: show text as it’s generated; keep users engaged.
- Tool-use pipelines: start API calls immediately on tool_call events.
- Multimodal flows: feed deltas into TTS or live captions continuously.
- Progressive results: surface citations, snippets, or code blocks as they arrive.
- Operational control: support cancellation, timeouts, and adaptive throttling.

---

## Key Benefits and Tradeoffs

Streaming brings several advantages: faster perceived performance, finer-grained control, and better observability. Callbacks simplify integration with UIs and agents by exposing clear, event-driven extension points. It becomes easier to build “live” experiences—typeahead, progressive rendering, and concurrent tool execution.

The tradeoffs revolve around complexity. Streaming complicates state management, error handling, and testing. Observers must handle partial and possibly out-of-order information. Idempotency and buffering strategies become important. Infrastructure must sustain long-lived connections and backpressure.

Benefits:
- Responsiveness: interactive feedback from the first token.
- Control: cancellation, dynamic prompts/tools, and adaptive behavior mid-stream.
- Composition: easy integration with TTS, diff views, and progress UIs.
- Observability: fine-grained telemetry and tracing per event.

Tradeoffs:
- Complexity: partial-state handling, buffering, and ordering guarantees.
- Reliability: long-lived connections, retries, and idempotent event handling.
- Cost/throughput: more messages vs. batch responses; careful chunk sizing needed.
- Testing and determinism: harder to snapshot; require transcript-style assertions.

---

## Example Use Cases

The pattern fits a wide range of real applications. Anywhere partial output is useful, streaming with callbacks improves usability and throughput. It also makes complex agent behavior more transparent and controllable.

- Chat assistants: render responses token-by-token with a typing indicator.
- Code copilots: stream diffs or code blocks and enable early linting/tests.
- RAG search: show found citations/snippets progressively; fetch follow-up docs in parallel.
- Speech experiences: convert text deltas into partial audio for near-instant speech.
- Agent frameworks: execute tool calls as soon as they appear; stream tool results back to the model.
- Monitoring and analytics: attach a telemetry observer to record latency and token cadence.

---

## Minimal Example

This is intentionally minimal pseudo-code. The full example will appear elsewhere. The goal here is to show the shape of the API and event flow without prescribing a specific language or SDK.

```pseudo
interface StreamObserver {
  onStart(meta)
  onDelta(textChunk)         // token or text delta
  onToolCall(name, args)     // model requests a tool
  onToolResult(name, result) // tool result to feed back
  onError(error)
  onDone(stats)
}

function generateStream(prompt, observer): CancelHandle {
  // Connect to LLM with streaming enabled
  // For each event from the model, dispatch to observer
  spawn async {
    observer.onStart({ model, requestId })
    for event in llm.stream(prompt):
      switch event.type:
        case "delta": observer.onDelta(event.text)
        case "tool_call": 
          observer.onToolCall(event.name, event.args)
          // Optionally execute and report result
        case "error": observer.onError(event.error)
    observer.onDone({ tokens, duration })
  }
  return () => llm.cancel(requestId)
}

// Bridging an async iterator to callbacks (alternative shape)
async function* llmStream(prompt):
  // yield events: { type, ...payload }

```

Notes:
- Use onToolCall to trigger side effects and onToolResult to send outcomes back into the model loop.
- Return a cancel handle to stop generation on user action or timeouts.
- Prefer an event schema with sequence numbers for ordering and deduplication.

---

## Implementation Notes

Plan the event model first. Treat streaming as an API with a well-defined schema and lifecycle: start → zero or more deltas and side-effect events → done or error. Each event should carry minimally sufficient metadata (request id, sequence number, timestamps) to support ordering, retries, and observability.

Transport and backpressure matter. SSE is simple for one-way streams to browsers; WebSockets or gRPC are better for bidirectional tooling and higher throughput. Avoid flooding the client: coalesce small token bursts into word-boundary chunks when rendering text, and apply backpressure (e.g., pause/resume or client-side buffering) when downstream cannot keep up.

- Event schema:
  - Include type, sequence number, timestamp, and correlation ids.
  - Keep event payloads minimal but sufficient (e.g., text delta vs. full text).
- Ordering and idempotency:
  - Monotonic sequence numbers per stream.
  - Make observers idempotent; handle duplicates and small reorders gracefully.
- Buffering and merge:
  - Aggregate deltas into user-visible units (words, sentences, code blocks).
  - Use language-aware rules to avoid flicker around punctuation and whitespace.
- Tool integration:
  - Emit tool_call as soon as available; execute concurrently.
  - Stream tool_result back to the model and surface intermediates to observers.
- Cancellation and timeouts:
  - Provide user-driven cancel; enforce server-side max duration/token caps.
  - Send a final onDone or onError so observers can clean up deterministically.
- Error handling:
  - Distinguish transport errors from model/tool errors.
  - Support retry with resume tokens or replay from the last acknowledged sequence.
- Transports:
  - SSE for simple browser delivery; keep-alive pings to prevent idle timeouts.
  - WebSockets/gRPC for bidirectional events and tool calls over one connection.
- Observability:
  - Log per-event latencies and byte counts; track tokens-per-second and stall times.
  - Capture full “transcripts” for debugging and tests; assert on sequences rather than final text only.
- Security and privacy:
  - Redact sensitive tokens in logs; authenticate stream subscriptions.
  - Bound tool capabilities; validate tool_call arguments before execution.
- Fallbacks:
  - Degrade to non-streaming (batch) when streaming isn’t supported; preserve API shape by buffering and emitting a single onDelta followed by onDone.

This pattern rewards careful attention to small details—event schemas, chunking strategy, and cancellation behavior—but pays off with responsive, controllable, and composable AI systems.