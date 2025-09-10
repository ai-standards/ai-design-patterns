/**
// AI Design Pattern: Tool Fallbacks with Tiny Circuit Breakers
// ------------------------------------------------------------
// This single file demonstrates a production-minded approach for calling flaky external tools.
// It simulates a kitchen planning workflow where two tools are used:
//   - Supplier Pricing API (per region)
//   - Allergen Checker (third-party)
//
// The pattern wraps each tool with a small circuit breaker and a clear fallback chain.
// When external systems fail or run slow, the calls degrade in a controlled, explicit way
// rather than timing out or returning partial data silently.
//
// Key ideas implemented here:
// - Per-tool, per-region circuit breakers with 'closed' | 'open' | 'probe' states.
// - Trip conditions: timeouts, HTTP-like errors, invalid JSON (mocked), or p95 latency breach.
// - Fallback chains:
//     Supplier: regional mirror → SKU cache → baseline estimate.
//     Allergens: third-party → local tags → model-only conservative check.
// - Results annotated with isDegraded, reasons, and data freshness for UI visibility.
// - Lightweight metrics emission showing durations, errors, breaker state, and fallback path.
// - Recovery via "probe" attempts after cooldown to avoid flapping.
//
// This code is self-contained and uses mock integrations so it runs offline.
// Run with: ts-node this-file.ts
*/

// ------------------------------ Types & Utilities ------------------------------

type Region = 'us-east' | 'us-west';

type Degradation = {
  isDegraded: boolean;
  reasons: string[]; // e.g., ['supplier_open', 'used_cache', 'allergen_fallback_llm']
  freshness?: string; // e.g., '12h old'
};

type PriceResult = {
  cents: number;
} & Degradation;

type AllergenResult = {
  items: string[];
} & Degradation;

type Recipe = {
  id: string;
  name: string;
  ingredients: string[]; // simplified list of names
  allergenTags: string[]; // local tags curated internally (coarse)
};

// Simple metrics emitter — in real systems, ship to StatsD, Prometheus, etc.
function emit(metric: string, fields: Record<string, unknown>): void {
  // A single consolidated line is easy to grep in logs.
  console.log(`[metric] ${metric} ${JSON.stringify(fields)}`);
}

// Small helper to compute p95 latency from a rolling window.
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return sorted[idx];
}

// Guard to narrow caught errors to Error with message.
function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

