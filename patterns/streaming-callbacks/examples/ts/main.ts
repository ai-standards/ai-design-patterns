/**
 * Streaming + Tool-Callbacks demo (self-contained, no external APIs).
 *
 * This single file spins up:
 * - A tiny HTTP server with an SSE endpoint that streams model events
 *   (start, delta, tool_call, tool_result, error, done) with seq numbers.
 * - POST endpoints for tool_result and cancel.
 * - A minimal Node-side SSE client that reacts with callbacks:
 *   - Renders text deltas, but only flushes complete sentences to reduce flicker.
 *   - Executes tools immediately when tool_call arrives and POSTs results back.
 *   - Cancels deterministically when a "prompt change" occurs.
 *
 * Design notes:
 * - The server is a toy LLM that emits deltas and asks for tools early.
 *   It pauses at a natural boundary until tool results arrive, then continues.
 * - The client simulates the browser: observes the stream, runs tools, and cancels.
 * - Everything lives in-memory; sequence numbers and minimal payloads keep it robust.
 *
 * Run with: ts-node this_file.ts
 */

import http, { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { randomUUID } from "crypto";

// ----- Shared event schema -----

// Allowed event types. Keeping the set small reduces surface area and branching complexity.
type EventType = "start" | "delta" | "tool_call" | "tool_result" | "error" | "done";

// Envelope sent over SSE. Every event is ordered with a per-request seq and carries requestId.
interface StreamEvent<T> {
  requestId: string;
  seq: number;
  type: EventType;
  data: T;
}

// Payload shapes for each event type for compile-time guarantees and reader clarity.
interface StartData {
  requestId: string;
  topic: string;
  startedAt: number;
}
interface DeltaData {
  text: string; // token or chunk delta (not guaranteed to be sentence-bounded)
}
interface ToolCallData {
  callId: string;
  name: "factCheck" | "photoSearch" | "fetchWire";
  args: Record<string, unknown>;
}
interface ToolResultData {
  callId: string;
  result: unknown;
  receivedAt: number;
}
interface ErrorData {
  message: string;
}
interface DoneData {
  reason: "completed" | "cancelled" | "error";
  totals: { deltas: number; toolsRequested: number; toolsCompleted: number };
}

// ----- Server implementation (SSE + tool/cancel endpoints) -----

// Internal request state tracks the live stream and tool waiters.
// This allows the server to "pause" generation until a tool_result arrives.
interface RequestState {
  id: string;
  seq: number;
  res: ServerResponse;
  topic: string;
  cancelled: boolean;
  ended: boolean;
  deltaCount: number;
  toolsRequested: number;
  toolsCompleted: number;
  toolWaiters: Map<string, { resolve: (v: unknown) => void; calledAt: number }>;
  toolLatencies: Map<string, number>;
  createdAt: number;
}

// Requests are keyed by requestId so tool_result and cancel can find the stream.
const requests = new Map<string, RequestState>();

// Utility: async sleep to simulate model tokenization cadence.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Helper to write a single SSE event with proper formatting.
// Using a small function like this enforces the schema and sequencing invariants.
function sendEvent<T>(
  state: RequestState,
  type: EventType,
  data: T
): void {
  if (state.cancelled || state.ended) return;
  state.seq += 1;
  const payload: StreamEvent<T> = {
    requestId: state.id,
    seq: state.seq,
    type,
    data,
  };
  const s = `event: ${type}\nid: ${state.seq}\ndata: ${JSON.stringify(payload.data)}\n\n`;
  state.res.write(s);
  if (type === "delta") state.deltaCount += 1;
}

// Central guard: check cancellation before continuing.
// Avoids writing after end and ensures deterministic halting.
function assertNotCancelled(state: RequestState): void {
  if (state.cancelled || state.ended) {
    throw new Error("cancelled");
  }
}

// The "model" runner: streams deltas, emits tool calls early, then waits for results.
// Each await is followed by a cancellation check to ensure prompt responsiveness.
async function runBriefStream(state: RequestState): Promise<void> {
  try {
    // Emit "start" promptly for TTFB. Keep payload small: requestId, topic, time.
    sendEvent<StartData>(state, "start", {
      requestId: state.id,
      topic: state.topic,
      startedAt: Date.now(),
    });

    // Simulate early content and early tool requests for maximal overlap.
    await sleep(80);
    assertNotCancelled(state);
    sendEvent<DeltaData>(state, "delta", { text: `Flash brief: ${state.topic}\n` });

    // Issue two tool calls upfront and continue streaming other content while they execute.
    const factCallId = `call-${randomUUID().slice(0, 8)}`;
    state.toolWaiters.set(factCallId, {
      resolve: () => {},
      calledAt: Date.now(),
    });
    // Replace placeholder resolver with a real one via a Promise.
    const factResult = new Promise<unknown>((resolve) =>
      state.toolWaiters.set(factCallId, { resolve, calledAt: Date.now() })
    );
    state.toolsRequested += 1;
    sendEvent<ToolCallData>(state, "tool_call", {
      callId: factCallId,
      name: "factCheck",
      args: { claim: "At least 3 injuries reported by local EMS." },
    });

    const photoCallId = `call-${randomUUID().slice(0, 8)}`;
    const photoResult = new Promise<unknown>((resolve) =>
      state.toolWaiters.set(photoCallId, { resolve, calledAt: Date.now() })
    );
    state.toolsRequested += 1;
    sendEvent<ToolCallData>(state, "tool_call", {
      callId: photoCallId,
      name: "photoSearch",
      args: { query: `${state.topic} scene`, license: "editorial" },
    });

    // Keep tokens flowing: the client will render at sentence boundaries to avoid flicker.
    const chunks = [
      "• Officials are responding; traffic reroutes in effect. ",
      "• Live updates pending verification. ",
      "• One verified fact will follow once confirmed. ",
    ];
    for (const c of chunks) {
      await sleep(120);
      assertNotCancelled(state);
      sendEvent<DeltaData>(state, "delta", { text: c });
    }

    // Pause at a natural junction: include verified fact once tool_result arrives.
    const fact = (await factResult) as { verdict: "true" | "false"; note: string };
    assertNotCancelled(state);
    sendEvent<DeltaData>(state, "delta", {
      text: `• Verified: ${fact.verdict === "true" ? fact.note : "pending official confirmation"} `,
    });

    // Also include a photo suggestion once available, then wrap up.
    const photo = (await photoResult) as { url: string; caption: string };
    assertNotCancelled(state);
    sendEvent<DeltaData>(state, "delta", {
      text: `• Photo suggestion: ${photo.caption} (${photo.url})\n`,
    });

    // Final polishing token(s) to simulate natural end cadence.
    await sleep(60);
    assertNotCancelled(state);
    sendEvent<DoneData>(state, "done", {
      reason: "completed",
      totals: {
        deltas: state.deltaCount,
        toolsRequested: state.toolsRequested,
        toolsCompleted: state.toolsCompleted,
      },
    });
    state.ended = true;
    state.res.end();
  } catch (e) {
    // Cancellation uses a cheap error path to unwind; detect via flag to avoid double signals.
    if (state.cancelled || state.ended) return;
    sendEvent<ErrorData>(state, "error", {
      message: e instanceof Error ? e.message : "unknown error",
    });
    sendEvent<DoneData>(state, "done", {
      reason: "error",
      totals: {
        deltas: state.deltaCount,
        toolsRequested: state.toolsRequested,
        toolsCompleted: state.toolsCompleted,
      },
    });
    state.ended = true;
    state.res.end();
  }
}

// Minimal body collector for small JSON posts. Avoids external libs.
function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(buf) as T);
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

