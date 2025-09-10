"""
Agent Factory Pattern — Pricing Agents Example (self-contained, runnable)

This Python module demonstrates an Agent Factory that builds pricing agents from declarative recipes.
It includes:
- Typed dataclasses for schema
- A registry for versioned recipes
- A factory that validates and merges controlled overrides
- Mock runtime adapters (internal, openai, vertex)
- Guardrails for MAP and delta limits
- Simple tool binding with scopes
- Sampled telemetry
- A runnable example

Run with: python agent_factory_pricing.py
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import math
import random
import re
from dataclasses import dataclass, asdict, is_dataclass
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    Generic,
    List,
    Literal,
    Mapping,
    MutableMapping,
    Optional,
    Tuple,
    Type,
    TypeVar,
    Union,
    get_args,
    get_origin,
    TypedDict,
)

# --------------------------- Types: Schema, Runtime, and Results --------------------------- #


@dataclass(frozen=True)
class ToolSpec:
    name: str
    scopes: List[str]


@dataclass(frozen=True)
class ModelSpec:
    route: Literal["default", "alt"]
    name: str
    temperature: float


@dataclass(frozen=True)
class Policies:
    map_floor: bool
    pii_redaction: bool
    max_delta_pct: float
    region: str


@dataclass(frozen=True)
class Memory:
    kind: Literal["ephemeral", "sticky"]
    ttl_sec: int


@dataclass(frozen=True)
class Runtime:
    adapter: Literal["internal", "openai", "vertex"]
    timeout_ms: int
    retries: int


@dataclass(frozen=True)
class TelemetryConfig:
    trace: bool
    sample_rate: float


@dataclass
class Recipe:
    id: str
    instructions: str
    model: ModelSpec
    tools: List[ToolSpec]
    policies: Policies
    memory: Memory
    runtime: Runtime
    telemetry: TelemetryConfig


@dataclass(frozen=True)
class RunInput:
    sku: str
    cost: float
    competitor_prices: List[float]
    map: Optional[float]
    region: str


class SuccessResult(TypedDict):
    ok: Literal[True]
    price: float
    rationale: str
    metadata: Dict[str, Any]


class ViolationResult(TypedDict):
    ok: Literal[False]
    violation: str
    metadata: Dict[str, Any]


AgentResult = Union[SuccessResult, ViolationResult]


# --------------------------- Utilities: Merge, Telemetry, and Narrow Errors --------------------------- #


def deep_merge_dict(base: Mapping[str, Any], override: Mapping[str, Any]) -> Dict[str, Any]:
    """
    A small, pure deep merge that respects arrays and primitives.
    - Recursively merges dicts
    - Replaces lists/primitives when an override is provided
    Suitable for config/recipes.
    """
    out: Dict[str, Any] = dict(base)
    for k, ov in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(ov, Mapping):
            out[k] = deep_merge_dict(out[k], ov)
        else:
            out[k] = ov
    return out


T = TypeVar("T")


def build_dataclass(cls: Type[T], data: Mapping[str, Any]) -> T:
    """
    Construct a dataclass instance of type cls from a nested mapping.
    Handles nested dataclasses and lists.
    """
    if not is_dataclass(cls):
        raise TypeError(f"build_dataclass expects a dataclass type, got {cls}")

    kwargs: Dict[str, Any] = {}
    for f in dataclasses.fields(cls):
        if f.name not in data:
            raise KeyError(f"missing required field '{f.name}' for {cls.__name__}")
        value = data[f.name]
        kwargs[f.name] = _coerce_field(f.type, value)
    return cls(**kwargs)  # type: ignore[arg-type]


def _coerce_field(ftype: Any, value: Any) -> Any:
    """
    Coerce value into the declared field type for nested dataclasses and lists.
    Literal/Union types are treated as their runtime values (no strict enforcement here).
    """
    # Dataclass type
    if isinstance(ftype, type) and is_dataclass(ftype):
        if not isinstance(value, Mapping):
            raise TypeError(f"expected mapping for {ftype}, got {type(value)}")
        return build_dataclass(ftype, value)

    origin = get_origin(ftype)
    args = get_args(ftype)

    # List[T]
    if origin in (list, List):
        elem_type = args[0] if args else Any
        if not isinstance(value, list):
            raise TypeError(f"expected list for {ftype}, got {type(value)}")
        return [_coerce_field(elem_type, v) for v in value]

    # Optional[T] or Union types: accept value as-is (simple coercion)
    if origin is Union:
        # If value is None and None is permitted, keep None
        if value is None and type(None) in args:
            return None
        # Try first non-None arg best-effort
        non_none_args = [a for a in args if a is not type(None)]  # noqa: E721
        if non_none_args:
            try:
                return _coerce_field(non_none_args[0], value)
            except Exception:
                pass
        return value

    # Primitive or unhandled typing constructs: return value as-is
    return value


def deep_merge_recipe(base: Recipe, override: Mapping[str, Any]) -> Recipe:
    """
    Merge overrides into a Recipe while preserving structure.
    Uses asdict -> deep merge -> rebuild dataclass for strong typing.
    """
    base_dict = asdict(base)
    merged_dict = deep_merge_dict(base_dict, override)
    return build_dataclass(Recipe, merged_dict)


def log_telemetry(enabled: bool, sample_rate: float, event: str, data: Dict[str, Any]) -> None:
    """
    Simple, sampled telemetry. In production, send to a tracer; here, log with guardrails.
    Best practice: never log PII. This logger intentionally only logs config metadata and hashes.
    """
    if not enabled:
        return
    if random.random() > sample_rate:
        return
    logging.info("[telemetry] %s %s", event, json.dumps(data, sort_keys=True))


U = TypeVar("U")


async def safe(fn: Callable[[], Awaitable[U]], label: str) -> U:
    """
    Wrap unsafe async code to narrow error surfaces to strings.
    """
    try:
        return await fn()
    except Exception as e:
        msg = f"{label}: {e}"
        raise RuntimeError(msg) from None


# --------------------------- Mock Tool Binding with Scoped Access --------------------------- #


@dataclass
class BoundTool:
    name: str
    scopes: List[str]
    call: Callable[[RunInput], Awaitable[Any]]


def bind_tools(recipe: Recipe) -> List[BoundTool]:
    """
    Binds declared tools to mock implementations using scoped credentials.
    Why mock? The example must run offline. Design keeps tools pluggable and testable.
    """
    def has_scope(tool: ToolSpec, needed: str) -> bool:
        return needed in tool.scopes

    tools: List[BoundTool] = []
    for t in recipe.tools:
        if t.name == "inventory.read":
            async def _call_inventory(input: RunInput, tool=t) -> Any:
                if not has_scope(tool, "sku:read"):
                    raise PermissionError("inventory.read missing scope sku:read")
                return {"sku": input.sku, "onHand": 42, "cost": input.cost}
            tools.append(BoundTool(name=t.name, scopes=t.scopes, call=_call_inventory))
            continue

        if t.name == "competitors.read":
            async def _call_competitors(input: RunInput, tool=t) -> Any:
                if not has_scope(tool, "price:read"):
                    raise PermissionError("competitors.read missing scope price:read")
                return {"competitors": sorted(list(input.competitor_prices))}
            tools.append(BoundTool(name=t.name, scopes=t.scopes, call=_call_competitors))
            continue

        if t.name == "promo.apply":
            async def _call_promo(input: RunInput, tool=t) -> Any:
                if not has_scope(tool, "promo:compute"):
                    raise PermissionError("promo.apply missing scope promo:compute")
                proposed = getattr(input, "proposed_price", None)
                p = proposed if isinstance(proposed, (int, float)) else input.cost
                discount = 5 if p > 100 else 0
                final_price = max(0.0, round2(p - discount))
                return {"applied": True, "finalPrice": final_price}
            tools.append(BoundTool(name=t.name, scopes=t.scopes, call=_call_promo))
            continue

        async def _call_unknown(_: RunInput, tool=t) -> Any:
            return {"note": "unknown tool (mock)"}
        tools.append(BoundTool(name=t.name, scopes=t.scopes, call=_call_unknown))
    return tools


# --------------------------- Guardrails Compiler --------------------------- #


def compile_guardrails(policies: Policies) -> Callable[[float, RunInput], Dict[str, Any]]:
    """
    Compiles policy guardrails into a closure applied at runtime.
    Design: purely functional; easy to unit test and reason about; no IO.
    """
    region = policies.region
    max_delta_pct = max(0.0, min(float(policies.max_delta_pct), 100.0))

    def guard(proposal: float, input: RunInput) -> Dict[str, Any]:
        if input.region != region:
            return {"ok": False, "violation": f"region-mismatch: recipe={region} run={input.region}"}

        if policies.map_floor and isinstance(input.map, (int, float)) and proposal < float(input.map):
            return {"ok": False, "violation": f"map-floor: proposed={proposal} < map={input.map}"}

        baseline = median(input.competitor_prices)
        denom = baseline if baseline != 0 else 1.0
        delta_pct = ((baseline - proposal) / denom) * 100.0
        if abs(delta_pct) > max_delta_pct:
            return {"ok": False, "violation": f"delta-limit: |{delta_pct:.2f}|% > {max_delta_pct}%"}
        return {"ok": True}

    return guard


# --------------------------- Runtime Adapters (Mocked) --------------------------- #


@dataclass(frozen=True)
class LLMOutput:
    suggestion: float
    rationale: str


class RuntimeAdapter:
    name: str

    async def invoke(self, model: ModelSpec, prompt: str, timeout_ms: int, retries: int) -> LLMOutput:
        raise NotImplementedError


class InternalAdapter(RuntimeAdapter):
    name = "internal"

    async def invoke(self, model: ModelSpec, prompt: str, timeout_ms: int, retries: int) -> LLMOutput:
        temp = clamp(model.temperature, 0.0, 1.0)
        base = extract_baseline(prompt)
        suggestion = round2(base * (0.98 + temp * 0.01))  # gentle undercut
        return LLMOutput(suggestion=suggestion, rationale=f"internal:{model.name} undercut baseline with temp={temp}")


class OpenAIAdapter(RuntimeAdapter):
    name = "openai"

    async def invoke(self, model: ModelSpec, prompt: str, timeout_ms: int, retries: int) -> LLMOutput:
        temp = clamp(model.temperature, 0.0, 1.0)
        base = extract_baseline(prompt)
        suggestion = round2(base * (0.97 + temp * 0.02))  # slightly more aggressive
        return LLMOutput(suggestion=suggestion, rationale=f"openai:{model.name} balance margin and competitiveness")


class VertexAdapter(RuntimeAdapter):
    name = "vertex"

    async def invoke(self, model: ModelSpec, prompt: str, timeout_ms: int, retries: int) -> LLMOutput:
        temp = clamp(model.temperature, 0.0, 1.0)
        base = extract_baseline(prompt)
        suggestion = round2(base * (0.99 - temp * 0.01))  # conservative
        return LLMOutput(suggestion=suggestion, rationale=f"vertex:{model.name} conservative pricing per enterprise defaults")


ADAPTERS: Dict[Runtime.adapter, RuntimeAdapter] = {
    "internal": InternalAdapter(),
    "openai": OpenAIAdapter(),
    "vertex": VertexAdapter(),
}


# --------------------------- Agent Factory and Registry --------------------------- #


class RecipeRegistry:
    """
    Registry versions recipes and resolves them by id (e.g., "pricing/electronics@2.1.0").
    Design choice: immutable registration to ensure reproducible builds.
    """

    def __init__(self) -> None:
        self._store: Dict[str, Recipe] = {}

    def register(self, recipe: Recipe) -> None:
        if recipe.id in self._store:
            raise ValueError(f"recipe already registered: {recipe.id}")
        validate_recipe(recipe)
        self._store[recipe.id] = recipe

    def resolve(self, id: str) -> Recipe:
        r = self._store.get(id)
        if r is None:
            raise KeyError(f"recipe not found: {id}")
        return r


def validate_recipe(recipe: Recipe) -> None:
    """
    Strict recipe validation. Expand as needed for CI checks and golden tests.
    """
    if "@" not in recipe.id:
        raise ValueError("recipe.id must include a version with @")
    if not recipe.tools:
        raise ValueError("recipe.tools must not be empty")
    if recipe.memory.ttl_sec <= 0:
        raise ValueError("memory.ttl_sec must be positive")
    if recipe.runtime.timeout_ms <= 0:
        raise ValueError("runtime.timeout_ms must be positive")
    if not (0.0 <= recipe.telemetry.sample_rate <= 1.0):
        raise ValueError("telemetry.sample_rate in [0,1]")


@dataclass
class AgentMeta:
    recipe_id: str
    policy_hash: str
    adapter: str
    owner: Optional[str] = None
    overrides: Optional[str] = None


class Agent:
    """
    Agent runtime that encloses bound tools, guardrails, and adapter.
    The run() method is the stable entrypoint.
    """

    def __init__(
        self,
        recipe: Recipe,
        bound_tools: List[BoundTool],
        guard: Callable[[float, RunInput], Dict[str, Any]],
        adapter: RuntimeAdapter,
        policy_hash: str,
        provenance_owner: Optional[str],
        overrides_diff: Optional[str],
    ) -> None:
        self._recipe = recipe
        self._tools_list = bound_tools
        self._tools: Dict[str, BoundTool] = {t.name: t for t in bound_tools}
        self._guard = guard
        self._adapter = adapter
        self.meta = AgentMeta(
            recipe_id=recipe.id,
            policy_hash=policy_hash,
            adapter=adapter.name,
            owner=provenance_owner,
            overrides=overrides_diff,
        )

    async def run(self, input: RunInput) -> AgentResult:
        # PII redaction simulation: do not log SKU if policy demands redaction (kept simple).
        safe_sku = "<redacted>" if self._recipe.policies.pii_redaction else input.sku

        inventory = await safe(lambda: self._tools["inventory.read"].call(input), "inventory.read")
        competitors = await safe(lambda: self._tools["competitors.read"].call(input), "competitors.read")

        # Prompt compilation. In production, keep prompts versioned and diffable.
        comp_list = ",".join(str(x) for x in competitors.get("competitors", []))
        prompt = "\n".join(
            [
                self._recipe.instructions,
                f"Region={input.region}, SKU={safe_sku}, Cost={input.cost}",
                f"Competitors={comp_list}",
                f"Policy:maxDelta={self._recipe.policies.max_delta_pct}% MAP={input.map if self._recipe.policies.map_floor else 'off'}",
            ]
        )

        llm_out = await self._adapter.invoke(
            self._recipe.model,
            prompt,
            self._recipe.runtime.timeout_ms,
            self._recipe.runtime.retries,
        )
        suggestion = llm_out.suggestion

        check = self._guard(suggestion, input)
        if not check.get("ok", False):
            log_telemetry(
                self._recipe.telemetry.trace,
                self._recipe.telemetry.sample_rate,
                "agent.violation",
                {"recipeId": self._recipe.id, "violation": check.get("violation"), "suggestion": suggestion},
            )
            return {
                "ok": False,
                "violation": str(check.get("violation")),
                "metadata": {"recipeId": self._recipe.id, "adapter": self._adapter.name},
            }

        async def apply_promo() -> Any:
            tool = self._tools.get("promo.apply")
            if tool is None:
                return {"finalPrice": suggestion}
            # Create a lightweight object with proposed_price attribute for the tool
            @dataclass(frozen=True)
            class _PromoInput(RunInput):
                proposed_price: float  # type: ignore[assignment]
            promo_input = _PromoInput(
                sku=input.sku,
                cost=input.cost,
                competitor_prices=input.competitor_prices,
                map=input.map,
                region=input.region,
                proposed_price=suggestion,
            )
            return await tool.call(promo_input)  # type: ignore[arg-type]

        applied = await safe(apply_promo, "promo.apply")
        final_price = float(applied.get("finalPrice", suggestion))

        log_telemetry(
            self._recipe.telemetry.trace,
            self._recipe.telemetry.sample_rate,
            "agent.run",
            {"recipeId": self._recipe.id, "finalPrice": final_price, "adapter": self._adapter.name},
        )

        return {
            "ok": True,
            "price": final_price,
            "rationale": llm_out.rationale,
            "metadata": {"recipeId": self._recipe.id, "adapter": self._adapter.name, "inventory": inventory, "competitors": competitors},
        }


class AgentFactory:
    """
    Factory builds agents from recipes with optional controlled overrides.
    Responsibilities:
    - Validate and normalize recipes
    - Bind tools with scoped credentials
    - Compile guardrails and prompt templates
    - Emit build/run telemetry
    """

    def build(
        self,
        base: Recipe,
        overrides: Optional[Mapping[str, Any]] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> Agent:
        merged = deep_merge_recipe(base, overrides or {})
        # Keep id immutable; provenance tracks overrides without mutating published recipe id.
        merged.id = base.id

        validate_recipe(merged)
        tools = bind_tools(merged)
        guard = compile_guardrails(merged.policies)
        adapter = ADAPTERS[merged.runtime.adapter]
        policy_hash = fnv1a_32(json.dumps(asdict(merged.policies), sort_keys=True))
        overrides_diff = json.dumps(overrides, sort_keys=True) if overrides else None

        log_telemetry(
            merged.telemetry.trace,
            merged.telemetry.sample_rate,
            "agent.build",
            {
                "recipeId": merged.id,
                "adapter": adapter.name,
                "policyHash": policy_hash,
                "overrides": overrides_diff or "none",
                "owner": provenance.get("owner") if provenance else "n/a",
            },
        )

        return Agent(
            merged,
            tools,
            guard,
            adapter,
            policy_hash,
            provenance_owner=(provenance or {}).get("owner"),
            overrides_diff=overrides_diff,
        )


# --------------------------- Example Usage: Registry, Factory, and a Run --------------------------- #


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    # Registry isolates recipe definitions from runtime, enabling reproducible builds and audits.
    registry = RecipeRegistry()

    # A category recipe: strict and explicit to avoid policy leakage between agents.
    electronics_v2_1 = Recipe(
        id="pricing/electronics@2.1.0",
        instructions="Propose price updates. Explain rationale. Never violate MAP.",
        model=ModelSpec(route="default", name="gpt-4o-mini", temperature=0.1),
        tools=[
            ToolSpec(name="inventory.read", scopes=["sku:read"]),
            ToolSpec(name="competitors.read", scopes=["price:read"]),
            ToolSpec(name="promo.apply", scopes=["promo:compute"]),
        ],
        policies=Policies(map_floor=True, pii_redaction=True, max_delta_pct=7, region="US"),
        memory=Memory(kind="ephemeral", ttl_sec=600),
        runtime=Runtime(adapter="vertex", timeout_ms=60_000, retries=1),
        telemetry=TelemetryConfig(trace=True, sample_rate=1.0),
    )
    registry.register(electronics_v2_1)

    # Controlled override per store and experiment arm; provenance stays attached to the built agent.
    factory = AgentFactory()
    base = registry.resolve("pricing/electronics@2.1.0")
    variant = choose_arm("store-123", "model-routing")  # "A" or "B"
    overrides: Dict[str, Any]
    if variant == "B":
        overrides = {"model": {"route": "alt", "name": "sonnet-3.5"}, "policies": {"max_delta_pct": 5}}
    else:
        overrides = {"policies": {"region": "US"}}
    agent = factory.build(base, overrides, {"owner": "store-123"})

    # Run a decision. The input includes competitor prices and an optional MAP.
    input_data = RunInput(
        sku="ELEC-ACC-USB-CABLE-2M",
        cost=7.5,
        competitor_prices=[12.99, 10.49, 11.25, 10.99],
        map=9.99,
        region="US",
    )

    async def _run() -> None:
        res = await agent.run(input_data)
        print("result:", json.dumps(res, indent=2, sort_keys=True, default=str))

    asyncio.run(_run())


# --------------------------- Small Helpers (Math, Hash, Prompt Parsing, AB) --------------------------- #


def clamp(n: float, a: float, b: float) -> float:
    return max(a, min(b, n))


def round2(n: float) -> float:
    return round(n * 100.0) / 100.0


def median(xs: List[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    mid = len(s) // 2
    if len(s) % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2.0
    return s[mid]


def fnv1a_32(s: str) -> str:
    """
    Minimal, stable, non-crypto hash for config fingerprints; adequate for telemetry and diffs.
    """
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"{h:08x}"


def extract_baseline(prompt: str) -> float:
    """
    Extract a numeric baseline from the prompt for adapter simulation.
    In real systems, pass structured context.
    """
    m = re.search(r"Competitors=([0-9\.,\-]+)", prompt)
    if not m:
        return 10.0
    nums = []
    for token in m.group(1).split(","):
        try:
            nums.append(float(token.strip()))
        except ValueError:
            pass
    return median(nums)


def choose_arm(id_str: str, _exp: str) -> Literal["A", "B"]:
    """
    Trivial A/B chooser; in production, use deterministic bucketing for consistency.
    """
    return "A" if ord(fnv1a_32(id_str)[0]) % 2 == 0 else "B"


if __name__ == "__main__":
    main()