# Case Study: Streaming-First in a Healthcare Documentation Assistant

## Company Background and the Problem We Faced
We are HelixCare, a mid-sized telehealth provider operating across three states with a network of urgent care clinics and virtual primary care. Two years ago we launched an AI-powered clinical documentation assistant to lighten the burden of note-taking during visits. The assistant summarized transcripts, pulled in relevant vitals and labs, and drafted SOAP notes. It worked—but clinicians complained about lag. Notes often appeared only after a 8–15 second wait, and if the model got the tone wrong or over-explained, physicians would cancel and start over. That “dead air” eroded trust, led to repeated prompts, and increased average visit time by nearly a minute.

We also saw operational waste. When clinicians canceled a long-running generation, our backend had already spent most of the tokens. Observability was limited too: we could not see what the model was doing mid-flight, making it hard to debug stalls or adjust prompts in real time.

## Why We Chose the Streaming-First Pattern
We chose Streaming-First because it addressed both the perception of speed and the need for better control. Our clinicians didn’t need a perfect, atomic note on the first try—they wanted to see an outline, check that the assessment direction felt right, and stop or steer when necessary. Streaming partial results fit how documentation actually happens in practice: iterative, confirm-then-continue.

We weighed risks carefully. Healthcare has compliance constraints, and we cannot show unvetted content as if it were final. We decided to stream drafts with clear labels and to gate the first visible tokens through a lightweight safety and privacy check. The promise of lower perceived latency, reduced wasted compute from early cancels, and improved transparency made the tradeoff compelling.

- We aligned on a product contract: show “Draft” progressively, allow “Stop” at any time, and require an explicit “Finalize” step before committing to the EHR.
- We committed to instrumenting time-to-first-token and mid-stream behavior so we could detect regressions and refine the experience.

## How We Implemented It
We approached implementation as a cross-cutting change across transport, server behavior, client UX, and safety. Our goal was to make partial delivery reliable, labeled, and useful—not just a typewriter effect.

On the transport side, we adopted Server-Sent Events (SSE) for one-way token and event delivery from our API to the web client. SSE was simple to deploy behind our existing infrastructure and worked well with HTTP caching controls. For voice use cases and bi-directional tool orchestration, we retained WebSockets, but the core note drafting experience now uses SSE.

We changed server behavior to flush early and often. As soon as the model produced an outline or the first complete sentence, we sent headers and a small chunk. We disabled buffering on NGINX and our CDN so chunks weren’t held back. We added explicit finish semantics—a terminal “done” event with finish_reason and usage—so clients could clean up deterministically. We also introduced a mid-stream error event type to distinguish between transient network issues and model/tool failures.

On the client, we moved from per-token rendering to readable chunking. We stream sentences and sections rather than every token to reduce flicker. We show a skeleton note with sections (Subjective, Objective, Assessment, Plan), then fill each section progressively. The UI includes “Stop,” “Copy so far,” and “Continue” controls, and the header clearly labels the content as “Draft.” For accessibility, we use ARIA live regions in polite mode so screen readers are not overwhelmed.

Safety and compliance were front and center. We do not stream chain-of-thought or internal reasoning; we only stream user-facing text. The first chunk is gated by a fast content and PHI validator to ensure no sensitive internal metadata or system prompts leak. We also route all streaming through our HIPAA-compliant infrastructure with encrypted transport, and we log only structured metadata (not full content) for performance analytics unless explicit consent is present.

To support downstream systems, we added structured event types and metadata to our stream. Each chunk includes role, segment_type (outline, text, code, citation), a stable section_id, and timestamps. When we discover citations (e.g., recent labs), we send them as separate events with deterministic IDs; the client pins them next to the relevant sentence without reflowing the text. For extraction flows (e.g., quality measures), we stream NDJSON lines that downstream services process incrementally.

We wrapped this with reliability features. Streams include periodic keepalives to survive mobile network blips. Clients implement a backoff-and-resume strategy keyed by a request_id, and the server is idempotent for the first N seconds so a reconnect resumes where it left off or falls back to a non-streaming response.

Generalized server-side sketch (Node/Express with SSE) to show how we framed messages and disabled buffering:

