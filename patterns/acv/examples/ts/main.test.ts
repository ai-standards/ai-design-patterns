import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Helper to run the SUT as a side-effect module while capturing console output.
// The SUT is a self-contained script with no exports; all observability comes from logging.
async function runMainAndCapture(): Promise<string[]> {
  const logs: string[] = [];

  // Capture console.log to assert on CLI and "web" view output deterministically.
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    // Join arguments to a single string for easier matching.
    logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  // Reset module cache to re-execute the script on each call.
  vi.resetModules();

  // Import for side effects (runs the whole pipeline end-to-end).
  await import('./main');

  logSpy.mockRestore();
  return logs;
}

describe('ACV (Agent–Controller–View) example (side-effect module)', () => {
  beforeEach(() => {
    // Use fake timers to demonstrate control of time-related APIs if needed in future changes.
    // Current SUT does not rely on timers, but exercising the capability keeps tests robust.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('runs the pipeline end-to-end and emits key logs (planning, tools, QA, costs, final assertion)', async () => {
    const logs = await runMainAndCapture();

    // 1) Agent golden check printed by the SUT’s initial state probe.
    expect(logs.some((l) => l.startsWith('[test] first step = apply_tm'))).toBe(true);

    // 2) Controller starts and finishes each tool deterministically.
    expect(logs).toContain('[tool] start applyTM');
    expect(logs.some((l) => l.startsWith('[tool] done applyTM'))).toBe(true);

    expect(logs).toContain('[tool] start mtFill');
    expect(logs.some((l) => l.startsWith('[tool] done mtFill'))).toBe(true);

    // 3) At least one QA result is emitted.
    expect(logs.some((l) => l.startsWith('[qa] score='))).toBe(true);

    // 4) Cost events are emitted per-locale; assert both locales appear with a numeric spent and budget.
    const costLines = logs.filter((l) => l.startsWith('[cost] '));
    expect(costLines.length).toBeGreaterThanOrEqual(2);
    expect(costLines.some((l) => l.startsWith('[cost] es '))).toBe(true);
    expect(costLines.some((l) => l.startsWith('[cost] fr '))).toBe(true);
    for (const line of costLines) {
      // Example: "[cost] es spent=0.0003 budget=1"
      const match = line.match(/spent=([0-9.]+)\s+budget=([0-9.]+)/);
      expect(match, `Invalid cost line: ${line}`).not.toBeNull();
      if (match) {
        const spent = Number(match[1]);
        const budget = Number(match[2]);
        expect(Number.isFinite(spent)).toBe(true);
        expect(Number.isFinite(budget)).toBe(true);
        // Ensure budget is not exceeded.
        expect(spent).toBeLessThanOrEqual(budget + 1e-9);
      }
    }

    // 5) Placeholder autofix should make ES "{name}" present after the run.
    // The SUT logs this as a final assertion.
    const placeholderAssert = logs.find((l) => l.startsWith('[assert] ES s2 placeholders ok = '));
    expect(placeholderAssert).toBeDefined();
    expect(placeholderAssert).toContain('true');

    // 6) Final status: Either a commit occurs (dry-run PR) or the pipeline halts awaiting input.
    // Accept either outcome to be robust to policy thresholds; both are deterministic.
    const committedLog = logs.find((l) => l.startsWith('[git] PR created on '));
    const awaitingLog = logs.find((l) => l.startsWith('[wait]'));
    // Must have at least one of the terminal signals or a web status snapshot.
    const webStatus = logs.find((l) => l.startsWith('[web] '));
    expect(webStatus).toBeDefined();

    // If commit happened, the SUT also logs a final committed assertion.
    if (committedLog) {
      const committedAssert = logs.find((l) => l.startsWith('[assert] committed = '));
      expect(committedAssert).toBeDefined();
      expect(committedAssert).toContain('true');
      // Web view snapshot should reflect committed state.
      expect(webStatus?.includes('Committed')).toBe(true);
    } else {
      // Otherwise, the pipeline should surface a wait reason (e.g., max iterations or risk review).
      expect(awaitingLog).toBeDefined();
      // Web view may show "In Progress" if not committed.
      expect(webStatus?.includes('In Progress')).toBe(true);
    }
  });

  it('plans in the expected initial sequence: apply_tm -> mt_fill -> qa_check (in order)', async () => {
    const logs = await runMainAndCapture();

    // The CLI view logs each plan decision. Validate the first three major actions appear in order.
    const planLines = logs.filter((l) => l.startsWith('[plan] '));

    // There should be at least three planning decisions logged.
    expect(planLines.length).toBeGreaterThanOrEqual(3);

    const firstApplyIdx = planLines.findIndex((l) => l === '[plan] apply_tm');
    const firstMtIdx = planLines.findIndex((l) => l === '[plan] mt_fill');
    const firstQaIdx = planLines.findIndex((l) => l === '[plan] qa_check');

    expect(firstApplyIdx).toBeGreaterThanOrEqual(0);
    expect(firstMtIdx).toBeGreaterThan(firstApplyIdx);
    expect(firstQaIdx).toBeGreaterThan(firstMtIdx);
  });

  it('is deterministic across runs: identical log transcript for repeated executions', async () => {
    const run1 = await runMainAndCapture();
    const run2 = await runMainAndCapture();

    // Comparing full transcript yields a strong determinism check across the pure Agent,
    // the deterministic tools, and the controller sequencing under the fixed inputs.
    expect(run2).toEqual(run1);
  });

  it('enforces MT budgets: per-locale spend never exceeds configured budget', async () => {
    const logs = await runMainAndCapture();

    // Parse all cost lines and assert spent <= budget with a tiny epsilon.
    const costLines = logs.filter((l) => l.startsWith('[cost] '));
    expect(costLines.length).toBeGreaterThan(0);

    for (const line of costLines) {
      const match = line.match(/spent=([0-9.]+)\s+budget=([0-9.]+)/);
      expect(match, `Invalid cost line: ${line}`).not.toBeNull();
      if (match) {
        const spent = Number(match[1]);
        const budget = Number(match[2]);
        expect(spent).toBeLessThanOrEqual(budget + 1e-9);
      }
    }
  });
});