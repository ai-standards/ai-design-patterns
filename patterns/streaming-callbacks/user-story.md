# Breaking News Without Breaking Flow

## Company & Problem
CityDesk builds newsroom software used by regional editors to produce “flash briefs” when a story breaks. Editors paste wire snippets and chat a prompt like “Give me a 3‑bullet brief, include one verified fact and a photo suggestion.”

The first version called the LLM in batch mode. Responses took 6–10 seconds. Worse, the model often embedded a “fact check” and “photo search” step inside its final answer, so the app could not start those API calls until everything finished. Editors sat idle, then re-ran prompts the moment facts changed—wasting time and tokens.

CityDesk needed two things: visible progress within the first second and tool work (fact check, wire fetch, photo search) to start as soon as the model asked for it, not after.

## Applying the Pattern
Streaming turned the model into a live event source: tokens, tool calls, and step updates arrived incrementally. Small UI observers rendered text deltas, a tool runner reacted to tool_call events immediately, and a controller handled cancellation when an editor changed course.

Callbacks gave clean extension points:
- As soon as the first delta arrived, the brief began rendering.
- When the model requested factCheck or photoSearch, the app executed them concurrently and streamed results back.
- If the editor clicked Cancel or edited the prompt, the request halted deterministically.

## Implementation Plan
- Define a minimal event schema: start, delta, tool_call, tool_result, error, done (each with requestId and seq).
- Use SSE to the browser for one-way streaming; keep a POST endpoint for tool results and cancel.
- Build observers:
  - Renderer: coalesce token deltas into sentence chunks for stable UI.
  - Tool runner: dispatch on tool_call name and POST tool_result.
  - Telemetry: record TTFB, tokens/sec, and tool latencies.
- Add cancellation on user input changes; enforce server timeouts.
- Store transcripts per request for replayable tests.

## Implementation Steps
The server exposed an SSE endpoint that forwarded model events with sequence numbers. The client registered lightweight callbacks for each event type. The renderer appended deltas to a buffer, but only flushed at sentence boundaries to reduce flicker.

Small TypeScript snippet: client observer wiring (SSE + callbacks)
```ts
const es = new EventSource(`/api/brief/stream?topic=${encodeURIComponent(topic)}`);
let meta: { requestId: string } | null = null, buffer = "";

es.addEventListener("start", (e) => meta = JSON.parse(e.data));
es.addEventListener("delta", (e) => { buffer += e.data; flushAtSentence(buffer); });
es.addEventListener("tool_call", async (e) => {
  const { callId, name, args } = JSON.parse(e.data);
  const result = await handleTool(name, args); // runs immediately
  await fetch(`/api/brief/${meta!.requestId}/tool_result`, {
    method: "POST", body: JSON.stringify({ callId, result }),
    headers: { "Content-Type": "application/json" }
  });
});
es.addEventListener("done", () => es.close());
```

Tool execution ran in parallel with generation. Results flowed back into the same model turn, so the LLM could incorporate verified facts without restarting.

Small TypeScript snippet: tool dispatcher and cancel hook
```ts
async function handleTool(name: string, args: any) {
  switch (name) {
    case "factCheck": return factCheckApi.verify(args.claim);
    case "photoSearch": return photos.search(args.query, { license: "editorial" });
    case "fetchWire": return wires.lookup(args.slug);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// Cancel on prompt edit
export function cancelCurrent(requestId: string) {
  es.close();
  fetch(`/api/brief/${requestId}/cancel`, { method: "POST" });
}
```

Operational details mattered. The server assigned monotonic seq values per request and allowed idempotent tool_result posts. The renderer merged out-of-order deltas conservatively using seq and timestamp. Telemetry observers logged stalls when token cadence dropped, which helped uncover a misconfigured proxy keep-alive.

## Outcome & Takeaways
Editors saw the first words in ~350 ms instead of waiting entire seconds. Tool calls started within the first second of generation, cutting total “editor sees usable brief” time from 8.4 s to 2.1 s median. Cancellations became reliable; switching topics no longer leaked work. Transcript-style tests stabilized CI by asserting event sequences, not just final text.

Key lessons:
- Plan the event schema first; sequence numbers and minimal payloads simplify everything else.
- Render in meaningful chunks (sentences) to avoid UI jitter.
- Execute tools as soon as requested and stream results back into the same turn.
- Treat cancellation as a first-class event; always end streams with a clear terminal signal.