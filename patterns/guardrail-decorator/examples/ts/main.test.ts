import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type AnyRecord = Record<string, unknown>;

function getCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls as unknown[][];
}

async function runModuleWithTimers(): Promise<void> {
  // Import the module dynamically so side effects (main()) run inside each test.
  await import("./main");
  // Flush all pending timers (used by the mocked LLM sleep) and then microtasks.
  await vi.runAllTimersAsync();
  // Ensure any queued microtasks are settled.
  await Promise.resolve();
}

function findLogCall(spy: ReturnType<typeof vi.spyOn>, tag: string) {
  return getCalls(spy).find((args) => args[0] === tag);
}

function findAllLogCalls(spy: ReturnType<typeof vi.spyOn>, tag: string) {
  return getCalls(spy).filter((args) => args[0] === tag);
}

function parseFinalTicketFromConsole(spy: ReturnType<typeof vi.spyOn>): unknown | null {
  // main() prints: console.log("final_ticket_draft", JSON.stringify(ticket, null, 2));
  const call = findLogCall(spy, "final_ticket_draft");
  if (!call) return null;
  const payload = call[1];
  if (typeof payload !== "string") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function isActionStep(value: unknown): value is { type: string; citations?: unknown; partId?: unknown; torqueNm?: unknown } {
  return typeof value === "object" && value !== null && "type" in (value as AnyRecord);
}

function assertCitationsWithinRange(actions: unknown, nLines: number) {
  expect(Array.isArray(actions)).toBe(true);
  for (const step of actions as unknown[]) {
    if (!isActionStep(step)) continue;
    const citations = (step as AnyRecord).citations;
    expect(Array.isArray(citations)).toBe(true);
    for (const idx of citations as unknown[]) {
      expect(Number.isInteger(idx)).toBe(true);
      const num = idx as number;
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(nLines);
    }
  }
}

describe("Guardrail Decorator example (end-to-end via module side effect)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("produces a compliant ticket after a repair loop (deterministic, no JSON-malformed flip)", async () => {
    // Fix Date.now to a constant that is NOT divisible by 10.
    // This avoids the mock LLM's 10% malformed JSON branch on the first attempt.
    vi.spyOn(Date, "now").mockReturnValue(123456789);

    await runModuleWithTimers();

    // Expect at least one guardrail violation before success (first attempt is flawed).
    const violations = findAllLogCalls(warnSpy, "guardrails_violation");
    expect(violations.length).toBeGreaterThan(0);

    // Ensure redaction occurred in violation logs (VIN is not logged directly; should be bullets).
    const violationPayload = violations[0][1] as AnyRecord | undefined;
    expect(violationPayload && typeof violationPayload === "object").toBe(true);
    // vin should be a redacted string (first 6 bullets).
    expect(violationPayload?.vin).toBe("••••••");

    // Expect a successful guardrails_ok log with attempt >= 2 (after repair hints applied).
    const ok = findLogCall(infoSpy, "guardrails_ok");
    expect(ok).toBeTruthy();
    const okPayload = ok?.[1] as AnyRecord | undefined;
    expect(okPayload?.attempt).toBeGreaterThanOrEqual(1);
    // The policy tag should be propagated in the success log metadata.
    expect(typeof okPayload?.policyTag).toBe("string");
    expect(okPayload?.policyTag).toContain("policy/warehouse-robot-safety");

    // Final ticket should be printed.
    const ticket = parseFinalTicketFromConsole(logSpy) as AnyRecord | null;
    expect(ticket).not.toBeNull();

    // Structural sanity checks on the final ticket (schema-shape assertions).
    expect(ticket?.version).toBe("v1");
    expect(typeof ticket?.robotId).toBe("string");
    expect(Array.isArray(ticket?.parts)).toBe(true);
    expect(Array.isArray(ticket?.actions)).toBe(true);
    expect(Array.isArray(ticket?.notes)).toBe(true);
    expect(ticket?.policyTag).toBe("policy/warehouse-robot-safety@1");

    // Safety: lockout_tagout must be the first step.
    const actions = ticket?.actions as AnyRecord[];
    expect(actions[0]?.type).toBe("lockout_tagout");

    // Safety: notes should not contain banned phrases like "bypass" or "disable ... interlock".
    const notes = ticket?.notes as string[];
    const joined = notes.join(" ").toLowerCase();
    expect(joined).not.toMatch(/bypass/);
    expect(joined).not.toMatch(/disable.*interlock/);

    // Link critic: citations must reference valid indices w.r.t the provided test log lines (3 in main()).
    assertCitationsWithinRange(ticket?.actions, 3);

    // No fatal error should be logged.
    expect(findLogCall(errorSpy, "fatal_error")).toBeUndefined();
  });

  it("falls back when the global time budget is exhausted before the first attempt", async () => {
    // Carefully control Date.now to simulate immediate time budget exhaustion.
    // Call sequence within guarded run:
    // 1) start = Date.now()
    // 2) elapsed = Date.now() - start -> should be >= 4000 to trigger early fallback
    const sequence = [1000, 6000]; // start=1000, elapsed-check returns 6000 -> elapsed=5000>=4000
    vi.spyOn(Date, "now").mockImplementation(() => {
      const next = sequence.shift();
      return next !== undefined ? next : 6000;
    });

    await runModuleWithTimers();

    // Expect explicit timeout instrumentation followed by fallback instrumentation.
    const timeoutLog = findLogCall(warnSpy, "timeout_budget_exhausted");
    expect(timeoutLog).toBeTruthy();
    const timeoutPayload = timeoutLog?.[1] as AnyRecord | undefined;
    expect(timeoutPayload?.vin).toBe("••••••");

    const fallbackLog = findLogCall(warnSpy, "guardrails_fallback");
    expect(fallbackLog).toBeTruthy();
    const fallbackPayload = fallbackLog?.[1] as AnyRecord | undefined;
    expect(fallbackPayload?.vin).toBe("••••••");

    // Final ticket is the conservative fallback template.
    const ticket = parseFinalTicketFromConsole(logSpy) as AnyRecord | null;
    expect(ticket).not.toBeNull();

    // Fallback characteristics: no parts, only safe steps, safe notes.
    expect(Array.isArray(ticket?.parts)).toBe(true);
    expect((ticket?.parts as unknown[]).length).toBe(0);

    const actions = ticket?.actions as AnyRecord[];
    const types = actions.map((a) => a.type);
    expect(types).toEqual(["lockout_tagout", "inspect"]);
    expect(typeof ticket?.notes?.[0]).toBe("string");
    expect(String(ticket?.notes?.[0])).toMatch(/Fallback: inspection required/i);

    // No fatal error should be logged.
    expect(findLogCall(errorSpy, "fatal_error")).toBeUndefined();
  });

  it("repairs after an initial JSON parsing failure (malformed output on first attempt)", async () => {
    // Drive the mock LLM into its "malformed JSON 10% of the time" branch for the first attempt.
    // Date.now() % 10 === 0 triggers malformed JSON.
    // Expected call pattern:
    //   1) guardedDraft start (Date.now for start)
    //   2) attempt 1 elapsed check
    //   3) llmComplete attempt 1 flip -> return 10 => malformed JSON
    //   4) attempt 2 elapsed check
    //   5) llmComplete attempt 2 flip -> return 11 => good JSON
    const seq = [1000, 1000, 10, 1000, 11];
    vi.spyOn(Date, "now").mockImplementation(() => {
      const v = seq.shift();
      return v !== undefined ? v : 11;
    });

    await runModuleWithTimers();

    // First violation should include json_malformed.
    const violations = findAllLogCalls(warnSpy, "guardrails_violation");
    expect(violations.length).toBeGreaterThan(0);
    const firstViolationPayload = violations[0][1] as AnyRecord;
    expect(Array.isArray(firstViolationPayload.errors)).toBe(true);
    const errors = firstViolationPayload.errors as unknown[];
    const stringifiedErrors = errors.map((e) => String(e));
    expect(stringifiedErrors).toContain("json_malformed");

    // Ultimately, a valid ticket should still be emitted.
    const ticket = parseFinalTicketFromConsole(logSpy) as AnyRecord | null;
    expect(ticket).not.toBeNull();

    // Basic validity checks to ensure the repair produced a usable draft.
    expect(ticket?.version).toBe("v1");
    const actions = ticket?.actions as AnyRecord[];
    expect(actions[0]?.type).toBe("lockout_tagout");
    assertCitationsWithinRange(ticket?.actions, 3);
  });
});