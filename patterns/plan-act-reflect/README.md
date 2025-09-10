# Plan–Act–Reflect

Plan–Act–Reflect is an iterative agent pattern that cycles through planning, execution, and reflection to improve reliability on complex tasks. The agent proposes a plan, performs the next action(s), evaluates outcomes against goals and constraints, and then revises the plan. This loop continues until the objective is met or a termination condition is reached. The pattern emphasizes explicit control flow, stateful progress, and systematic self-correction.

## When and why to use it

Use Plan–Act–Reflect when a single-shot response is likely to fail or drift, and when tasks benefit from incremental progress with feedback. The pattern is especially effective for tool-using agents, multi-step workflows, and problems where intermediate results can be validated or critiqued.

It is not appropriate for trivial or latency-critical tasks where iteration overhead is unacceptable, or when no verifiable signals exist to inform reflection.

- Suitable conditions:
  - Ambiguous or evolving requirements
  - Multi-step problems with dependencies
  - Access to tools, APIs, or external data
  - Tasks with objective checks (tests, validators, policies)
- Avoid when:
  - A direct prompt reliably yields correct outputs
  - Hard real-time constraints dominate
  - No feedback or validation is available

## Key benefits and tradeoffs

This pattern raises success rates by turning a brittle, one-shot interaction into a controlled loop with checkpoints. Reflection exposes errors early, and replanning reduces compounding mistakes. Explicit state and instrumentation also make behavior auditable.

The tradeoff is additional complexity and cost. Each loop adds latency, token usage, and code surface area. Reflection quality depends on the signals provided; poor or noisy feedback can cause unnecessary loops or incorrect revisions.

- Benefits:
  - Higher reliability via iterative correction
  - Transparent progress through explicit state and logs
  - Better tool use through targeted, validated actions
  - Robustness to nondeterminism and API flakiness
  - Natural hooks for safety, policies, and tests
- Tradeoffs:
  - More latency and token cost per task
  - Additional code for state, evaluators, and tooling
  - Risk of infinite or unproductive loops without budgets
  - Reflection can overfit to noisy signals or hallucinate causes
  - Context-window pressure from growing histories

## How the pattern works

The loop maintains a task state (goals, plan, history, and constraints), executes a step, gathers observations and outcomes, and then critiques both the plan and the results. A revised plan emerges from the critique, and the loop continues. Termination can be goal completion, budget/time limits, or failure conditions.

The core is not “thinking more,” but “thinking with structure.” A good implementation keeps actions small and verifiable, reflections grounded in concrete signals, and plans flexible but bounded.

- Core components:
  - Planner: proposes next steps given goals, constraints, and history
  - Actor: performs a bounded action against tools or the environment
  - Reflector: evaluates outcomes and plan quality using signals
  - State: objective, plan, action history, artifacts, budgets, and metrics
  - Termination: success criteria, max iterations, cost/time budgets, fallback

## Minimal pseudo-code

Keep code minimal. The key is explicit state, disciplined iteration, and clear termination.

```pseudo
state = {
  objective,
  constraints,
  plan = initial_plan(objective),
  history = [],
  budget = { iterations: N, tokens: T, wall_clock: S }
}

while not done(state):
  step = plan.next_step()
  result = act(step, tools)
  feedback = evaluate(result, objective, constraints)  // tests, policies, scores

  critique = reflect({ step, result, feedback, plan, history })
  plan = replan(plan, critique, objective, constraints)

  state.history.append({ step, result, feedback })
  update_budget(state, result)

  if success(feedback) or exhausted(state.budget):
    break

return summarize(state)
```

## Example use cases

In practice, Plan–Act–Reflect shines wherever intermediate verification is possible. It helps agents stay aligned with goals, recover from partial failures, and adapt to new information without starting over.

- Code generation with tests:
  - Plan: outline modules and test cases; Act: generate code; Reflect: run tests and fix failures
- Research and synthesis:
  - Plan: search queries and sources; Act: fetch notes; Reflect: check coverage, resolve conflicts
- Data pipeline repair:
  - Plan: identify failing stages; Act: apply minimal fix; Reflect: run subset of checks; repeat
- Customer support triage:
  - Plan: gather logs and steps; Act: attempt remediations; Reflect: compare outcomes to runbooks
- SQL/data exploration:
  - Plan: form hypotheses; Act: run queries; Reflect: validate against constraints and metrics

## Implementation notes

Successful adoption hinges on reliable signals and tight control over actions. Build evaluators first, then wrap the agent around them. Treat reflection as a grounded critique, not free-form speculation. Keep actions small and idempotent to enable safe retries.

- State design:
  - Define a schema for objective, constraints/policies, current plan, action history, artifacts, and budgets
  - Separate “facts” (observations) from “opinions” (model assertions) to aid auditing
- Plans and steps:
  - Prefer short, verifiable steps over long monolithic ones
  - Include preconditions and expected postconditions per step
- Reflection quality:
  - Use concrete signals: tests, validators, schema checks, diffs, run-time errors, policy engines
  - Ask for structured critiques: issues, evidence, and proposed adjustments (bounded length)
- Tool safety:
  - Enforce dry-run modes, sandboxes, and explicit approvals for destructive actions
  - Validate inputs/outputs with schemas; auto-retry transient failures with backoff
- Loop control:
  - Impose iteration, cost, and time budgets; log reasons for continuation or stop
  - Detect stagnation (no plan change, repeated errors) and trigger fallback or escalation
- Context management:
  - Summarize history; store full traces externally; retrieve only relevant chunks
  - Cache successful sub-results to avoid repeated work
- Multi-model vs. single-model:
  - Optionally separate planner, actor, and reflector roles (different prompts or models)
  - Keep interfaces stable: plan(step_spec) -> step; reflect(trace) -> critique; replan(plan, critique) -> plan
- Observability and testing:
  - Log every step, observation, critique, and decision with timestamps and IDs
  - Unit-test evaluators; run end-to-end tests with seeded scenarios and budgets
- Production readiness:
  - Add guardrails for policy compliance and PII handling
  - Provide circuit breakers and clear failure modes (summaries, partial outputs, next actions)

## Key benefits recap

Plan–Act–Reflect improves reliability by turning ambiguous problems into controlled, verifiable progress. It enables tool-using agents to make measurable steps, learn from outcomes, and adapt plans without losing sight of the objective. The pattern adds cost and complexity, but pays for itself when correctness, auditability, and safety matter.