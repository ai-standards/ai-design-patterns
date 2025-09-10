/**
 * Agent Factory Pattern — Pricing Agents Example (self-contained, runnable)
 *
 * This file demonstrates an Agent Factory that builds pricing agents from declarative recipes.
 * It includes: strong TypeScript types, a registry for versioned recipes, a factory that validates
 * and normalizes recipes, mock runtime adapters (internal, openai, vertex), guardrails for MAP
 * and delta limits, simple tool binding with scopes, and sampled telemetry.
 *
 * Run with: ts-node this-file.ts
 */

// --------------------------- Types: Schema, Runtime, and Results --------------------------- //

type ToolSpec = { name: string; scopes: string[] };
type ModelSpec = { route: "default" | "alt"; name: string; temperature: number };
type Policies = { mapFloor: boolean; piiRedaction: boolean; maxDeltaPct: number; region: string };
type Memory = { kind: "ephemeral" | "sticky"; ttlSec: number };
type Runtime = { adapter: "internal" | "openai" | "vertex"; timeoutMs: number; retries: number };
type TelemetryConfig = { trace: boolean; sampleRate: number };

type Recipe = {
  id: string;
  instructions: string;
  model: ModelSpec;
  tools: ToolSpec[];
  policies: Policies;
  memory: Memory;
  runtime: Runtime;
  telemetry: TelemetryConfig;
};

// DeepPartial for controlled overrides without losing structure; id is intentionally not optional downstream.
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// Input for a pricing decision; minimal but realistic. `map` is optional because some SKUs have no MAP.
type RunInput = {
  sku: string;
  cost: number;
  competitorPrices: number[];
  map?: number;
  region: string;
};

// Structured result for transparency and auditing.
type AgentResult =
  | { ok: true; price: number; rationale: string; metadata: Record<string, unknown> }
  | { ok: false; violation: string; metadata: Record<string, unknown> };

// --------------------------- Utilities: Merge, Telemetry, and Narrow Errors --------------------------- //

// Small, pure deep merge that respects arrays and primitives; used to apply controlled overrides.
// Tradeoff: avoids pulling a library, but only handles plain objects typical of config/recipes.
function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k in override) {
    const ov = (override as any)[k];
    const bv = (base as any)[k];
    if (ov === undefined) continue;
    out[k] =
      bv && typeof bv === "object" && !Array.isArray(bv) && typeof ov === "object" && !Array.isArray(ov)
        ? deepMerge(bv, ov)
        : ov;
  }
  return out;
}

// Simple, sampled telemetry. In production, send to a tracer; here, console logs with guardrails.
// Best practice: never log PII. This logger intentionally only logs config metadata and hashes.
function logTelemetry(enabled: boolean, sampleRate: number, event: string, data: Record<string, unknown>): void {
  if (!enabled) return;
  if (Math.random() > sampleRate) return;
  console.log(`[telemetry] ${event}`, JSON.stringify(data));
}

// Wrap unsafe code to narrow error surfaces to strings.
function safe<T>(fn: () => T, label: string): T {
  try {
    return fn();
  } catch (e) {
    const msg = e instanceof Error ? `${label}: ${e.message}` : `${label}: ${String(e)}`;
    throw new Error(msg);
  }
}

// --------------------------- Mock Tool Binding with Scoped Access --------------------------- //

type BoundTool = {
  name: string;
  scopes: string[];
  call: (input: RunInput) => Promise<unknown>;
};