// Start the HTTP server with three routes: SSE, tool_result, cancel.
// Comments inline explain each branch and the wire format.
async function startServer(port = 0): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      // 1) Stream endpoint: emits event-sourced SSE with sequence numbers.
      if (req.method === "GET" && url.pathname === "/api/brief/stream") {
        const topic = url.searchParams.get("topic") ?? "breaking news";
        const id = randomUUID();
        // Configure SSE response headers. Disable buffering, keep connection alive.
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        const state: RequestState = {
          id,
          seq: 0,
          res,
          topic,
          cancelled: false,
          ended: false,
          deltaCount: 0,
          toolsRequested: 0,
          toolsCompleted: 0,
          toolWaiters: new Map(),
          toolLatencies: new Map(),
          createdAt: Date.now(),
        };
        requests.set(id, state);

        // Clean up if client disconnects to avoid leaks.
        res.on("close", () => {
          if (!state.ended) state.cancelled = true;
          requests.delete(id);
        });

        // Safety timeout: if the request hangs too long, cancel deterministically.
        const timeout = setTimeout(() => {
          if (state.ended) return;
          state.cancelled = true;
          sendEvent<DoneData>(state, "done", {
            reason: "cancelled",
            totals: {
              deltas: state.deltaCount,
              toolsRequested: state.toolsRequested,
              toolsCompleted: state.toolsCompleted,
            },
          });
          state.ended = true;
          res.end();
          requests.delete(id);
        }, 12000);

        // Start the simulated model stream.
        runBriefStream(state).finally(() => clearTimeout(timeout));
        return;
      }

      // 2) Tool results endpoint: idempotent; resolves any awaiting tool call and echoes a tool_result event.
      // Path: /api/brief/:id/tool_result
      const toolMatch = url.pathname.match(/^\/api\/brief\/([^/]+)\/tool_result$/);
      if (req.method === "POST" && toolMatch) {
        const requestId = toolMatch[1];
        const state = requests.get(requestId);
        if (!state) {
          res.writeHead(404).end("unknown requestId");
          return;
        }
        const body = await readJson<{ callId: string; result: unknown }>(req);
        const waiter = state.toolWaiters.get(body.callId);
        if (!waiter) {
          res.writeHead(404).end("unknown callId");
          return;
        }
        sendEvent<ToolResultData>(state, "tool_result", {
          callId: body.callId,
          result: body.result,
          receivedAt: Date.now(),
        });
        state.toolsCompleted += 1;
        state.toolLatencies.set(body.callId, Date.now() - waiter.calledAt);
        waiter.resolve(body.result);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }

      // 3) Cancel endpoint: flips the cancelled flag and ends the stream with a done event.
      // Path: /api/brief/:id/cancel
      const cancelMatch = url.pathname.match(/^\/api\/brief\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const requestId = cancelMatch[1];
        const state = requests.get(requestId);
        if (!state) {
          res.writeHead(404).end("unknown requestId");
          return;
        }
        if (!state.ended) {
          state.cancelled = true;
          sendEvent<DoneData>(state, "done", {
            reason: "cancelled",
            totals: {
              deltas: state.deltaCount,
              toolsRequested: state.toolsRequested,
              toolsCompleted: state.toolsCompleted,
            },
          });
          state.ended = true;
          state.res.end();
        }
        res.writeHead(200).end("ok");
        return;
      }

      res.writeHead(404).end("not found");
    } catch (e) {
      res.writeHead(500).end("server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind");
  return { server, port: address.port };
}

