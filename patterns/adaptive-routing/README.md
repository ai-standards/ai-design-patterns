# Adaptive Model Routing

Adaptive Model Routing is the Strategy pattern applied to AI systems: given an input and context, the system selects the most appropriate model or tool at runtime. Instead of committing to a single model or fixed pipeline, a router evaluates options—such as a fast small model, a high-accuracy large model, a retrieval tool, or a deterministic function—and chooses the best candidate under current constraints. This pattern reduces cost and latency on easy tasks while preserving quality on hard ones, and it enables sophisticated orchestration across heterogeneous capabilities.

---

## When and why to use it

Use Adaptive Model Routing when inputs vary widely in difficulty, constraints change per request (e.g., latency or cost budgets), or multiple tools/models have complementary strengths. The pattern is especially valuable when the “best” model depends on content features, user-criticality, regulatory needs, or real-time system load. It also helps phase in new models safely by routing only some traffic initially and ramping up as confidence grows.

- Inputs exhibit a long tail of complexity: many easy cases, fewer hard cases.
- Strict SLAs require balancing latency, cost, and accuracy per request.
- Toolchains combine LLMs with retrieval, structured programs, or external APIs.
- Gradual deployment and rollback of models are needed without service disruption.

---

## Key benefits and tradeoffs

Adaptive Model Routing offers clear operational and product benefits, but it introduces architectural complexity and requires careful evaluation. A robust implementation makes routing decisions transparent and testable, not opaque or ad hoc.

- Benefits:
  - Cost and latency optimization by reserving expensive models for hard cases.
  - Quality gains through specialization (e.g., domain-tuned models for specific inputs).
  - Safer deployments via staged rollouts and traffic shaping.
  - Resilience with fallbacks when models fail or degrade.

- Tradeoffs:
  - Added complexity in decision logic, observability, and testing.
  - Potential inconsistency across similar requests if routing is noisy or unstable.
  - Overhead from feature extraction, extra prompts, or parallel probes.
  - Cold-start and drift risks if routing is learned and not regularly recalibrated.

---

## How it works

At a high level, a router inspects the request (and sometimes system state), selects a candidate model or tool, executes it, and optionally verifies or escalates based on confidence or policy. Decisions may be rule-based, learned, or hybrid, and are guided by budgets and guardrails.

- Core components:
  - Router: accepts the request, evaluates candidates, and makes the selection.
  - Candidates: models and tools with declared capabilities, costs, and constraints.
  - Policy: rules or learned scoring defining when to use each candidate.
  - Evaluators: confidence checks, toxicity/safety filters, schema validators.
  - Telemetry: decision logs, metrics, and traces for debugging and improvement.
  - Fallbacks: deterministic backups when routing or execution fails.

---

## Example use cases

Adaptive Model Routing supports a wide range of product patterns where “one size fits all” fails. It can route by difficulty, domain, compliance, or modality, and can reduce resource usage without sacrificing user experience.

- Customer support: route simple FAQ queries to retrieval + small model; escalate ambiguous or novel issues to a larger model or a human-in-the-loop.
- Code generation: start with a fast code model; escalate to a stronger model if tests fail or the task crosses complexity thresholds.
- Document QA: choose extraction via deterministic parsers for structured PDFs; use an LLM with tool-augmented retrieval for unstructured or OCR-required content.
- Multimodal tasks: send image-only classification to a vision model; use a multimodal LLM for open-ended analysis or when text context matters.
- Safety/compliance: apply stricter models or redaction tools when PII is detected or jurisdictional rules require specific handling.

---

## Routing strategies

Effective routing balances simplicity with adaptivity. Start with transparent heuristics, then incorporate learned policies and feedback loops as data accumulates. Keep the decision surface legible to operators.

- Static heuristics: content-length thresholds, keyword/domain detection, or “known safe” routes.
- Confidence-based escalation: attempt a cheap path; escalate if uncertainty or validation fails.
- Budget-aware selection: choose the best candidate that fits a per-request cost/latency budget.
- Multi-armed bandits: explore candidate options while optimizing long-term reward (quality/cost).
- Meta-evaluators: use a small model to predict difficulty, safety risk, or tool affinity.
- Speculative parallelism: run a cheap candidate first, cancel if a better one becomes necessary.

---

## Implementation notes

A production-ready router treats decisions as first-class artifacts: log them, test them, and evolve them intentionally. The following guidance focuses on stability, debuggability, and safety without overcomplicating early prototypes.

- Inputs and features:
  - Normalize prompts and extract lightweight features (length, language, domain, PII flags).
  - Track context: user tier, SLA, cost budget, compliance region, and model availability.
- Candidate registry:
  - Maintain a catalog with metadata (capabilities, cost, latency, token limits, modalities).
  - Record preconditions and postconditions (e.g., schema guarantees, safety filters).
- Decision policy:
  - Start with explicit rules; encode them in configuration to avoid hardcoding logic.
  - Add a learned scorer as a layer, not a replacement, and keep a “safe default” route.
- Fallbacks and retries:
  - Define deterministic fallbacks for outages and quota errors.
  - Use timeouts and circuit breakers; avoid cascading delays during escalations.
- Verification:
  - Validate outputs against schemas; apply safety classifiers; re-route on failure.
  - For high-stakes tasks, require a second pass or human review on low confidence.
- Observability:
  - Log the chosen candidate, alternatives considered, features used, and reasoning summary.
  - Aggregate metrics: route distribution, win rates, cost/latency per route, escalation rate.
- Governance:
  - Version routing policies; support canarying and rollbacks.
  - Periodically re-evaluate learned policies to mitigate data drift and bias.

---

## Minimal pseudo-code

Keep code minimal and declarative. Route selection should be inspectable and testable.

```pseudo
interface Candidate {
  name: string
  cost_estimate(req): float
  supports(req): bool
  run(req): Result
}

interface Policy {
  score(req, candidate): float   // higher is better, -inf to disallow
}

function route(req, candidates, policy, budget, timeout):
  feasible = [c for c in candidates if c.supports(req)]
  scored = sort_by_desc([(c, policy.score(req, c)) for c in feasible])
  for (c, s) in scored:
    if c.cost_estimate(req) <= budget and s > THRESHOLD:
      result = with_timeout(timeout, c.run(req))
      if validate(result): return result
  return fallback(req)  // safe default
```

A simple hybrid policy mixes rules, uncertainty, and budgets:

```pseudo
function policy.score(req, c):
  if requires_compliance(req) and not c.has_cert("X"): return -inf
  base = difficulty_model.predict(req)        // small classifier
  penalty = cost_weight * c.cost_estimate(req)
  bonus = domain_match(req, c) ? DOMAIN_BONUS : 0
  return base + bonus - penalty
```

---

## Testing and evaluation

Routing must be validated with the same rigor as model evaluation. Test the decision logic across representative datasets and ensure changes do not degrade user experience or violate SLAs.

- Offline: construct benchmarks with labeled difficulty, cost, and quality proxies; simulate budgets.
- Online: A/B test policy changes; monitor win rates and guardrail violations.
- Regression: snapshot routing decisions for fixed inputs; diffs must be explainable.
- Drift: watch feature distributions and recalibrate difficulty models as needed.

---

## Summary

Adaptive Model Routing operationalizes the Strategy pattern in AI systems, selecting the right model or tool for each request based on content, constraints, and policy. It improves performance and economics, supports safe rollouts, and increases robustness—at the cost of additional orchestration and evaluation. Start simple, make decisions observable, and evolve toward learned policies once reliable telemetry is in place.