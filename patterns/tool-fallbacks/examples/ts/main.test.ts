import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {} from "./main"; // Type-only import to satisfy "imports './main'" without side effects

// Helper to collect console.log messages as strings
function collectLogs(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map(args => args.join(" "));
}

describe("examples/ts/main.ts - Tool Fallbacks demo (module side-effects)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      // If invoked, surface it to the test instead of killing the process.
      throw new Error(`process.exit called with code ${code}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("runs mostly happy path with mirror fallback (us-west times out, mirror succeeds) and allergens succeed", async () => {
    // Force deterministic behavior:
    // - Supplier us-west: baseDelay ~ 991ms > 900ms timeout => fail primary
    // - Supplier us-east: baseDelay ~ 694ms < 900ms and r high => succeed
    // - Allergens: delay ~ 793ms < 800ms and r high => succeed
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    await vi.isolateModulesAsync(async () => {
      await import("./main");
    });

    // Run all pending timers to let the side-effect "main()" finish
    await vi.runAllTimersAsync();

    const logs = collectLogs(logSpy);

    // Sanity: the demo should print a prep plan summary and a metric line
    expect(logs.some(l => l.includes("=== Prep Plan Summary ==="))).toBe(true);
    expect(logs.some(l => l.includes("[metric] prep_plan"))).toBe(true);

    // Prices section should include three SKUs
    const priceLines = logs.filter(l => /^  - SKU_/.test(l.trim()));
    expect(priceLines.length).toBe(3);

    // Mirror path specifically for SKU_STEAK (preferred us-west) should degrade with 'used_mirror'
    const steakLine = priceLines.find(l => l.includes("SKU_STEAK"));
    expect(steakLine).toBeTruthy();
    // Should be marked degraded and include 'used_mirror'
    expect(steakLine!).toMatch(/\[degraded: .*used_mirror/);

    // The other two SKUs are us-east and should succeed without degradation
    const tomatoLine = priceLines.find(l => l.includes("SKU_TOMATO"));
    const pastaLine = priceLines.find(l => l.includes("SKU_PASTA"));
    expect(tomatoLine).toBeTruthy();
    expect(pastaLine).toBeTruthy();
    expect(tomatoLine!).not.toContain("[degraded");
    expect(pastaLine!).not.toContain("[degraded");

    // Allergens should succeed (no degraded tag)
    const allergenLine = logs.find(l => l.trim().startsWith("- Bolognese:"));
    expect(allergenLine).toBeTruthy();
    expect(allergenLine!).not.toContain("[degraded");

    // Verify high-level metrics reflect this:
    // - price_degraded should be true (mirror used)
    // - allergen_degraded should be false (primary tool succeeded)
    const prepPlanMetric = logs.find(l => l.startsWith("[metric] prep_plan"));
    expect(prepPlanMetric).toBeTruthy();
    expect(prepPlanMetric!).toContain('"price_degraded":true');
    expect(prepPlanMetric!).toContain('"allergen_degraded":false');

    // The us-west supplier breaker should have opened after the timeout
    const westOpen = logs.find(l => l.includes('[metric] breaker_state_change') && l.includes('"supplier_us-west"') && l.includes('"open"'));
    expect(westOpen).toBeTruthy();

    // Ensure the test didn't trigger a fatal exit
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Fatal error:"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("degrades cleanly when tools consistently fail: supplier uses cache/baseline, allergens fall back to local+LLM", async () => {
    // Force worst-case behavior deterministically:
    // - Supplier: r = 0 always -> throttle/5xx; both regions fail quickly
    // - Allergens: r = 0 < badJsonChance(0.2) -> invalid JSON; wrapper falls back
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    await vi.isolateModulesAsync(async () => {
      await import("./main");
    });

    await vi.runAllTimersAsync();

    const logs = collectLogs(logSpy);

    // Summary printed
    expect(logs.some(l => l.includes("=== Prep Plan Summary ==="))).toBe(true);

    const priceLines = logs.filter(l => /^  - SKU_/.test(l.trim()));
    expect(priceLines.length).toBe(3);

    const tomatoLine = priceLines.find(l => l.includes("SKU_TOMATO"));
    const pastaLine = priceLines.find(l => l.includes("SKU_PASTA"));
    const steakLine = priceLines.find(l => l.includes("SKU_STEAK"));

    // All should be degraded
    expect(tomatoLine).toBeTruthy();
    expect(pastaLine).toBeTruthy();
    expect(steakLine).toBeTruthy();
    expect(tomatoLine!).toContain("[degraded:");
    expect(pastaLine!).toContain("[degraded:");
    expect(steakLine!).toContain("[degraded:");

    // Cached items show 'used_cache' and freshness label
    expect(tomatoLine!).toContain("used_cache");
    // TOMATO cache is seeded ~12h old at module init; with system time = 0, it will display "12h 0m old"
    expect(tomatoLine!).toMatch(/12h .*old/);

    expect(pastaLine!).toContain("used_cache");
    // PASTA cache is seeded ~30m old at module init
    expect(pastaLine!).toMatch(/30m old/);

    // Non-cached SKU should fall back to baseline estimate
    expect(steakLine!).toContain("used_baseline");

    // Allergens: degraded with local tags + LLM union
    const allergenLine = logs.find(l => l.trim().startsWith("- Bolognese:"));
    expect(allergenLine).toBeTruthy();
    expect(allergenLine!).toContain("[degraded:");
    expect(allergenLine!).toContain("allergen_fallback_local_tags");
    expect(allergenLine!).toContain("allergen_fallback_llm");

    // Metrics should include breaker openings for supplier regions and allergen tool
    const breakerChanges = logs.filter(l => l.includes("[metric] breaker_state_change"));
    expect(breakerChanges.some(l => l.includes('"supplier_us-east"') && l.includes('"open"'))).toBe(true);
    expect(breakerChanges.some(l => l.includes('"supplier_us-west"') && l.includes('"open"'))).toBe(true);
    expect(breakerChanges.some(l => l.includes('"allergen"') && l.includes('"open"'))).toBe(true);

    // Supplier fallbacks metrics should appear
    expect(logs.some(l => l.includes("[metric] supplier_fallback_cache"))).toBe(true);
    expect(logs.some(l => l.includes("[metric] supplier_fallback_baseline"))).toBe(true);

    // Final prep_plan metric reflects degradation in both price and allergens
    const prepPlanMetric = logs.find(l => l.startsWith("[metric] prep_plan"));
    expect(prepPlanMetric).toBeTruthy();
    expect(prepPlanMetric!).toContain('"price_degraded":true');
    expect(prepPlanMetric!).toContain('"allergen_degraded":true');

    // Ensure the test didn't trigger a fatal exit
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Fatal error:"));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});