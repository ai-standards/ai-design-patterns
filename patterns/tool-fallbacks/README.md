# Tool Fallbacks

Detect tool failures and fall back gracefully. Tool Fallbacks applies the classic Circuit Breaker pattern to AI systems that rely on external tools (APIs, databases, vector stores, function calls). When a tool misbehaves—timeouts, errors, slowdowns, or degraded quality—the pattern isolates the failure and routes the request to a safe fallback path. Done well, this prevents cascading outages, preserves user trust, and keeps latency predictable under stress.

---

## Introduction

Modern AI applications often orchestrate multiple tools: search APIs, retrieval layers, code interpreters, payment gateways, and more. Each dependency can and will fail. Tool Fallbacks wraps these tool calls in a circuit breaker and defines one or more degraded modes that preserve useful behavior when the primary path is unavailable. The goal is not perfection under failure; the goal is useful, bounded, and explainable behavior.

The pattern emphasizes clear detection signals, fast failure, and explicit fallback paths, paired with observability so the system can recover automatically and operators can diagnose issues quickly.

- Core idea: “Prefer a good-enough answer now over a perfect answer never.”
- Scope: Per-tool, per-region, or per-tenant breakers; synchronous and asynchronous tasks.
- Outputs should be annotated as “degraded” to maintain transparency and aid downstream logic.

---

## When and Why to Use It

Any AI workflow that makes external calls should plan for failure. Tool Fallbacks is especially relevant when errors or timeouts would otherwise bubble up to users, when a partial or approximate answer is acceptable, or when SLOs require predictable latency.

Use this pattern when tool quality and availability are variable, the system must remain responsive during incidents, and users benefit from graceful degradation rather than hard errors.

- Applies to retrieval-augmented generation, tool-augmented agents, function calling, and multi-tool planners.
- Helps maintain UX during provider outages, quota throttling, schema changes, or slow downstream dependencies.
- Supports soft real-time use cases where deadlines matter more than completeness.

---

## Key Benefits and Tradeoffs

Tool Fallbacks improves resilience, but it introduces design choices. Expect to weigh accuracy, freshness, and explainability against availability and latency.

Benefits:
- Higher availability: Avoids cascading failures and preserves service continuity.
- Predictable latency: Fast failure and bounded work keep tail latencies under control.
- Better UX: Degraded-but-useful outputs beat error pages, especially with clear messaging.
- Operational insight: Metrics and breaker states surface systemic issues quickly.

Tradeoffs:
- Potential quality loss: Fallbacks may be less accurate or lack fresh data.
- Added complexity: Requires breaker state, policies, and monitoring.
- Risk of over-fallback: Aggressive breakers can mask recoveries or hide real problems.
- Consistency concerns: Different users may see different fallback paths during incidents; outputs must be labeled and auditable.

---

## Example Use Cases

Tool Fallbacks appears in many everyday AI systems. The common theme is a graceful pivot when primary tools fail.

- RAG search: If the vector store times out, fall back to cached results or a web search; as a last resort, answer from the model’s prior without citations.
- Function calling: If an external calculator API fails, use a local interpreter with tighter constraints.
- Data enrichment: If a CRM API throttles, fall back to a stale-but-reasonable cache and tag the result as approximate.
- Code generation: If static analysis is unavailable, generate code with stricter templates and disclaimers.
- Multi-provider routing: If provider A degrades, temporarily route to provider B with adjusted prompts and cost controls.

---

## Implementation Notes

A robust implementation starts with accurate failure detection and conservative recovery. Breakers should trip based on explicit signals and clear thresholds. Fallbacks must be intentional, limited in scope, and clearly labeled in outputs.

- Detection signals:
  - Transport failures: timeouts, connection errors, HTTP 5xx/429.
  - Semantic failures: invalid JSON, schema violations, empty or low-confidence results.
  - Latency budgets: exceed a per-call or end-to-end deadline.
- Breaker policy:
  - States: CLOSED → OPEN → HALF-OPEN with exponential backoff.
  - Trip thresholds: error rate over a moving window, consecutive failures, or p99 latency spikes.
  - Scope: per-tool, per-endpoint, per-tenant to avoid global outages from localized issues.
