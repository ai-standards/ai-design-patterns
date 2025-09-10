"""
AI Design Pattern: Tool Fallbacks with Tiny Circuit Breakers (Python)
---------------------------------------------------------------------
This single file demonstrates a production-minded approach for calling flaky external tools.
It simulates a kitchen planning workflow where two tools are used:
  - Supplier Pricing API (per region)
  - Allergen Checker (third-party)

The pattern wraps each tool with a small circuit breaker and a clear fallback chain.
When external systems fail or run slow, the calls degrade in a controlled, explicit way
rather than timing out or returning partial data silently.

Key ideas implemented here:
- Per-tool, per-region circuit breakers with 'closed' | 'open' | 'probe' states.
- Trip conditions: timeouts, errors, invalid JSON (mocked), or p95 latency breach.
- Fallback chains:
    Supplier: regional mirror → SKU cache → baseline estimate.
    Allergens: third-party → local tags → model-only conservative check.
- Results annotated with is_degraded, reasons, and data freshness for UI visibility.
- Lightweight metrics emission showing durations, errors, breaker state, and fallback path.
- Recovery via "probe" attempts after cooldown to avoid flapping.

This code is self-contained and uses mock integrations so it runs offline.

requirements.txt:
# No external dependencies. Uses only Python standard library.
"""

from __future__ import annotations

import asyncio
import random
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple, TypeVar, Callable

# ------------------------------ Types & Utilities ------------------------------

Region = Literal["us-east", "us-west"]


@dataclass
class PriceResult:
    cents: int
    is_degraded: bool
    reasons: List[str]
    freshness: Optional[str] = None


@dataclass
class AllergenResult:
    items: List[str]
    is_degraded: bool
    reasons: List[str]


@dataclass
class Recipe:
    id: str
    name: str
    ingredients: List[str]  # simplified list of names
    allergen_tags: List[str]  # local tags curated internally (coarse)


# Simple metrics emitter — in real systems, ship to StatsD, Prometheus, etc.
def emit(metric: str, fields: Dict[str, Any]) -> None:
    # A single consolidated line is easy to grep in logs.
    print(f"[metric] {metric} {fields}")


# Small helper to compute p95 latency from a rolling window.
def p95(values: List[float]) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = min(len(sorted_vals) - 1, int(0.95 * (len(sorted_vals) - 1)))
    return sorted_vals[idx]


def now_ms_monotonic() -> float:
    return time.monotonic() * 1000.0


def now_ms_wall() -> float:
    return time.time() * 1000.0


# Guard to normalize caught errors to Exception with message.
def to_error(e: BaseException) -> Exception:
    return e if isinstance(e, Exception) else Exception(str(e))


T = TypeVar("T")


# Helper to enforce a timeout for a coroutine. On timeout, raises TimeoutError('timeout_<label>').
async def with_timeout(coro: "asyncio.Future[T] | asyncio.coroutines", ms: int, label: str) -> T:
    try:
        return await asyncio.wait_for(coro, timeout=ms / 1000.0)
    except asyncio.TimeoutError as _:
        raise TimeoutError(f"timeout_{label}")  # unified message for matching
    except Exception:
        raise