// ----- Minimal SSE client and tool runner (simulating the browser app) -----

// Simple SSE reader for Node: opens a GET request and parses event: / id: / data: lines.
// Emits to provided callbacks keyed by event type. Keep it tiny and dependency-free.
class SSEClient {
  private req: http.ClientRequest | null = null;
  private readonly handlers: Partial<Record<EventType, (e: StreamEvent<any>) => void>>;
  constructor(private readonly url: string, handlers: SSEClient["handlers"]) {
    this.handlers = handlers;
  }
  open(): void {
    this.req = http.get(this.url, (res) => {
      res.setEncoding("utf8");
      let buf = "";
      let currType: EventType | null = null;
      let currId: number | null = null;
      let currData = "";
      const dispatch = () => {
        if (!currType) return;
        const handler = this.handlers[currType];
        if (handler) {
          handler({
            requestId: "", // requestId is inside data; kept empty in envelope for this client.
            seq: currId ?? 0,
            type: currType,
            data: JSON.parse(currData),
          });
        }
        currType = null;
        currId = null;
        currData = "";
      };
      res.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trimEnd();
          buf = buf.slice(idx + 1);
          if (line.startsWith("event:")) currType = line.slice(6).trim() as EventType;
          else if (line.startsWith("id:")) currId = Number(line.slice(3).trim());
          else if (line.startsWith("data:")) currData += line.slice(5).trim();
          else if (line === "") dispatch();
        }
      });
    });
  }
  close(): void {
    this.req?.destroy();
  }
}

// Mock tools: fast, deterministic, and side-effect free.
// In production, these would call external services. Here they just sleep and return shaped data.
const tools = {
  async factCheck(args: { claim: string }): Promise<{ verdict: "true" | "false"; note: string }> {
    await sleep(180);
    return { verdict: "true", note: `EMS confirms: ${args.claim}` };
  },
  async photoSearch(args: { query: string; license: "editorial" | "creative" }): Promise<{ url: string; caption: string }> {
    await sleep(140);
    return { url: `photo://${encodeURIComponent(args.query)}`, caption: `${args.query}, ${args.license} license` };
  },
};

