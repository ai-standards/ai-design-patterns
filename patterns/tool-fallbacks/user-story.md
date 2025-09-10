# Serving Prep Plans When Suppliers Go Dark

## Company & Problem
PrepPilot builds kitchen planning software for multi-unit restaurants. Managers ask for plans like, “Prep for 120 covers tonight, keep average entree food cost under $4, flag allergens.” The system pulls recipe yields from an internal DB, gets current prices from a supplier API, and runs an allergen check via a third‑party service before producing a prep list with cost and risk callouts.

Weekend traffic exposed fragility. The supplier API throttled unpredictably and the allergen checker started returning malformed JSON after a schema change. Requests piled up, p95 latency doubled, and the assistant either timed out or returned partial data without caveats. Kitchens do not tolerate spinny wheels at 4pm.

## Applying the Pattern
Tool Fallbacks turned outages into controlled degradation. Each external call gained a small circuit breaker and a clear “Plan B”:

- Prices: if the supplier API failed or slowed, fall back to last‑known prices per SKU; if missing, estimate from a wholesale baseline.
- Allergens: if the checker errored or exceeded its budget, fall back to recipe‑level tags and a conservative model prompt (“assume presence if unsure”) with tight token limits.
- Every response carried a degraded flag and reasons, so the UI could display “Prices from cache (12h old)” or “Allergens require verification.”

Fast failure and explicit fallbacks kept prep plans usable and latency bounded.

## Implementation Plan
- Wrap supplier and allergen calls with per‑tool breakers (per region to avoid global trips).
- Trip on: timeouts, HTTP 5xx/429, invalid JSON, or p95 > 1.2s over a rolling window.
- Fallback order:
  - Supplier: regional mirror → SKU cache → baseline estimate.
  - Allergens: third‑party → local tags → model‑only conservative check.
- Annotate results with isDegraded, reasons, and data freshness.
- Emit metrics: call_duration_ms, error_rate, breaker_state, fallback_path.
- Recover with small probe traffic before fully closing breakers.

## Implementation Steps
Start with tiny breakers around each tool. The supplier wrapper below fails fast and prefers cached prices when the line looks shaky.

```ts
type State = 'closed' | 'open' | 'probe';
const breaker = makeBreaker({sample: 40, maxFailRate: 0.4, cooldownMs: 15000});

export async function getPrice(sku: string, abort: AbortSignal) {
  if (breaker.state() === 'open' && !breaker.canProbe()) {
    return { cents: cache.price(sku), degraded: ['supplier_open'] };
  }
  try {
    const res = await withTimeout(fetchSupplier(sku, abort), 900);
    assertValid(res); breaker.success();
    return { cents: res.cents, degraded: [] };
  } catch (err) {
    breaker.failure(err);
    const cents = cache.price(sku) ?? estimateBaseline(sku);
    return { cents, degraded: ['supplier_error'] };
  }
}
```

Next, structure the allergen checker to prioritize correctness over completeness. If the third‑party fails, combine local tags with a conservative LLM pass and label the result.

```ts
export async function allergensFor(recipe: Recipe, abort: AbortSignal) {
  try {
    const a = await withTimeout(fetchAllergens(recipe.id, abort), 800);
    validateJSON(a); return { items: a, degraded: [] };
  } catch {
    const local = recipe.allergenTags; // e.g., ['gluten','dairy']
    const prompt = `Given ingredients: ${recipe.ingredients.join(', ')}
Return a short list of likely allergens. If unsure, include it.`;
    const llm = await llmComplete(prompt, {maxTokens: 80, temperature: 0});
    const items = mergeConservative(local, parseList(llm));
    return { items, degraded: ['allergen_fallback'] };
  }
}
```

Finally, propagate deadlines so fallbacks respect the user’s latency budget, and surface degradation in the UI (“Prep plan ready — prices from cache, verify allergens for: sauces”).

## Outcome & Takeaways
- Availability: Error pages dropped from 7.3% to 0.6% during supplier incidents.
- Latency: p95 held under 1.9s even with third‑party outages (previously 3.8s).
- Trust: Kitchens received clear caveats; tickets blaming “bad data” disappeared.
- Operations: Breaker metrics pinpointed a regional throttle and a schema roll‑out; probes confirmed recovery without flapping.

Two lessons stood out. First, define “good enough” per tool in advance; fallbacks write themselves once the target is clear. Second, annotate everything. Honest, bounded degradation beats silent failure—and makes the system feel professional when partners misbehave.