// Binds declared tools to mock implementations using scoped credentials.
// Why mock? The example must run offline. Design keeps tools pluggable and testable.
function bindTools(recipe: Recipe): BoundTool[] {
  const hasScope = (tool: ToolSpec, needed: string) => tool.scopes.includes(needed);

  return recipe.tools.map((t) => {
    // Each tool returns a promise to mimic async behavior and match real-world call sites.
    if (t.name === "inventory.read") {
      return {
        name: t.name,
        scopes: t.scopes,
        call: async (input: RunInput) => {
          if (!hasScope(t, "sku:read")) throw new Error("inventory.read missing scope sku:read");
          // Pretend to fetch inventory details for the SKU; here we return a static structure.
          return { sku: input.sku, onHand: 42, cost: input.cost };
        },
      };
    }
    if (t.name === "competitors.read") {
      return {
        name: t.name,
        scopes: t.scopes,
        call: async (input: RunInput) => {
          if (!hasScope(t, "price:read")) throw new Error("competitors.read missing scope price:read");
          // Echo the competitor prices from the input as if a feed returned them.
          return { competitors: input.competitorPrices.slice().sort((a, b) => a - b) };
        },
      };
    }
    if (t.name === "promo.apply") {
      return {
        name: t.name,
        scopes: t.scopes,
        call: async (input: RunInput & { proposedPrice?: number }) => {
          if (!hasScope(t, "promo:compute")) throw new Error("promo.apply missing scope promo:compute");
          // Simulate a write-like operation constrained by guardrails. Here we only return a computation.
          const p = input.proposedPrice ?? input.cost;
          const discount = p > 100 ? 5 : 0; // trivial mock: high-price items get $5 off
          return { applied: true, finalPrice: Math.max(0, +(p - discount).toFixed(2)) };
        },
      };
    }
    // Default: unrecognized tool; keep agent strict by failing early.
    return { name: t.name, scopes: t.scopes, call: async () => ({ note: "unknown tool (mock)" }) };
  });
}

// --------------------------- Guardrails Compiler --------------------------- //

// Compiles policy guardrails into a closure applied at runtime.
// Design: purely functional; easy to unit test and reason about; no IO.
function compileGuardrails(policies: Policies) {
  const region = policies.region;
  const maxDeltaPct = Math.max(0, Math.min(policies.maxDeltaPct, 100));

  return (proposal: number, input: RunInput): { ok: boolean; violation?: string } => {
    // Enforce region alignment to catch subtle config drift (e.g., CA vs US MAP).
    if (input.region !== region) {
      return { ok: false, violation: `region-mismatch: recipe=${region} run=${input.region}` };
    }
    // Enforce MAP floor when enabled and a MAP is present for the SKU.
    if (policies.mapFloor && typeof input.map === "number" && proposal < input.map) {
      return { ok: false, violation: `map-floor: proposed=${proposal} < map=${input.map}` };
    }
    // Enforce max allowed change (relative to competitor median baseline used by strategy below).
    const baseline = median(input.competitorPrices);
    const deltaPct = ((baseline - proposal) / (baseline || 1)) * 100;
    if (Math.abs(deltaPct) > maxDeltaPct) {
      return { ok: false, violation: `delta-limit: |${deltaPct.toFixed(2)}|% > ${maxDeltaPct}%` };
    }
    return { ok: true };
  };
}

// --------------------------- Runtime Adapters (Mocked) --------------------------- //

// Adapters simulate different vendor quirks while sharing a stable interface.
// Tradeoff: keep adapters thin; push variability into recipes and guardrails.

type LLMOutput = { suggestion: number; rationale: string };

interface RuntimeAdapter {
  name: string;
  invoke(model: ModelSpec, prompt: string, timeoutMs: number, retries: number): Promise<LLMOutput>;
}

class InternalAdapter implements RuntimeAdapter {
  name: string = "internal";
  async invoke(model: ModelSpec, prompt: string, timeoutMs: number, retries: number): Promise<LLMOutput> {
    const temp = clamp(model.temperature, 0, 1);
    const base = extractBaseline(prompt);
    const suggestion = round2(base * (0.98 + temp * 0.01)); // gentle undercut
    return { suggestion, rationale: `internal:${model.name} undercut baseline with temp=${temp}` };
  }
}

class OpenAIAdapter implements RuntimeAdapter {
  name: string = "openai";
  async invoke(model: ModelSpec, prompt: string, timeoutMs: number, retries: number): Promise<LLMOutput> {
    const temp = clamp(model.temperature, 0, 1);
    const base = extractBaseline(prompt);
    const suggestion = round2(base * (0.97 + temp * 0.02)); // slightly more aggressive
    return { suggestion, rationale: `openai:${model.name} balance margin and competitiveness` };
  }
}

class VertexAdapter implements RuntimeAdapter {
  name: string = "vertex";
  async invoke(model: ModelSpec, prompt: string, timeoutMs: number, retries: number): Promise<LLMOutput> {
    const temp = clamp(model.temperature, 0, 1);
    const base = extractBaseline(prompt);
    const suggestion = round2(base * (0.99 - temp * 0.01)); // conservative
    return { suggestion, rationale: `vertex:${model.name} conservative pricing per enterprise defaults` };
  }
}