// Helper: POST JSON, return ok boolean. Keeps the example minimal.
function postJSON(url: string, body: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const { hostname, port, pathname } = new URL(url);
    const req = http.request(
      { hostname, port: Number(port), path: pathname, method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
      }
    );
    req.on("error", () => resolve(false));
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Client runner encapsulates event observers: renderer, tool runner, telemetry, and cancel.
// It demonstrates:
// - immediate incremental rendering (delta),
// - immediate tool dispatch on tool_call,
// - deterministic cancel on prompt change.
function startClient(baseUrl: string, topic: string) {
  const url = `${baseUrl}/api/brief/stream?topic=${encodeURIComponent(topic)}`;
  let requestId = "";
  let buffer = "";
  let ttfbStart = Date.now();
  let firstDeltaAt: number | null = null;

  // Simple renderer: coalesces deltas but only prints out complete sentences to avoid jitter.
  const flushAtSentence = () => {
    const parts = buffer.split(/([.!?]\s)/);
    if (parts.length < 3) return; // need a sentence + boundary
    const flush = parts.slice(0, 2).join("");
    buffer = parts.slice(2).join("");
    console.log("RENDER:", flush);
  };

  const es = new SSEClient(url, {
    start: (e: StreamEvent<StartData>) => {
      requestId = e.data.requestId;
      ttfbStart = Date.now();
      console.log("START:", { requestId: e.data.requestId, topic: e.data.topic });
    },
    delta: (e: StreamEvent<DeltaData>) => {
      if (!firstDeltaAt) firstDeltaAt = Date.now();
      buffer += e.data.text;
      flushAtSentence();
    },
    tool_call: async (e: StreamEvent<ToolCallData>) => {
      const { callId, name, args } = e.data;
      console.log("TOOL_CALL:", name, "args:", args);
      // Dispatch to the appropriate tool immediately, post result back to server.
      try {
        let result: unknown;
        if (name === "factCheck") result = await tools.factCheck(args as { claim: string });
        else if (name === "photoSearch") result = await tools.photoSearch(args as { query: string; license: "editorial" | "creative" });
        else throw new Error(`Unknown tool: ${name}`);
        await postJSON(`${baseUrl}/api/brief/${requestId}/tool_result`, { callId, result });
      } catch (err) {
        console.error("Tool error:", (err as Error).message);
      }
    },
    tool_result: (e: StreamEvent<ToolResultData>) => {
      console.log("TOOL_RESULT:", e.data.callId);
    },
    done: (e: StreamEvent<DoneData>) => {
      // Flush any remaining buffer at the end so the user sees the final text.
      if (buffer.trim().length) console.log("RENDER:", buffer.trim());
      if (firstDeltaAt) {
        console.log("TELEMETRY:", {
          TTFB_ms: firstDeltaAt - ttfbStart,
          tokensSeen: "approx " + e.data.totals.deltas,
          tools: `${e.data.totals.toolsCompleted}/${e.data.totals.toolsRequested}`,
          reason: e.data.reason,
        });
      }
      es.close();
    },
    error: (e: StreamEvent<ErrorData>) => {
      console.error("STREAM_ERROR:", e.data.message);
    },
  });
  es.open();

  // Expose a cancel function to simulate "editor changes prompt".
  return {
    requestId: () => requestId,
    cancel: async () => {
      es.close();
      await postJSON(`${baseUrl}/api/brief/${requestId}/cancel`, {});
      console.log("CANCELLED:", requestId);
    },
  };
}

// ----- Usage example: bring it together -----

(async () => {
  // Boot server, then run two client sessions: the first gets cancelled mid-flight.
  const { server, port } = await startServer(0);
  const baseUrl = `http://localhost:${port}`;

  // Session 1: user asks for a brief, then quickly pivots.
  const s1 = startClient(baseUrl, "Bridge collapse on 5th Ave");
  setTimeout(() => s1.cancel(), 1100); // Simulate prompt edit ~1.1s in.

  // Session 2: new topic proceeds to completion.
  setTimeout(() => startClient(baseUrl, "Severe storm warning in Riverton"), 1200);

  // Shut down after a short demo window.
  setTimeout(() => {
    server.close();
  }, 5000);
})();