```
app.get('/api/notes/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // NGINX: disable proxy buffering

  const requestId = req.query.request_id || crypto.randomUUID();
  res.write(`event: meta\ndata: ${JSON.stringify({ request_id: requestId })}\n\n`);

  // Fast pre-guard before showing first tokens
  const ok = await preGuard(req.body);
  if (!ok) {
    res.write(`event: error\ndata: ${JSON.stringify({ code: 'PRE_GUARD_FAIL' })}\n\n`);
    return res.end();
  }

  // Send outline first to stabilize structure
  const outline = await draftOutline(req.body);
  res.write(`event: outline\ndata: ${JSON.stringify({ section_ids: outline.ids })}\n\n`);
  res.flush?.();

  // Stream sentences by section
  try {
    for await (const chunk of model.stream(req.body.prompt)) {
      if (chunk.type === 'sentence') {
        res.write(`event: chunk\ndata: ${JSON.stringify({
          section_id: chunk.sectionId,
          segment_type: 'text',
          content: chunk.text,
          t: Date.now()
        })}\n\n`);
      } else if (chunk.type === 'citation') {
        res.write(`event: citation\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
    }
    res.write(`event: done\ndata: ${JSON.stringify({ finish_reason: 'stop', usage: usageStats() })}\n\n`);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ code: 'STREAM_FAIL', message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});
```

Client-side, we used EventSource and rendered by section with a “Draft → Finalize” flow:

```
const es = new EventSource(`/api/notes/stream?request_id=${requestId}`);

es.addEventListener('outline', e => {
  const { section_ids } = JSON.parse(e.data);
  renderSkeleton(section_ids);
});

es.addEventListener('chunk', e => {
  const { section_id, content } = JSON.parse(e.data);
  appendSentence(section_id, content);
});

es.addEventListener('citation', e => {
  pinCitation(JSON.parse(e.data));
});

es.addEventListener('error', e => showFallback(e));
es.addEventListener('done', e => {
  const meta = JSON.parse(e.data);
  showFinalizeButton(meta.usage);
  es.close();
});

// Stop button cancels both client stream and server decoding
stopBtn.onclick = () => fetch(`/api/notes/cancel`, { method: 'POST', body: JSON.stringify({ request_id }) });
```

A few implementation choices proved especially important and mirrored the Streaming-First principles we committed to:

- We measured both TTFT (time-to-first-token) and TTLT (time-to-last-token) and alerted on stalls, which surfaced proxy buffering we had overlooked in one region.
- We tuned chunking to sentence boundaries using a lightweight punctuation heuristic, which dramatically reduced visual “backtracking.”
- We offered a “Show final” toggle that collapses transient edits, and we lock section headers before details to avoid layout shifts.

## Results and How the Pattern Helped
Streaming-First changed the clinician experience from waiting to collaborating. Instead of staring at a spinner, they see the outline within a few hundred milliseconds, read the first sentence of the Assessment shortly after, and can stop if the angle is wrong. That sense of control reduced frustration and rework, and made our assistant feel like a reliable partner.

From a systems perspective, we finally gained visibility into mid-stream behavior and could optimize accordingly. Early cancels now actually save compute, and our analytics correlate the point of cancel with prompts and patient context so we can improve the initial draft.

- Perceived speed: P50 time-to-first-visible content dropped from 2.1s to 320ms; P95 fell from 5.6s to 1.1s.
- Efficiency: Early cancels increased (because the option is visible), but average tokens consumed per draft decreased by 14%, cutting monthly inference costs by 11%.
- Throughput: Average note completion time decreased by 24%, contributing to a 9% reduction in visit overrun.
- Quality and trust: Clinician satisfaction (CSAT) improved by 0.6 points on a 5-point scale; the “Draft → Finalize” flow reduced accidental commits by 38%.
- Reliability: Mid-stream timeout incidents dropped by 62% after adding heartbeats and a reconnection strategy.

The biggest lesson was that Streaming-First is not just a transport switch—it’s a product decision. By pairing sentence-level streaming with outline-first scaffolding, clear draft labeling, and explicit finish semantics, we delivered a faster, safer, and more controllable experience. For HelixCare, the pattern paid off in happier clinicians, shorter visits, and lower compute costs, all while maintaining our compliance posture.