- Fallback design:
  - Order fallback strategies from most faithful to least (e.g., secondary tool → cache → model-only).
  - Annotate outputs: include is_degraded, source, freshness, and caveats.
  - Constrain the model in degraded modes (shorter context, stricter templates, fewer tool affordances).
- Observability:
  - Emit metrics and traces for tool_call_duration, error_rate, breaker_state, fallback_path, and degradation_rate.
  - Log structured failure reasons and sample inputs for diagnosis (mindful of privacy).
- Safety and correctness:
  - Validate contracts: schemas, units, and types on both primary and fallback paths.
  - Avoid silent hallucination: prompt the model to disclose when data may be incomplete.
  - Idempotency for retries; deduplicate to prevent side effects.
- Recovery:
  - Use HALF-OPEN probes with a small sample before fully closing the breaker.
  - Gradually ramp traffic back (e.g., 5% → 25% → 100%) to avoid flapping.

---

## Minimal Pseudo-Code

Keep code paths simple and explicit. The breaker should decide quickly; fallbacks should be short and bounded.

```pseudo
enum BreakerState { CLOSED, OPEN, HALF_OPEN }

breaker = CircuitBreaker(
  failure_threshold = 0.5,         // 50% failures in window
  min_requests      = 20,          // avoid tripping on tiny samples
  open_cooldown_ms  = 15000,
  half_open_probe_n = 5
)

function get_answer(query, deadline_ms):
  start = now()
  ctx = with_deadline(deadline_ms)

  if breaker.state() == OPEN and !breaker.can_probe():
    return fallback_chain(query, degraded_reason="breaker_open")

  try:
    result = with_timeout(ctx, 1200ms, call_primary_tool(query))
    validate(result) // schema / confidence / freshness
    breaker.record_success()
    return { answer: render(result), is_degraded: false }
  catch (err):
    breaker.record_failure(err)
    return fallback_chain(query, degraded_reason=classify(err))

function fallback_chain(query, degraded_reason):
  // 1) Secondary tool
  if available("secondary_tool"):
    try:
      r2 = with_timeout(ctx, 1000ms, call_secondary_tool(query))
      validate(r2)
      return { answer: render(r2), is_degraded: true, degraded_reason }
    catch (_) {}

  // 2) Cache
  cached = cache.get(query)
  if cached and fresh_enough(cached):
    return { answer: cached.value, is_degraded: true, degraded_reason }

  // 3) Model-only answer with constraints
  prompt = system("No tools available. Answer conservatively. Cite uncertainty.")
  text = llm.complete(prompt, user=query, max_tokens=200)
  return { answer: text, is_degraded: true, degraded_reason }
```

Notes:
- Deadline propagation ensures the fallback chain respects the user’s latency budget.
- validation() prevents garbage-in from masquerading as success.
- degraded_reason aids analytics and user messaging.

---

## Practical Tips

Tool Fallbacks works best when designed alongside product requirements and SLOs. The system should fail fast, degrade predictably, and recover smoothly.

- Define “good enough”: agree on acceptable degraded outputs per feature.
- Separate policy from mechanism: keep breaker logic generic; inject fallback strategies.
- Test with chaos: introduce synthetic timeouts, 5xx, and slowdowns to verify behavior.
- Communicate clearly: surface soft-degradation in UI or API responses when it matters.
- Keep prompts aware of mode: include a “degraded mode” system hint to reduce hallucinations.
- Avoid cascading fallbacks: cap the chain length and total work; prefer one or two strong alternatives.
- Protect costs: in degraded mode, reduce max_tokens, tighten temperature, and skip expensive tools.

---

## Summary

Tool Fallbacks brings proven resilience techniques to AI systems that depend on external tools. Detect failure early, trip a circuit breaker, and route to clear, bounded fallback paths. Annotate outputs, observe everything, and probe carefully to recover. The result is an application that behaves professionally under stress: fast, honest, and useful—even when dependencies do not cooperate.