// Helper to enforce a timeout for a promise. On timeout, rejects with Error('timeout').
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout_${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ------------------------------ Circuit Breaker ------------------------------
/**
// CircuitBreaker keeps a rolling window of outcomes (success/failure + duration) and enforces:
// - max failure rate threshold over last N samples
// - max p95 duration threshold over last N samples
// State machine:
//   closed -> normal
//   open   -> reject calls immediately; after cooldown, enter probe state
//   probe  -> allow a single test call; success closes breaker, failure reopens and resets cooldown
//
// Design choices:
// - Tiny, per-tool breakers reduce blast radius. Each external tool gets its own instance.
// - A small sample (e.g., 40) reacts quickly without being too noisy.
// - Probe state avoids slamming a just-recovering dependency.
// Tradeoffs:
// - Small samples can be noisy; tune sample size and thresholds with real metrics.
// - For simplicity, this breaker is in-memory and not distributed; in multi-process setups,
//   either shard by process or centralize breaker state.
*/
class CircuitBreaker {
  private stateValue: 'closed' | 'open' | 'probe' = 'closed';
  private lastOpenedAt = 0;
  private outcomes: { ms: number; ok: boolean }[] = [];

  constructor(
    private readonly sampleSize: number,
    private readonly maxFailRate: number, // e.g., 0.4 means trip if >= 40% failures
    private readonly cooldownMs: number,
    private readonly maxP95Ms: number, // e.g., 1200ms p95 -> trip if exceeded
    private readonly name: string
  ) {}

  state(): 'closed' | 'open' | 'probe' {
    return this.stateValue;
  }

  canProbe(): boolean {
    // Allow probe if currently open and cooldown elapsed
    if (this.stateValue !== 'open') return false;
    const now = Date.now();
    return now - this.lastOpenedAt >= this.cooldownMs;
  }

  enterProbe(): void {
    if (this.canProbe()) {
      this.stateValue = 'probe';
      emit('breaker_state_change', { name: this.name, state: this.stateValue });
    }
  }

  success(ms: number): void {
    this.pushOutcome({ ok: true, ms });
    // On any success, if probing, close the breaker (consider circuit healthy).
    if (this.stateValue === 'probe') {
      this.stateValue = 'closed';
      emit('breaker_state_change', { name: this.name, state: this.stateValue });
    }
    this.evaluate();
  }

  failure(ms: number): void {
    this.pushOutcome({ ok: false, ms });
    this.evaluate();
  }

  private pushOutcome(o: { ms: number; ok: boolean }): void {
    this.outcomes.push(o);
    if (this.outcomes.length > this.sampleSize) this.outcomes.shift();
  }

  private evaluate(): void {
    const fails = this.outcomes.filter(o => !o.ok).length;
    const failRate = this.outcomes.length ? fails / this.outcomes.length : 0;
    const p95Ms = p95(this.outcomes.map(o => o.ms));
    emit('breaker_rolling', {
      name: this.name,
      size: this.outcomes.length,
      fail_rate: Number(failRate.toFixed(2)),
      p95_ms: Math.round(p95Ms),
    });
    if (
      this.stateValue !== 'open' &&
      (failRate >= this.maxFailRate || p95Ms >= this.maxP95Ms)
    ) {
      this.stateValue = 'open';
      this.lastOpenedAt = Date.now();
      emit('breaker_state_change', { name: this.name, state: this.stateValue });
    }
  }
}

// ------------------------------ Mock Integrations ------------------------------
/**
// Supplier Pricing API (mock)
// - Randomly slows down, throttles (429), or fails (5xx).
// - Region matters; one region can be shakier than the other.
// - returns a { cents } price.
// The function simulates network variability and server behavior without external calls.
*/
async function fetchSupplierPrice(sku: string, region: Region): Promise<{ cents: number }> {
  const start = Date.now();
  // Shape region reliability: east is stable; west sometimes throttled.
  const throttleChance = region === 'us-west' ? 0.25 : 0.05;
  const failChance = region === 'us-west' ? 0.1 : 0.03;

  // Random latency: 100–700ms, with long tail in west.
  const baseDelay = 100 + Math.random() * (region === 'us-west' ? 900 : 600);
  await new Promise(res => setTimeout(res, baseDelay));

  // Random throttling or failure
  const r = Math.random();
  if (r < throttleChance) {
    const err = new Error('429_throttle');
    (err as any).status = 429;
    throw err;
  }
  if (r < throttleChance + failChance) {
    const err = new Error('502_bad_gateway');
    (err as any).status = 502;
    throw err;
  }

  // Return a price derived from SKU hash so it looks deterministic.
  const hash = sku.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const cents = 100 + (hash % 400); // $1.00 to $5.00
  emit('supplier_call', {
    region,
    sku,
    duration_ms: Date.now() - start,
    ok: true,
  });
  return { cents };
}

/**
// Allergen Checker (mock)
// - Sometimes returns malformed JSON (simulated by throwing).
// - Sometimes slow (causing timeout).
// - Otherwise returns a plausible allergen list based on ingredients.
*/
async function fetchAllergens(recipeId: string, ingredients: string[]): Promise<string[]> {
  const start = Date.now();
  const delay = 100 + Math.random() * 700;
  await new Promise(res => setTimeout(res, delay));

  const badJsonChance = 0.2;
  const r = Math.random();
  if (r < badJsonChance) {
    // Simulate malformed JSON or schema mismatch.
    throw new Error('invalid_json_schema_change');
  }

  // Heuristic: simple matching to known allergens.
  const allergens: string[] = [];
  const text = ingredients.join(' ').toLowerCase();
  if (/(milk|cheese|butter|cream|yogurt|dairy)/.test(text)) allergens.push('dairy');
  if (/(wheat|flour|bread|pasta|gluten)/.test(text)) allergens.push('gluten');
  if (/(peanut|almond|walnut|nut)/.test(text)) allergens.push('nuts');
  if (/(soy|tofu|edamame)/.test(text)) allergens.push('soy');
  emit('allergen_call', { recipeId, duration_ms: Date.now() - start, ok: true });
  return allergens;
}

// Mock LLM completion for conservative allergen guess. Always returns a short, over-inclusive list.
async function llmComplete(prompt: string, opts: { maxTokens: number; temperature: number }): Promise<string> {
  // In practice, pass a small budget and deterministic settings to control latency and variability.
  await new Promise(res => setTimeout(res, 80)); // tiny deterministic latency
  // Conservative response: if unsure, include it.
  return 'gluten, dairy, nuts, soy';
}

// ------------------------------ Fallback Store & Estimation ------------------------------
/**
// In-memory cache for last-known prices. In production, use Redis or a DB with TTLs.
// Each cache entry also stores a timestamp for freshness labeling in the UI.
*/
const priceCache = new Map<string, { cents: number; ts: number }>();
// Seed a couple items as "previously seen" to demonstrate cache usage.
priceCache.set('SKU_TOMATO', { cents: 199, ts: Date.now() - 1000 * 60 * 60 * 12 }); // 12h old
priceCache.set('SKU_PASTA', { cents: 149, ts: Date.now() - 1000 * 60 * 30 }); // 30m old

function baselineEstimateCents(sku: string): number {
  // A cheap, coarse baseline—e.g., wholesale price bands by category.
  if (sku.includes('STEAK')) return 399; // $3.99 per unit
  if (sku.includes('FISH')) return 349;
  if (sku.includes('PASTA')) return 149;
  return 250; // generic
}

function freshnessLabel(ts: number): string {
  const ageMs = Date.now() - ts;
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  const mins = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${mins}m old` : `${mins}m old`;
}

// ------------------------------ Tool Wrappers with Fallbacks ------------------------------
/**
// Supplier price wrapper with per-region breakers and clear fallback path:
//   1) Primary region call
//   2) Mirror region call
//   3) Cache
//   4) Baseline estimate
// It emits metrics and annotates degradation reasons and freshness.
*/
function makeSupplierClient() {
  const breakers: Record<Region, CircuitBreaker> = {
    'us-east': new CircuitBreaker(40, 0.4, 15_000, 1_200, 'supplier_us-east'),
    'us-west': new CircuitBreaker(40, 0.4, 15_000, 1_200, 'supplier_us-west'),
  };

  async function tryRegion(sku: string, region: Region): Promise<{ cents: number; duration: number }> {
    const start = Date.now();
    const res = await fetchSupplierPrice(sku, region);
    return { cents: res.cents, duration: Date.now() - start };
  }

  return {
    async getPrice(sku: string, preferred: Region): Promise<PriceResult> {
      const primary = preferred;
      const mirror: Region = preferred === 'us-east' ? 'us-west' : 'us-east';
      const reasons: string[] = [];
      let freshness: string | undefined;

      const attempt = async (region: Region): Promise<PriceResult | undefined> => {
        const brk = breakers[region];
        // If open and not time to probe, skip to fallback.
        if (brk.state() === 'open' && !brk.canProbe()) {
          reasons.push('supplier_open');
          emit('supplier_skip_open', { region, sku });
          return undefined;
        }
        if (brk.canProbe()) brk.enterProbe();

        try {
          const { cents, duration } = await withTimeout(tryRegion(sku, region), 900, `supplier_${region}`);
          brk.success(duration);
          // Store in cache for resilience.
          priceCache.set(sku, { cents, ts: Date.now() });
          emit('supplier_success', { region, sku, duration_ms: duration, breaker_state: brk.state() });
          return { cents, isDegraded: reasons.length > 0, reasons, freshness };
        } catch (e) {
          const err = toError(e);
          const ms = /timeout/.test(err.message) ? 900 : 900; // simplified duration accounting
          breakers[region].failure(ms);
          reasons.push(`supplier_error_${region}`);
          emit('supplier_error', { region, sku, error: err.message, breaker_state: breakers[region].state() });
          return undefined;
        }
      };

      // 1) Primary region
      const p1 = await attempt(primary);
      if (p1) return p1;

      // 2) Mirror region
      const p2 = await attempt(mirror);
      if (p2) {
        p2.reasons.push('used_mirror');
        p2.isDegraded = true;
        return p2;
      }

      // 3) Cache
      const cached = priceCache.get(sku);
      if (cached) {
        freshness = freshnessLabel(cached.ts);
        reasons.push('used_cache');
        emit('supplier_fallback_cache', { sku, freshness });
        return { cents: cached.cents, isDegraded: true, reasons, freshness };
      }

      // 4) Baseline estimate
      const cents = baselineEstimateCents(sku);
      reasons.push('used_baseline');
      emit('supplier_fallback_baseline', { sku, cents });
      return { cents, isDegraded: true, reasons };
    },
  };
}

/**
// Allergen wrapper with correctness-first fallbacks:
//   1) Third-party call with timeout
//   2) Local tags
//   3) Conservative LLM pass (tight budget, over-inclusive)
// The result lists items and clearly marks degradation paths.
*/
function makeAllergenClient() {
  const breaker = new CircuitBreaker(30, 0.35, 12_000, 1_000, 'allergen');

  return {
    async allergensFor(recipe: Recipe): Promise<AllergenResult> {
      const reasons: string[] = [];
      // Attempt primary tool unless breaker blocks it.
      if (!(breaker.state() === 'open' && !breaker.canProbe())) {
        if (breaker.canProbe()) breaker.enterProbe();
        const start = Date.now();
        try {
          const items = await withTimeout(fetchAllergens(recipe.id, recipe.ingredients), 800, 'allergen');
          const duration = Date.now() - start;
          breaker.success(duration);
          return { items, isDegraded: false, reasons };
        } catch (e) {
          const err = toError(e);
          breaker.failure(800);
          reasons.push(/timeout/.test(err.message) ? 'allergen_timeout' : 'allergen_invalid_json');
          emit('allergen_error', { recipeId: recipe.id, error: err.message, breaker_state: breaker.state() });
        }
      } else {
        reasons.push('allergen_open');
      }

      // Fallbacks: local tags + conservative LLM
      const local = [...new Set(recipe.allergenTags)];
      reasons.push('allergen_fallback_local_tags');

      const prompt = `Given ingredients: ${recipe.ingredients.join(', ')}\nReturn a short list of likely allergens. If unsure, include it.`;
      const llmRaw = await llmComplete(prompt, { maxTokens: 80, temperature: 0 });
      const llmItems = llmRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      reasons.push('allergen_fallback_llm');

      // Merge conservatively: union of local and LLM, dedupe.
      const items = [...new Set([...local, ...llmItems])];
      return { items, isDegraded: true, reasons };
    },
  };
}

// ------------------------------ Example Usage: Building a Prep Plan ------------------------------
/**
// The demo assembles a minimal "prep plan" for a menu, fetching prices and allergens
// under a strict latency budget. It showcases fast failure, explicit fallbacks,
// and annotated results suitable for UI caveats.
//
// Notes on deadlines:
// - In a larger system, propagate a single request deadline to all sub-calls.
// - Each tool here has its own internal timeout, keeping p95 bounded even under stress.
*/
async function main(): Promise<void> {
  const supplier = makeSupplierClient();
  const allergens = makeAllergenClient();

  const skus: Array<{ sku: string; region: Region }> = [
    { sku: 'SKU_TOMATO', region: 'us-east' },
    { sku: 'SKU_PASTA', region: 'us-east' },
    { sku: 'SKU_STEAK', region: 'us-west' },
  ];

  const recipe: Recipe = {
    id: 'RCP_BOLOGNESE',
    name: 'Bolognese',
    ingredients: ['pasta', 'tomato', 'ground beef', 'parmesan cheese', 'butter'],
    allergenTags: ['dairy'], // locally tagged; could be incomplete
  };

  // Parallelize tool calls to stay within end-to-end latency budget.
  const t0 = Date.now();
  const [priceResults, allergenResult] = await Promise.all([
    Promise.all(skus.map(({ sku, region }) => supplier.getPrice(sku, region))),
    allergens.allergensFor(recipe),
  ]);
  const duration = Date.now() - t0;

  // Summarize degradation for UI hints.
  const priceCaveats = priceResults
    .flatMap(r => r.reasons)
    .filter((v, i, a) => a.indexOf(v) === i);
  const anyPriceDegraded = priceResults.some(r => r.isDegraded);
  const priceFreshnessHints = priceResults
    .map(r => r.freshness)
    .filter(Boolean)
    .join(', ');

  // Output prep plan summary.
  console.log('\n=== Prep Plan Summary ===');
  console.log(`Computed in ${duration}ms`);
  console.log('Prices:');
  for (let i = 0; i < skus.length; i++) {
    const { sku } = skus[i];
    const r = priceResults[i];
    console.log(`  - ${sku}: $${(r.cents / 100).toFixed(2)}${r.isDegraded ? ` [degraded: ${r.reasons.join('|')}${r.freshness ? `, ${r.freshness}` : ''}]` : ''}`);
  }
  console.log('Allergens:');
  console.log(`  - ${recipe.name}: ${allergenResult.items.join(', ')}${allergenResult.isDegraded ? ` [degraded: ${allergenResult.reasons.join('|')}]` : ''}`);

  // Emit high-level metrics for observability.
  emit('prep_plan', {
    duration_ms: duration,
    price_degraded: anyPriceDegraded,
    price_caveats: priceCaveats,
    price_freshness: priceFreshnessHints || 'fresh',
    allergen_degraded: allergenResult.isDegraded,
  });
}

// Kick off the demo.
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});