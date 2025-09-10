import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Import the SUT after installing fake timers and silencing console so the demo IIFE completes instantly.
let SUT: typeof import("./main");
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });

  // Silence the demo's console chatter; still allow assertions with spies if needed.
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // Import SUT. Its top-level demo will start, but we will fast-forward all timers to shut it down quickly.
  SUT = await import("./main");

  // Drive all scheduled timers (demo server + clients + sleeps) so the demo session closes cleanly.
  await vi.runAllTimersAsync();
  vi.clearAllTimers();
});

afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("Streaming & Callbacks example - server and client behavior", () => {
  // Helper to create a server on a random port and produce a base URL.
  const startTestServer = async () => {
    const { server, port } = await SUT.startServer(0);
    const baseUrl = `http://localhost:${port}`;
    return { server, baseUrl };
  };

  it("streams a full session and completes once tool results are posted", async () => {
    const { server, baseUrl } = await startTestServer();

    // Track all events for assertions.
    const deltas: string[] = [];
    const types: string[] = [];
    const seqs: number[] = [];
    const toolCalls: { callId: string; name: string; args: unknown }[] = [];
    const toolResults: string[] = [];
    let requestId = "";
    let doneReason: string | null = null;
    let totals: { deltas: number; toolsRequested: number; toolsCompleted: number } | null = null;

    // Set up an SSE client that:
    // - captures deltas and sequence numbers,
    // - immediately executes tools and POSTs results back,
    // - stops when the "done" event arrives.
    const donePromise = new Promise<void>((resolve) => {
      const client = new SUT.SSEClient(`${baseUrl}/api/brief/stream?topic=${encodeURIComponent("integration test")}`, {
        start: (e) => {
          types.push("start");
          seqs.push(e.seq);
          // The server embeds requestId in the StartData payload, which is required to POST tool results.
          requestId = (e.data as { requestId: string }).requestId;
          expect(requestId).toBeTypeOf("string");
          expect(requestId.length).toBeGreaterThan(0);
        },
        delta: (e) => {
          types.push("delta");
          seqs.push(e.seq);
          deltas.push((e.data as { text: string }).text);
        },
        tool_call: async (e) => {
          types.push("tool_call");
          seqs.push(e.seq);
          const { callId, name, args } = e.data as { callId: string; name: "factCheck" | "photoSearch" | "fetchWire"; args: unknown };
          toolCalls.push({ callId, name, args });

          // Execute the requested tool via SUT.tools and POST the result back to the server.
          let result: unknown;
          if (name === "factCheck") {
            result = await SUT.tools.factCheck(args as { claim: string });
          } else if (name === "photoSearch") {
            result = await SUT.tools.photoSearch(args as { query: string; license: "editorial" | "creative" });
          } else {
            // This example doesn't use other tools; fail fast if it ever does.
            throw new Error(`Unexpected tool: ${name}`);
          }
          const ok = await SUT.postJSON(`${baseUrl}/api/brief/${requestId}/tool_result`, { callId, result });
          expect(ok).toBe(true);
        },
        tool_result: (e) => {
          types.push("tool_result");
          seqs.push(e.seq);
          toolResults.push((e.data as { callId: string }).callId);
        },
        error: (e) => {
          // No errors expected on the happy path.
          errorSpy(`STREAM_ERROR(for test): ${(e.data as { message: string }).message}`);
        },
        done: (e) => {
          types.push("done");
          seqs.push(e.seq);
          doneReason = (e.data as { reason: string }).reason;
          totals = (e.data as { totals: { deltas: number; toolsRequested: number; toolsCompleted: number } }).totals;
          client.close();
          resolve();
        },
      });

      // Open the stream only after registering callbacks.
      client.open();
    });

    // Advance timers enough to:
    // - emit early deltas/tool_calls,
    // - resolve tools (140ms & 180ms sleeps),
    // - finish the remaining deltas and "done".
    await vi.advanceTimersByTimeAsync(2000);
    await donePromise;

    // Assertions for completeness and ordering.
    expect(doneReason).toBe("completed");
    expect(totals).not.toBeNull();
    expect(totals!.toolsRequested).toBe(2);
    expect(totals!.toolsCompleted).toBe(2);
    // The server emits multiple deltas; assert we received at least the expected core set.
    expect(deltas.join("")).toContain("Flash brief:");
    expect(deltas.length).toBeGreaterThanOrEqual(6);

    // Ensure the sequence numbers strictly increase with each event delivered.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    // Verify both tool calls occurred and tool results echoed back.
    expect(toolCalls.length).toBe(2);
    expect(toolResults.length).toBe(2);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("supports deterministic cancellation via the cancel endpoint", async () => {
    const { server, baseUrl } = await startTestServer();

    let requestId = "";
    let sawDelta = false;
    let doneReason: string | null = null;

    const donePromise = new Promise<void>((resolve) => {
      const client = new SUT.SSEClient(`${baseUrl}/api/brief/stream?topic=${encodeURIComponent("cancel test")}`, {
        start: (e) => {
          requestId = (e.data as { requestId: string }).requestId;
        },
        delta: async () => {
          // Cancel as soon as the first delta arrives to simulate a prompt change.
          if (!sawDelta) {
            sawDelta = true;
            const ok = await SUT.postJSON(`${baseUrl}/api/brief/${requestId}/cancel`, {});
            expect(ok).toBe(true);
          }
        },
        done: (e) => {
          doneReason = (e.data as { reason: string }).reason;
          client.close();
          resolve();
        },
      });
      client.open();
    });

    // Drive timers to reach first delta (~80ms) and then cancellation / done.
    await vi.advanceTimersByTimeAsync(1000);
    await donePromise;

    expect(doneReason).toBe("cancelled");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns proper status on tool_result and cancel endpoints for unknown identifiers", async () => {
    const { server, baseUrl } = await startTestServer();

    // Unknown requestId => 404 => postJSON returns false.
    const okUnknownReq = await SUT.postJSON(`${baseUrl}/api/brief/${encodeURIComponent("nope")}/tool_result`, {
      callId: "does-not-exist",
      result: { some: "value" },
    });
    expect(okUnknownReq).toBe(false);

    // Create a real stream to get a valid requestId, then use an unknown callId.
    let requestId = "";
    const onceStart = new Promise<void>((resolve) => {
      const client = new SUT.SSEClient(`${baseUrl}/api/brief/stream?topic=test`, {
        start: (e) => {
          requestId = (e.data as { requestId: string }).requestId;
          client.close();
          resolve();
        },
      });
      client.open();
    });
    await vi.advanceTimersByTimeAsync(1); // Start event is sent immediately; this ticks the event loop.
    await onceStart;

    const okUnknownCall = await SUT.postJSON(`${baseUrl}/api/brief/${requestId}/tool_result`, {
      callId: "unknown-call-id",
      result: { answer: 42 },
    });
    expect(okUnknownCall).toBe(false);

    // Unknown cancel requestId => 404 => postJSON returns false.
    const okUnknownCancel = await SUT.postJSON(`${baseUrl}/api/brief/${encodeURIComponent("nope")}/cancel`, {});
    expect(okUnknownCancel).toBe(false);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("safety timeout cancels streams that hang too long without completion", async () => {
    const { server, baseUrl } = await startTestServer();

    let reason: string | null = null;
    // Intentionally do NOT respond with tool results and do NOT call cancel.
    const donePromise = new Promise<void>((resolve) => {
      const client = new SUT.SSEClient(`${baseUrl}/api/brief/stream?topic=timeout`, {
        done: (e) => {
          reason = (e.data as { reason: string }).reason;
          client.close();
          resolve();
        },
      });
      client.open();
    });

    // The server's safety timeout is 12s; advance beyond that boundary.
    await vi.advanceTimersByTimeAsync(13000);
    await donePromise;

    expect(reason).toBe("cancelled");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("startClient returns a session that exposes requestId() and triggers cancel() with correct endpoint", async () => {
    const { server, baseUrl } = await startTestServer();

    // Spy on postJSON to ensure cancel endpoint is invoked with the derived requestId.
    const postSpy = vi.spyOn(SUT, "postJSON");

    const session = SUT.startClient(baseUrl, "client-cancel-test");
    // Advance timers until the Start event arrives and requestId is set in the client.
    await vi.advanceTimersByTimeAsync(100);

    const reqId = session.requestId();
    expect(reqId).toBeTypeOf("string");
    expect(reqId.length).toBeGreaterThan(0);

    // Call cancel and ensure postJSON got the correct cancel URL.
    await session.cancel();
    expect(postSpy).toHaveBeenCalled();
    const calledWithCancel = postSpy.mock.calls.some(([url]) =>
      typeof url === "string" && url.includes(`/api/brief/${reqId}/cancel`)
    );
    expect(calledWithCancel).toBe(true);

    postSpy.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});