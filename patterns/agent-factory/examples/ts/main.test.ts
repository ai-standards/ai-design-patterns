import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

// Helper to import the SUT fresh for each test so the IIFE main() side-effect runs in a controlled environment.
// Important: spies (console, Math.random) must be set up before calling this.
async function loadSUT() {
  vi.resetModules();
  // Dynamic import ensures module-level side-effects run once per test.
  return await import("./main");
}

// Utility to find the first console.log call that starts with the given prefix.
function findConsoleCallByPrefix(spy: ReturnType<typeof vi.spyOn>, prefix: string) {
  return spy.mock.calls.find((call) => String(call[0]).startsWith(prefix));
}

describe("Agent Factory — Pricing Agents Example", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence console noise from the example's IIFE and telemetry; allow counting and inspection.
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Deterministic randomness for telemetry sampling tests.
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("runs the example main() on import and prints a 'result:' log with an AgentResult object", async () => {
    const SUT = await loadSUT();

    // The module's IIFE should have produced a 'result:' log, among telemetry lines.
    const resultCall = findConsoleCallByPrefix(consoleSpy, "result:");
    expect(resultCall, "expected a 'result:' log call from the example's main()").toBeDefined();

    // Validate the shape of the AgentResult object logged as the second argument.
    const agentResult = resultCall?.[1];
    expect(typeof agentResult).toBe("object");
    expect(agentResult).toHaveProperty("ok");
    expect(typeof agentResult.ok).toBe("boolean");

    // Ensure public API surface exists (sanity check).
    expect(typeof SUT.AgentFactory).toBe("function");
    expect(typeof SUT.RecipeRegistry).toBe("function");
    expect(typeof SUT.deepMerge).toBe("function");
    expect(typeof SUT.compileGuardrails).toBe("function");
    expect(typeof SUT.chooseArm).toBe("function");
  });

  it("RecipeRegistry: registers, validates, and resolves recipes; rejects duplicates and invalid configs", async () => {
    const SUT = await loadSUT();
    const registry = new SUT.RecipeRegistry();

    // Happy path: register a valid recipe and resolve it.
    const validRecipe = {
      id: "test/pricing@1.0.0",
      instructions: "Price it well",
      model: { route: "default", name: "unit-model", temperature: 0.2 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
        { name: "promo.apply", scopes: ["promo:compute"] },
      ],
      policies: { mapFloor: true, piiRedaction: false, maxDeltaPct: 10, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "internal", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1.0 },
    };
    registry.register(validRecipe as any);
    const resolved = registry.resolve("test/pricing@1.0.0");
    expect(resolved.id).toBe("test/pricing@1.0.0");

    // Duplicate registration should throw.
    expect(() => registry.register(validRecipe as any)).toThrow(/already registered/i);

    // Validation: id must include a version with @.
    const badId = SUT.deepMerge(validRecipe, { id: "missing-version" });
    expect(() => new SUT.RecipeRegistry().register(badId as any)).toThrow(/must include a version/i);

    // Validation: tools must not be empty.
    const noTools = SUT.deepMerge(validRecipe, { tools: [] });
    expect(() => new SUT.RecipeRegistry().register(noTools as any)).toThrow(/tools must not be empty/i);

    // Validation: memory.ttlSec must be positive.
    const badTtl = SUT.deepMerge(validRecipe, { memory: { ttlSec: 0 } });
    expect(() => new SUT.RecipeRegistry().register(badTtl as any)).toThrow(/ttlSec must be positive/i);

    // Validation: runtime.timeoutMs must be positive.
    const badTimeout = SUT.deepMerge(validRecipe, { runtime: { timeoutMs: 0 } });
    expect(() => new SUT.RecipeRegistry().register(badTimeout as any)).toThrow(/timeoutMs must be positive/i);

    // Validation: telemetry.sampleRate in [0,1].
    const badSampleLow = SUT.deepMerge(validRecipe, { telemetry: { sampleRate: -0.1 } });
    expect(() => new SUT.RecipeRegistry().register(badSampleLow as any)).toThrow(/sampleRate in \[0,1]/i);

    const badSampleHigh = SUT.deepMerge(validRecipe, { telemetry: { sampleRate: 1.1 } });
    expect(() => new SUT.RecipeRegistry().register(badSampleHigh as any)).toThrow(/sampleRate in \[0,1]/i);
  });

  it("deepMerge: merges nested objects and replaces arrays/primitives", async () => {
    await loadSUT().then(async (SUT) => {
      const base = { a: { b: 1, c: 2 }, arr: [1, 2, 3], x: 5 };
      const override = { a: { c: 42 }, arr: [9], x: 10 };
      const merged = SUT.deepMerge(base, override);
      // Nested object key preserved and overridden selectively
      expect(merged.a.b).toBe(1);
      expect(merged.a.c).toBe(42);
      // Array replaced (not concatenated or deep-merged)
      expect(merged.arr).toEqual([9]);
      // Primitive replaced
      expect(merged.x).toBe(10);
      // Base remains unchanged
      expect(base).toEqual({ a: { b: 1, c: 2 }, arr: [1, 2, 3], x: 5 });
    });
  });

  it("compileGuardrails: enforces region, MAP floor, and delta-limit boundaries", async () => {
    const SUT = await loadSUT();

    const policies = { mapFloor: true, piiRedaction: false, maxDeltaPct: 5, region: "US" };
    const guard = SUT.compileGuardrails(policies as any);

    // Region mismatch
    const regionCheck = guard(10, { sku: "X", cost: 5, competitorPrices: [10, 10, 10], region: "CA", map: 9.99 });
    expect(regionCheck.ok).toBe(false);
    expect(regionCheck.violation).toMatch(/region-mismatch/);

    // MAP floor violation: proposal below map
    const mapCheck = guard(9.5, { sku: "X", cost: 5, competitorPrices: [10, 10, 10], region: "US", map: 9.99 });
    expect(mapCheck.ok).toBe(false);
    expect(mapCheck.violation).toMatch(/map-floor/);

    // Delta-limit violation: proposal deviates more than allowed percent from competitor baseline
    const deltaCheck = guard(90, { sku: "X", cost: 50, competitorPrices: [100, 100, 100], region: "US" });
    expect(deltaCheck.ok).toBe(false);
    expect(deltaCheck.violation).toMatch(/delta-limit/);

    // Boundary case: exactly at delta threshold should be allowed
    const baseline = 100;
    const maxDeltaPct = 5;
    const proposalAtThreshold = baseline * (1 - maxDeltaPct / 100); // 95
    const boundaryCheck = guard(proposalAtThreshold, { sku: "X", cost: 50, competitorPrices: [baseline, baseline, baseline], region: "US" });
    expect(boundaryCheck.ok).toBe(true);
  });

  it("AgentFactory.build: returns an agent with immutable recipe id, and overrides cannot change it", async () => {
    const SUT = await loadSUT();

    const registry = new SUT.RecipeRegistry();
    const recipe = {
      id: "pricing/base@1.0.0",
      instructions: "Instructions",
      model: { route: "default", name: "model", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
      ],
      policies: { mapFloor: false, piiRedaction: false, maxDeltaPct: 10, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 120 },
      runtime: { adapter: "internal", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1 },
    };
    registry.register(recipe as any);

    const factory = new SUT.AgentFactory();
    const base = registry.resolve("pricing/base@1.0.0");

    const agent = factory.build(base, { id: "attempt/change@2.0.0" } as any, { owner: "store-xyz" });
    expect(agent.meta.recipeId).toBe("pricing/base@1.0.0");
    expect(agent.meta.owner).toBe("store-xyz");
  });

  it("Agent.run happy path: produces a price without promo tool and with promo tool reduces price by $5 when applicable", async () => {
    const SUT = await loadSUT();

    const registry = new SUT.RecipeRegistry();
    const baseRecipe = {
      id: "pricing/promos@1.0.0",
      instructions: "Price",
      model: { route: "default", name: "m", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
        // promo.apply will be added for the second agent
      ],
      policies: { mapFloor: false, piiRedaction: false, maxDeltaPct: 50, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "internal", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1.0 },
    };
    registry.register(baseRecipe as any);

    const factory = new SUT.AgentFactory();
    const base = registry.resolve("pricing/promos@1.0.0");

    // Agent A: no promo tool -> final price equals the suggestion.
    const agentNoPromo = factory.build(base);

    // Agent B: with promo tool -> final price discounted by $5 if > 100.
    const withPromo = SUT.deepMerge(base, { tools: [...base.tools, { name: "promo.apply", scopes: ["promo:compute"] }] });
    const agentWithPromo = factory.build(withPromo as any);

    // High baseline ensures proposal > 100; competitor prices set to a high median.
    const input = {
      sku: "SKU-1",
      cost: 50,
      competitorPrices: [200, 190, 210, 200],
      region: "US",
    };

    const resA = await agentNoPromo.run(input as any);
    const resB = await agentWithPromo.run(input as any);

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    // Promo agent should be exactly $5 cheaper than non-promo when price > 100.
    expect((resA as any).price - (resB as any).price).toBe(5);
  });

  it("Agent.run: returns violation for MAP floor and for delta-limit; also returns region-mismatch", async () => {
    const SUT = await loadSUT();

    const registry = new SUT.RecipeRegistry();
    const recipe = {
      id: "pricing/violations@1.0.0",
      instructions: "Price",
      model: { route: "default", name: "m", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
      ],
      policies: { mapFloor: true, piiRedaction: false, maxDeltaPct: 1, region: "US" }, // strict delta for later
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "openai", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1.0 },
    };
    registry.register(recipe as any);

    const factory = new SUT.AgentFactory();
    const base = registry.resolve("pricing/violations@1.0.0");

    // Case 1: MAP floor violation. Baseline 100, map 99; openai adapter undercuts baseline -> < 99.
    const agentMap = factory.build(base);
    const mapInput = { sku: "SKU-2", cost: 50, competitorPrices: [100, 100, 100], map: 99, region: "US" };
    const mapRes = await agentMap.run(mapInput as any);
    expect(mapRes.ok).toBe(false);
    expect((mapRes as any).violation).toMatch(/map-floor/);

    // Case 2: Delta-limit violation. Baseline 200, strict delta 1%.
    const agentDelta = factory.build(base);
    const deltaInput = { sku: "SKU-3", cost: 50, competitorPrices: [200, 200, 200], region: "US" };
    const deltaRes = await agentDelta.run(deltaInput as any);
    expect(deltaRes.ok).toBe(false);
    expect((deltaRes as any).violation).toMatch(/delta-limit/);

    // Case 3: Region mismatch.
    const agentRegion = factory.build(base);
    const regionInput = { sku: "SKU-4", cost: 50, competitorPrices: [100, 110, 120], region: "CA" };
    const regionRes = await agentRegion.run(regionInput as any);
    expect(regionRes.ok).toBe(false);
    expect((regionRes as any).violation).toMatch(/region-mismatch/);
  });

  it("Agent.run: labels tool errors via safe() and rejects the run with labeled error", async () => {
    const SUT = await loadSUT();

    const registry = new SUT.RecipeRegistry();
    // Configure inventory.read without the required "sku:read" scope to force a tool-level error.
    const recipe = {
      id: "pricing/tool-errors@1.0.0",
      instructions: "Price",
      model: { route: "default", name: "m", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: [] }, // missing scope -> should throw inside tool
        { name: "competitors.read", scopes: ["price:read"] },
      ],
      policies: { mapFloor: false, piiRedaction: false, maxDeltaPct: 50, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "internal", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1.0 },
    };
    registry.register(recipe as any);

    const factory = new SUT.AgentFactory();
    const agent = factory.build(registry.resolve("pricing/tool-errors@1.0.0"));

    const input = { sku: "SKU-ERR", cost: 10, competitorPrices: [10, 11, 9], region: "US" };

    // The run should reject with an error message labeled by safe() as "inventory.read: ..."
    await expect(agent.run(input as any)).rejects.toThrow(/inventory\.read:/);
  });

  it("Telemetry sampling: honors trace flag and sampleRate via Math.random; build and run emit logs only when sampled", async () => {
    const SUT = await loadSUT();

    // Clear initial logs generated by the IIFE.
    consoleSpy.mockClear();

    const registry = new SUT.RecipeRegistry();
    const recipe = {
      id: "pricing/telemetry@1.0.0",
      instructions: "Price",
      model: { route: "default", name: "m", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
      ],
      policies: { mapFloor: false, piiRedaction: false, maxDeltaPct: 50, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "vertex", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: true, sampleRate: 0.0 }, // never log when random > 0.0
    };
    registry.register(recipe as any);

    const factory = new SUT.AgentFactory();
    const base = registry.resolve("pricing/telemetry@1.0.0");

    // With sampleRate 0.0 and Math.random()=0.123, no telemetry logs should be emitted during build or run.
    const agent = factory.build(base);
    const input = { sku: "SKU-T", cost: 10, competitorPrices: [10, 11, 12], region: "US" };
    consoleSpy.mockClear();
    await agent.run(input as any);
    expect(consoleSpy.mock.calls.filter((c) => String(c[0]).startsWith("[telemetry]")).length).toBe(0);

    // Now, set sampleRate to 1.0 and Math.random()=0.0 to guarantee logging.
    const loggedRecipe = SUT.deepMerge(base, { telemetry: { sampleRate: 1.0 } });
    randomSpy.mockReturnValue(0.0);
    const agentLogged = factory.build(loggedRecipe as any);
    consoleSpy.mockClear();
    await agentLogged.run(input as any);
    const telemetryCalls = consoleSpy.mock.calls.filter((c) => String(c[0]).startsWith("[telemetry]"));
    expect(telemetryCalls.length).toBeGreaterThanOrEqual(2); // expect at least "agent.build" and "agent.run"
    // Verify event names appear in telemetry logs.
    const events = telemetryCalls.map((c) => String(c[0]));
    expect(events.some((e) => e.includes("agent.build"))).toBe(true);
    expect(events.some((e) => e.includes("agent.run")) || events.some((e) => e.includes("agent.violation"))).toBe(true);
  });

  it("chooseArm: deterministic per id and independent of Math.random", async () => {
    const SUT = await loadSUT();

    // Different random values should not affect the chosen arm.
    randomSpy.mockReturnValue(0.99);
    const arm1 = SUT.chooseArm("store-123", "model-routing");
    randomSpy.mockReturnValue(0.01);
    const arm2 = SUT.chooseArm("store-123", "model-routing");
    expect(arm1).toBe(arm2);

    // Different IDs likely produce a different (but deterministic) bucketing.
    const armA = SUT.chooseArm("store-A", "model-routing");
    const armB = SUT.chooseArm("store-B", "model-routing");
    // Not guaranteed to differ, but ensures values are one of "A" or "B" and deterministic.
    expect(["A", "B"]).toContain(armA);
    expect(["A", "B"]).toContain(armB);
    expect(SUT.chooseArm("store-A", "model-routing")).toBe(armA);
    expect(SUT.chooseArm("store-B", "model-routing")).toBe(armB);
  });

  it("AgentFactory + overrides: can switch adapters; MAP and delta policies interact as expected across scenarios", async () => {
    const SUT = await loadSUT();

    const registry = new SUT.RecipeRegistry();
    const baseRecipe = {
      id: "pricing/overrides@1.0.0",
      instructions: "Price",
      model: { route: "default", name: "m", temperature: 0.1 },
      tools: [
        { name: "inventory.read", scopes: ["sku:read"] },
        { name: "competitors.read", scopes: ["price:read"] },
        { name: "promo.apply", scopes: ["promo:compute"] },
      ],
      policies: { mapFloor: true, piiRedaction: true, maxDeltaPct: 10, region: "US" },
      memory: { kind: "ephemeral", ttlSec: 60 },
      runtime: { adapter: "vertex", timeoutMs: 1000, retries: 0 },
      telemetry: { trace: false, sampleRate: 1.0 },
    };
    registry.register(baseRecipe as any);

    const factory = new SUT.AgentFactory();
    const base = registry.resolve("pricing/overrides@1.0.0");

    // Use openai adapter to be slightly more aggressive; with MAP set just below baseline to trigger violation.
    const agentOpenAI = factory.build(base, { runtime: { adapter: "openai" } });
    const res1 = await agentOpenAI.run({
      sku: "SKU-OPENAI",
      cost: 20,
      competitorPrices: [100, 100, 100],
      map: 99.5,
      region: "US",
    } as any);
    expect(res1.ok).toBe(false);
    expect((res1 as any).violation).toMatch(/map-floor/);

    // Tighten delta policy to 1% to trigger delta-limit violation for a modest undercut.
    const agentDeltaTight = factory.build(base, { policies: { maxDeltaPct: 1 } });
    const res2 = await agentDeltaTight.run({
      sku: "SKU-DELTA",
      cost: 20,
      competitorPrices: [200, 200, 200],
      region: "US",
    } as any);
    expect(res2.ok).toBe(false);
    expect((res2 as any).violation).toMatch(/delta-limit/);

    // Relax MAP (no MAP provided) and ensure a successful run with vertex (more conservative).
    const agentVertex = factory.build(base, { runtime: { adapter: "vertex" } });
    const res3 = await agentVertex.run({
      sku: "SKU-OK",
      cost: 20,
      competitorPrices: [50, 48, 52],
      region: "US",
    } as any);
    expect(res3.ok).toBe(true);
    expect((res3 as any).price).toBeGreaterThan(0);
    // Rationale should indicate vertex adapter usage.
    expect((res3 as any).rationale).toMatch(/vertex:/);
  });
});