# Taming 120 Pricing Agents with an Agent Factory

## Company & Problem
BrightCart is a mid-market e‑commerce aggregator selling across 18 countries and 6 verticals. Each category team built its own pricing bot: a “home-appliances pricer,” an “electronics pricer,” and so on. These bots pulled inventory, competitor feeds, and promo rules, then proposed price updates.

The approach worked—until it didn’t. Model upgrades broke tool bindings in two categories but not others. A rushed Black Friday tweak accidentally ignored MAP (minimum advertised price) rules in Canada. A/B tests were slow because every variant meant another hand-wired bot. On-call engineers spent nights debugging mismatched prompts and missing guardrails. Configuration drift was the silent killer: similar agents behaved differently, and no one knew why.

## Applying the Pattern
The team adopted the Agent Factory pattern to separate “what an agent is” from “how it runs.” Each pricing agent became a declarative recipe: persona and goals, tool access with scopes, memory policy, safety/data rules, and runtime preferences. The factory validated recipes, applied shared defaults (telemetry, timeouts, budgets), and materialized agents on demand for different runtimes.

This brought three wins:
- Consistency: MAP enforcement, PII redaction, and rate limits were attached at build time across all agents.
- Speed: Creating a category-specific agent for a region became a one-liner with a controlled override.
- Experimentation: A/B toggles switched models, prompts, or tool sets without code duplication, and every build carried provenance metadata for audit.

## Implementation Plan
- Define a recipe schema capturing: identity, instructions, tools + scopes, policies (MAP, GDPR, budgets), memory strategy, runtime adapter, and telemetry.
- Write a factory that:
  - Validates and normalizes recipes.
  - Binds tools with scoped credentials.
  - Compiles guardrails and prompt templates.
  - Emits build and run telemetry.
- Build thin adapters for the three runtimes in use (internal LLM, OpenAI, Vertex).
- Add a registry to version recipes and resolve by id (e.g., “pricing/electronics@2.1.0”).
- Integrate with CI to run golden prompt tests and policy evals per recipe.
- Roll out via canaries: 10% traffic per category, then ramp.

## Implementation Steps
Recipes moved to TypeScript for type safety and testability. A typical category recipe:

```ts
// pricing-recipes.ts
const electronicsV2_1: Recipe = {
  id: "pricing/electronics@2.1.0",
  instructions: "Propose price updates. Explain rationale. Never violate MAP.",
  model: { route: "default", name: "gpt-4o-mini", temperature: 0.1 },
  tools: [
    { name: "inventory.read", scopes: ["sku:read"] },
    { name: "competitors.read", scopes: ["price:read"] },
    { name: "promo.apply", scopes: ["promo:compute"] }
  ],
  policies: { mapFloor: true, piiRedaction: true, maxDeltaPct: 7, region: "US" },
  memory: { kind: "ephemeral", ttlSec: 600 },
  runtime: { adapter: "vertex", timeoutMs: 60000, retries: 1 },
  telemetry: { trace: true, sampleRate: 0.1 }
};
registry.register(electronicsV2_1);
```

Per-store instantiation became a controlled override with provenance logging:

```ts
// pricing-service.ts
function buildAgentForStore(store: StoreCtx) {
  const base = registry.resolve("pricing/electronics@2.1.0");
  const variant = experiments.chooseArm(store.id, "model-routing"); // "A" or "B"
  const overrides = variant === "B"
    ? { model: { route: "alt", name: "sonnet-3.5" }, policies: { maxDeltaPct: 5 } }
    : { policies: { region: store.region } };

  const agent = factory.build(base, overrides, { owner: store.id });
  return agent; // ready to .run({ sku, cost, competitorPrices })
}
```

The factory enforced guardrails before the agent accepted work. If a proposal dipped below MAP or exceeded maxDeltaPct, the guardrail returned a structured violation and the adapter aborted the tool write. Telemetry recorded build metadata: recipe id, diff of overrides, adapter, and policy hash. Debugging finally had ground truth.

## Outcome & Takeaways
Within two sprints, BrightCart shrank 120 hand-wired pricing bots into 9 recipes with small, auditable overrides. Black Friday went from a red-alert risk to a routine rollout: canaries ran A/B model routes with pinned recipes; rollback was one registry pointer change. MAP violations dropped to zero, and pricing updates per hour increased 3× thanks to pooled warm adapters.

Key lessons:
- Make the recipe schema strict early; it prevents policy leakage later.
- Keep adapters thin and boring; push variability into recipes and controlled overrides.
- Treat agent builds as artifacts: version, validate, and trace them like any other deploy.
- Bake experiments into the factory path so A/B changes inherit the same guardrails by default.