# ------------------------------ Circuit Breaker ------------------------------
class CircuitBreaker:
    """
    CircuitBreaker keeps a rolling window of outcomes (success/failure + duration) and enforces:
    - max failure rate threshold over last N samples
    - max p95 duration threshold over last N samples
    State machine:
      closed -> normal
      open   -> reject calls immediately; after cooldown, enter probe state
      probe  -> allow a single test call; success closes breaker, failure reopens and resets cooldown

    Design choices:
    - Tiny, per-tool breakers reduce blast radius. Each external tool gets its own instance.
    - A small sample (e.g., 40) reacts quickly without being too noisy.
    - Probe state avoids slamming a just-recovering dependency.
    Tradeoffs:
    - Small samples can be noisy; tune sample size and thresholds with real metrics.
    - For simplicity, this breaker is in-memory and not distributed; in multi-process setups,
      either shard by process or centralize breaker state.
    """

    def __init__(
        self,
        sample_size: int,
        max_fail_rate: float,  # e.g., 0.4 means trip if >= 40% failures
        cooldown_ms: int,
        max_p95_ms: int,  # e.g., 1200ms p95 -> trip if exceeded
        name: str,
    ) -> None:
        self._state: Literal["closed", "open", "probe"] = "closed"
        self._last_opened_at_ms: float = 0.0
        self._outcomes: List[Tuple[float, bool]] = []  # (ms, ok)
        self._sample_size = sample_size
        self._max_fail_rate = max_fail_rate
        self._cooldown_ms = float(cooldown_ms)
        self._max_p95_ms = float(max_p95_ms)
        self._name = name

    def state(self) -> Literal["closed", "open", "probe"]:
        return self._state

    def can_probe(self) -> bool:
        # Allow probe if currently open and cooldown elapsed
        if self._state != "open":
            return False
        now = now_ms_monotonic()
        return (now - self._last_opened_at_ms) >= self._cooldown_ms

    def enter_probe(self) -> None:
        if self.can_probe():
            self._state = "probe"
            emit("breaker_state_change", {"name": self._name, "state": self._state})

    def success(self, ms: float) -> None:
        self._push_outcome(ms, True)
        # On any success, if probing, close the breaker (consider circuit healthy).
        if self._state == "probe":
            self._state = "closed"
            emit("breaker_state_change", {"name": self._name, "state": self._state})
        self._evaluate()

    def failure(self, ms: float) -> None:
        self._push_outcome(ms, False)
        self._evaluate()

    def _push_outcome(self, ms: float, ok: bool) -> None:
        self._outcomes.append((ms, ok))
        if len(self._outcomes) > self._sample_size:
            self._outcomes.pop(0)

    def _evaluate(self) -> None:
        fails = sum(1 for (_ms, ok) in self._outcomes if not ok)
        fail_rate = (fails / len(self._outcomes)) if self._outcomes else 0.0
        p95_ms = p95([ms for (ms, _ok) in self._outcomes])
        emit(
            "breaker_rolling",
            {
                "name": self._name,
                "size": len(self._outcomes),
                "fail_rate": round(fail_rate, 2),
                "p95_ms": int(round(p95_ms)),
            },
        )
        if self._state != "open" and (fail_rate >= self._max_fail_rate or p95_ms >= self._max_p95_ms):
            self._state = "open"
            self._last_opened_at_ms = now_ms_monotonic()
            emit("breaker_state_change", {"name": self._name, "state": self._state})


# ------------------------------ Mock Integrations ------------------------------
# Supplier Pricing API (mock)
# - Randomly slows down, throttles (429), or fails (5xx).
# - Region matters; one region can be shakier than the other.
# - returns a { cents } price.
# The function simulates network variability and server behavior without external calls.
async def fetch_supplier_price(sku: str, region: Region) -> Dict[str, int]:
    # Shape region reliability: east is stable; west sometimes throttled.
    throttle_chance = 0.25 if region == "us-west" else 0.05
    fail_chance = 0.10 if region == "us-west" else 0.03

    # Random latency: 100–700ms, with long tail in west.
    base_delay_ms = 100.0 + random.random() * (900.0 if region == "us-west" else 600.0)
    await asyncio.sleep(base_delay_ms / 1000.0)

    # Random throttling or failure
    r = random.random()
    if r < throttle_chance:
        err = Exception("429_throttle")
        setattr(err, "status", 429)
        raise err
    if r < throttle_chance + fail_chance:
        err = Exception("502_bad_gateway")
        setattr(err, "status", 502)
        raise err

    # Return a price derived from SKU hash so it looks deterministic.
    hash_val = sum(ord(c) for c in sku)
    cents = 100 + (hash_val % 400)  # $1.00 to $5.00
    emit("supplier_call", {"region": region, "sku": sku, "duration_ms": int(base_delay_ms), "ok": True})
    return {"cents": int(cents)}


# Allergen Checker (mock)
# - Sometimes returns malformed JSON (simulated by throwing).
# - Sometimes slow (causing timeout).
# - Otherwise returns a plausible allergen list based on ingredients.
async def fetch_allergens(recipe_id: str, ingredients: List[str]) -> List[str]:
    delay_ms = 100.0 + random.random() * 700.0
    await asyncio.sleep(delay_ms / 1000.0)

    bad_json_chance = 0.2
    r = random.random()
    if r < bad_json_chance:
        # Simulate malformed JSON or schema mismatch.
        raise Exception("invalid_json_schema_change")

    allergens: List[str] = []
    text = " ".join(ingredients).lower()
    if re.search(r"(milk|cheese|butter|cream|yogurt|dairy)", text):
        allergens.append("dairy")
    if re.search(r"(wheat|flour|bread|pasta|gluten)", text):
        allergens.append("gluten")
    if re.search(r"(peanut|almond|walnut|nut)", text):
        allergens.append("nuts")
    if re.search(r"(soy|tofu|edamame)", text):
        allergens.append("soy")
    emit("allergen_call", {"recipeId": recipe_id, "duration_ms": int(delay_ms), "ok": True})
    return allergens


# Mock LLM completion for conservative allergen guess. Always returns a short, over-inclusive list.
async def llm_complete(prompt: str, *, max_tokens: int, temperature: float) -> str:
    # In practice, pass a small budget and deterministic settings to control latency and variability.
    await asyncio.sleep(0.08)  # tiny deterministic latency
    # Conservative response: if unsure, include it.
    return "gluten, dairy, nuts, soy"