// Adapter resolution table; keeps adapters testable and swappable via DI in larger systems.
const ADAPTERS: Record<Runtime["adapter"], RuntimeAdapter> = {
  internal: new InternalAdapter(),
  openai: new OpenAIAdapter(),
  vertex: new VertexAdapter(),
};

// --------------------------- Agent Factory and Registry --------------------------- //

// Registry versions recipes and resolves them by id (e.g., "pricing/electronics@2.1.0").
// Design choice: immutable registration to ensure reproducible builds.
class RecipeRegistry {
  private store = new Map<string, Recipe>();
  register(recipe: Recipe): void {
    if (this.store.has(recipe.id)) throw new Error(`recipe already registered: ${recipe.id}`);
    // Early validation helps catch policy leakage and drift.
    validateRecipe(recipe);
    this.store.set(recipe.id, recipe);
  }
  resolve(id: string): Recipe {
    const r = this.store.get(id);
    if (!r) throw new Error(`recipe not found: ${id}`);
    return r;
  }
}

// Helper: strict recipe validation. Expand as needed for CI checks and golden tests.
function validateRecipe(recipe: Recipe): void {
  if (!recipe.id.includes("@")) throw new Error("recipe.id must include a version with @");
  if (!recipe.tools.length) throw new Error("recipe.tools must not be empty");
  if (recipe.memory.ttlSec <= 0) throw new Error("memory.ttlSec must be positive");
  if (recipe.runtime.timeoutMs <= 0) throw new Error("runtime.timeoutMs must be positive");
  if (recipe.telemetry.sampleRate < 0 || recipe.telemetry.sampleRate > 1) throw new Error("telemetry.sampleRate in [0,1]");
}

// Agent type: thin runtime that carries bound tools, guardrails, and adapter.
type Agent = {
  run: (input: RunInput) => Promise<AgentResult>;
  meta: { recipeId: string; policyHash: string; adapter: string; owner?: string; overrides?: string };
};

// Factory builds agents from recipes with optional controlled overrides.
// Responsibilities:
// - Validate and normalize recipes
// - Bind tools with scoped credentials
// - Compile guardrails and prompt templates
// - Emit build/run telemetry
class AgentFactory {
  build(base: Recipe, overrides?: DeepPartial<Recipe>, provenance?: { owner?: string }): Agent {
    const merged = overrides ? deepMerge(base, overrides) : base;
    // Keep id immutable; provenance tracks overrides without mutating published recipe id.
    merged.id = base.id;

    validateRecipe(merged);
    const tools = bindTools(merged);
    const guard = compileGuardrails(merged.policies);
    const adapter = ADAPTERS[merged.runtime.adapter];
    const policyHash = hash(JSON.stringify(merged.policies));
    const overridesDiff = overrides ? JSON.stringify(overrides) : undefined;

    logTelemetry(merged.telemetry.trace, merged.telemetry.sampleRate, "agent.build", {
      recipeId: merged.id,
      adapter: adapter.name,
      policyHash,
      overrides: overridesDiff ?? "none",
      owner: provenance?.owner ?? "n/a",
    });

    // The returned agent encloses validated config; run() is the stable entrypoint.
    return {
      meta: { recipeId: merged.id, policyHash, adapter: adapter.name, owner: provenance?.owner, overrides: overridesDiff },
      run: async (input: RunInput) => {
        // PII redaction simulation: do not log SKU if policy demands redaction (kept simple for the example).
        const safeSku = merged.policies.piiRedaction ? "<redacted>" : input.sku;

        // Tools: explicitly call read tools first to mimic data gathering steps found in real agents.
        const inventory = await safe(() => tools.find((t) => t.name === "inventory.read")!.call(input), "inventory.read");
        const competitors = await safe(() => tools.find((t) => t.name === "competitors.read")!.call(input), "competitors.read");

        // Compile a prompt template. In production, keep prompts versioned and diffable.
        const prompt = [
          merged.instructions,
          `Region=${input.region}, SKU=${safeSku}, Cost=${input.cost}`,
          `Competitors=${(competitors as any).competitors.join(",")}`,
          `Policy:maxDelta=${merged.policies.maxDeltaPct}% MAP=${merged.policies.mapFloor ? input.map ?? "n/a" : "off"}`,
        ].join("\n");

        const { suggestion, rationale } = await adapter.invoke(merged.model, prompt, merged.runtime.timeoutMs, merged.runtime.retries);

        const check = guard(suggestion, input);
        if (!check.ok) {
          // Abort any "write" tool on violation.
          logTelemetry(merged.telemetry.trace, merged.telemetry.sampleRate, "agent.violation", {
            recipeId: merged.id,
            violation: check.violation,
            suggestion,
          });
          return { ok: false, violation: check.violation!, metadata: { recipeId: merged.id, adapter: adapter.name } };
        }

        // If no violation, simulate applying promo logic as a finalization step.
        const applied = await safe(
          () => (tools.find((t) => t.name === "promo.apply")?.call({ ...input, proposedPrice: suggestion }) ?? Promise.resolve({ finalPrice: suggestion })),
          "promo.apply",
        );
        const finalPrice = +(applied as any).finalPrice;

        logTelemetry(merged.telemetry.trace, merged.telemetry.sampleRate, "agent.run", {
          recipeId: merged.id,
          finalPrice,
          adapter: adapter.name,
        });

        return {
          ok: true,
          price: finalPrice,
          rationale,
          metadata: { recipeId: merged.id, adapter: adapter.name, inventory, competitors },
        };
      },
    };
  }
}

// --------------------------- Example Usage: Registry, Factory, and a Run --------------------------- //

(function main() {
  // Registry isolates recipe definitions from runtime, enabling reproducible builds and audits.
  const registry = new RecipeRegistry();

  // A category recipe: strict and explicit to avoid policy leakage between agents.
  const electronicsV2_1: Recipe = {
    id: "pricing/electronics@2.1.0",
    instructions: "Propose price updates. Explain rationale. Never violate MAP.",
    model: { route: "default", name: "gpt-4o-mini", temperature: 0.1 },
    tools: [
      { name: "inventory.read", scopes: ["sku:read"] },
      { name: "competitors.read", scopes: ["price:read"] },
      { name: "promo.apply", scopes: ["promo:compute"] },
    ],
    policies: { mapFloor: true, piiRedaction: true, maxDeltaPct: 7, region: "US" },
    memory: { kind: "ephemeral", ttlSec: 600 },
    runtime: { adapter: "vertex", timeoutMs: 60000, retries: 1 },
    telemetry: { trace: true, sampleRate: 1.0 },
  };
  registry.register(electronicsV2_1);

  // Controlled override per store and experiment arm; provenance stays attached to the built agent.
  const factory = new AgentFactory();
  const base = registry.resolve("pricing/electronics@2.1.0");
  const variant = chooseArm("store-123", "model-routing"); // "A" or "B"
  const overrides = variant === "B"
    ? { model: { route: "alt", name: "sonnet-3.5" }, policies: { maxDeltaPct: 5 } }
    : { policies: { region: "US" as const } };
  const agent = factory.build(base, overrides, { owner: "store-123" });

  // Run a decision. The input includes competitor prices and an optional MAP.
  const input: RunInput = {
    sku: "ELEC-ACC-USB-CABLE-2M",
    cost: 7.5,
    competitorPrices: [12.99, 10.49, 11.25, 10.99],
    map: 9.99,
    region: "US",
  };

  agent.run(input).then((res) => {
    console.log("result:", res);
  });
})();

// --------------------------- Small Helpers (Math, Hash, Prompt Parsing, AB) --------------------------- //

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
// Minimal, stable, non-crypto hash for config fingerprints; adequate for telemetry and diffs.
function hash(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}
// Extract a numeric baseline from the prompt for adapter simulation. In real systems, pass structured context.
function extractBaseline(prompt: string): number {
  const match = prompt.match(/Competitors=([0-9\.,\-]+)/);
  if (!match) return 10;
  const nums = match[1].split(",").map((x) => parseFloat(x.trim())).filter((n) => Number.isFinite(n));
  return median(nums);
}
// Trivial A/B chooser; in production, use deterministic bucketing for consistency.
function chooseArm(id: string, _exp: string): "A" | "B" {
  return hash(id).charCodeAt(0) % 2 === 0 ? "A" : "B";
}