# ------------------------------ Fallback Store & Estimation ------------------------------
# In-memory cache for last-known prices. In production, use Redis or a DB with TTLs.
# Each cache entry also stores a timestamp for freshness labeling in the UI.
price_cache: Dict[str, Dict[str, float | int]] = {}

# Seed a couple items as "previously seen" to demonstrate cache usage.
price_cache["SKU_TOMATO"] = {"cents": 199, "ts": now_ms_wall() - (1000.0 * 60 * 60 * 12)}  # 12h old
price_cache["SKU_PASTA"] = {"cents": 149, "ts": now_ms_wall() - (1000.0 * 60 * 30)}  # 30m old


def baseline_estimate_cents(sku: str) -> int:
    # A cheap, coarse baseline—e.g., wholesale price bands by category.
    if "STEAK" in sku:
        return 399  # $3.99 per unit
    if "FISH" in sku:
        return 349
    if "PASTA" in sku:
        return 149
    return 250  # generic


def freshness_label(ts_ms: float) -> str:
    age_ms = now_ms_wall() - ts_ms
    hours = int(age_ms // (1000.0 * 60 * 60))
    mins = int((age_ms % (1000.0 * 60 * 60)) // (1000.0 * 60))
    return f"{hours}h {mins}m old" if hours > 0 else f"{mins}m old"


# ------------------------------ Tool Wrappers with Fallbacks ------------------------------
class SupplierClient:
    """
    Supplier price wrapper with per-region breakers and clear fallback path:
      1) Primary region call
      2) Mirror region call
      3) Cache
      4) Baseline estimate
    It emits metrics and annotates degradation reasons and freshness.
    """

    def __init__(self) -> None:
        self._breakers: Dict[Region, CircuitBreaker] = {
            "us-east": CircuitBreaker(40, 0.4, 15_000, 1_200, "supplier_us-east"),
            "us-west": CircuitBreaker(40, 0.4, 15_000, 1_200, "supplier_us-west"),
        }

    async def _try_region(self, sku: str, region: Region) -> Tuple[int, float]:
        start = now_ms_monotonic()
        res = await fetch_supplier_price(sku, region)
        duration = now_ms_monotonic() - start
        return int(res["cents"]), duration

    async def get_price(self, sku: str, preferred: Region) -> PriceResult:
        primary: Region = preferred
        mirror: Region = "us-west" if preferred == "us-east" else "us-east"
        reasons: List[str] = []
        freshness: Optional[str] = None

        async def attempt(region: Region) -> Optional[PriceResult]:
            brk = self._breakers[region]
            # If open and not time to probe, skip to fallback.
            if brk.state() == "open" and not brk.can_probe():
                reasons.append("supplier_open")
                emit("supplier_skip_open", {"region": region, "sku": sku})
                return None
            if brk.can_probe():
                brk.enter_probe()

            try:
                cents, duration = await with_timeout(
                    self._try_region(sku, region), 900, f"supplier_{region}"
                )
                brk.success(duration)
                # Store in cache for resilience.
                price_cache[sku] = {"cents": cents, "ts": now_ms_wall()}
                emit(
                    "supplier_success",
                    {
                        "region": region,
                        "sku": sku,
                        "duration_ms": int(duration),
                        "breaker_state": brk.state(),
                    },
                )
                # reasons list is shared across attempts for transparency.
                return PriceResult(cents=cents, is_degraded=len(reasons) > 0, reasons=reasons, freshness=freshness)
            except BaseException as e:
                err = to_error(e)
                ms = 900.0  # simplified duration accounting
                brk.failure(ms)
                reasons.append(f"supplier_error_{region}")
                emit(
                    "supplier_error",
                    {"region": region, "sku": sku, "error": str(err), "breaker_state": brk.state()},
                )
                return None

        # 1) Primary region
        p1 = await attempt(primary)
        if p1 is not None:
            return p1

        # 2) Mirror region
        p2 = await attempt(mirror)
        if p2 is not None:
            p2.reasons.append("used_mirror")
            p2.is_degraded = True
            return p2

        # 3) Cache
        cached = price_cache.get(sku)
        if cached is not None:
            freshness = freshness_label(float(cached["ts"]))
            reasons.append("used_cache")
            emit("supplier_fallback_cache", {"sku": sku, "freshness": freshness})
            return PriceResult(cents=int(cached["cents"]), is_degraded=True, reasons=reasons, freshness=freshness)

        # 4) Baseline estimate
        cents = baseline_estimate_cents(sku)
        reasons.append("used_baseline")
        emit("supplier_fallback_baseline", {"sku": sku, "cents": cents})
        return PriceResult(cents=cents, is_degraded=True, reasons=reasons, freshness=freshness)


class AllergenClient:
    """
    Allergen wrapper with correctness-first fallbacks:
      1) Third-party call with timeout
      2) Local tags
      3) Conservative LLM pass (tight budget, over-inclusive)
    The result lists items and clearly marks degradation paths.
    """

    def __init__(self) -> None:
        self._breaker = CircuitBreaker(30, 0.35, 12_000, 1_000, "allergen")

    async def allergens_for(self, recipe: Recipe) -> AllergenResult:
        reasons: List[str] = []
        # Attempt primary tool unless breaker blocks it.
        if not (self._breaker.state() == "open" and not self._breaker.can_probe()):
            if self._breaker.can_probe():
                self._breaker.enter_probe()
            start = now_ms_monotonic()
            try:
                items = await with_timeout(
                    fetch_allergens(recipe.id, recipe.ingredients), 800, "allergen"
                )
                duration = now_ms_monotonic() - start
                self._breaker.success(duration)
                return AllergenResult(items=items, is_degraded=False, reasons=reasons)
            except BaseException as e:
                err = to_error(e)
                self._breaker.failure(800.0)
                reasons.append("allergen_timeout" if "timeout" in str(err).lower() else "allergen_invalid_json")
                emit(
                    "allergen_error",
                    {"recipeId": recipe.id, "error": str(err), "breaker_state": self._breaker.state()},
                )
        else:
            reasons.append("allergen_open")

        # Fallbacks: local tags + conservative LLM
        local = sorted(set(tag.lower() for tag in recipe.allergen_tags))
        reasons.append("allergen_fallback_local_tags")

        prompt = f"Given ingredients: {', '.join(recipe.ingredients)}\nReturn a short list of likely allergens. If unsure, include it."
        llm_raw = await llm_complete(prompt, max_tokens=80, temperature=0.0)
        llm_items = [s.strip().lower() for s in llm_raw.split(",") if s.strip()]
        reasons.append("allergen_fallback_llm")

        # Merge conservatively: union of local and LLM, dedupe.
        items = sorted(set(local).union(llm_items))
        return AllergenResult(items=items, is_degraded=True, reasons=reasons)


# ------------------------------ Example Usage: Building a Prep Plan ------------------------------
async def main() -> None:
    supplier = SupplierClient()
    allergens = AllergenClient()

    skus: List[Tuple[str, Region]] = [
        ("SKU_TOMATO", "us-east"),
        ("SKU_PASTA", "us-east"),
        ("SKU_STEAK", "us-west"),
    ]

    recipe = Recipe(
        id="RCP_BOLOGNESE",
        name="Bolognese",
        ingredients=["pasta", "tomato", "ground beef", "parmesan cheese", "butter"],
        allergen_tags=["dairy"],  # locally tagged; could be incomplete
    )

    # Parallelize tool calls to stay within end-to-end latency budget.
    t0 = now_ms_monotonic()
    price_task = asyncio.gather(*(supplier.get_price(sku, region) for sku, region in skus))
    allergen_task = asyncio.create_task(allergens.allergens_for(recipe))
    price_results, allergen_result = await asyncio.gather(price_task, allergen_task)
    duration = int(now_ms_monotonic() - t0)

    # Summarize degradation for UI hints.
    price_caveats = sorted(
        {reason for r in price_results for reason in r.reasons}
    )
    any_price_degraded = any(r.is_degraded for r in price_results)
    price_freshness_hints = ", ".join([r.freshness for r in price_results if r.freshness])

    # Output prep plan summary.
    print("\n=== Prep Plan Summary ===")
    print(f"Computed in {duration}ms")
    print("Prices:")
    for (sku, _region), r in zip(skus, price_results):
        degrade_suffix = ""
        if r.is_degraded:
            freshness_str = f", {r.freshness}" if r.freshness else ""
            degrade_suffix = f" [degraded: {'|'.join(r.reasons)}{freshness_str}]"
        print(f"  - {sku}: ${r.cents / 100:.2f}{degrade_suffix}")
    print("Allergens:")
    allergen_suffix = f" [degraded: {'|'.join(allergen_result.reasons)}]" if allergen_result.is_degraded else ""
    print(f"  - {recipe.name}: {', '.join(allergen_result.items)}{allergen_suffix}")

    # Emit high-level metrics for observability.
    emit(
        "prep_plan",
        {
            "duration_ms": duration,
            "price_degraded": any_price_degraded,
            "price_caveats": price_caveats,
            "price_freshness": price_freshness_hints or "fresh",
            "allergen_degraded": allergen_result.is_degraded,
        },
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as err:
        print(f"Fatal error: {err}", file=sys.stderr)
        sys.exit(1)