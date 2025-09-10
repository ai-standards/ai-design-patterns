# ACV (Agent–Controller–View)

ACV is MVC reimagined for AI applications. It separates planning, execution, and user interface so each concern can be designed, tested, and evolved independently. The Agent plans and reasons about what to do, the Controller executes steps and manages operational concerns, and the View presents state and interactions to users or client systems. This separation brings clarity to systems that combine LLM reasoning, tool usage, and user interaction.

## Introduction

Modern AI applications do more than render data; they plan, call tools, iterate, and adapt. Mixing these behaviors inside a single “chat loop” quickly leads to brittle code and opaque behavior. ACV applies the spirit of MVC to AI by placing reasoning and planning in an Agent, delegating orchestration to a Controller, and isolating the UI in a View. The result is a system where prompts, workflows, tools, and interfaces can change without entangling each other.

- Agent: produces plans and decisions using prompts, instructions, memory, and context.
- Controller: executes plans, calls tools, handles retries, timeouts, and state.
- View: renders messages, progress, and results; captures user input or exposes an API.

## When and why to use ACV

ACV fits scenarios where an AI must perform multi-step work, call external tools, or maintain state across turns. It provides a clean surface to introduce safety checks, observability, and testing. Teams adopting ACV typically want a path to scale from a prototype chat loop to a reliable service without rewriting everything later.

- When a model must plan before acting (e.g., tool-using agents, workflows, copilots).
- When multiple UIs (web, CLI, API) should reuse the same planning and control logic.
- When testability, auditability, and debuggability are required for production.
- When evolving prompts and tools independently is important.

## Key benefits and tradeoffs

ACV brings the discipline of separation of concerns to AI systems. Reasoning logic (prompts, planning algorithms) can iterate quickly without destabilizing operational code. Controllers can be hardened with timeouts, budgets, and retries. Views stay lightweight and interchangeable. The tradeoff is added structure: more components and explicit contracts between them.

- Benefits:
  - Clear boundaries improve maintainability and collaboration across roles.
  - Better testability: mock tools at the Controller, fixture prompts in the Agent.
  - Stronger safety: centralized guardrails and human-in-the-loop in the Controller.
  - Portability: swap UIs without touching planning or execution code.
  - Observability: traceable steps, costs, and decisions.
- Tradeoffs:
  - More upfront design (plan/step schemas, state model).
  - Slight latency overhead from extra coordination.
  - Requires discipline to avoid leaking UI concerns into the Agent or Controller.
  - Prompt changes can affect planning interfaces if not versioned carefully.

## Example use cases

ACV works across interactive and non-interactive systems. Any setting where an LLM needs to think, act, and report benefits from this pattern. The following examples illustrate typical use.

- Copilot for developers: Agent plans diagnostics and fixes; Controller runs analyzers and applies patches; View streams diffs and asks for approval.
- Research assistant: Agent drafts a retrieval plan; Controller queries search and vector stores; View shows sources, interim notes, and final synthesis.
- Customer support triage: Agent classifies intent and needed actions; Controller fetches customer data and creates tickets; View surfaces status and escalations.
- Operations automations: Agent proposes a runbook; Controller executes Terraform/API calls with guardrails; View presents progress and approvals.

## Minimal architecture sketch

Design the Agent to produce explicit steps or a plan, not opaque free-form text. The Controller executes those steps against tools and tracks state, emitting events the View can render. Keep the View ignorant of prompts and tools; it should only consume structured state and events.

```pseudo
// Core types
type Goal        = { user_input, context }
type Step        = { kind: "think" | "tool" | "ask_user" | "finish", name?, args? }
type Plan        = { steps: Step[] }
type Obs         = { step_id, output, cost, error? }
type State       = { history: (Step|Obs)[], budget, vars }

// Agent: produce next step or plan from goal + state
function agent_decide(goal: Goal, state: State): Step {
  // prompt + reasoning -> structured Step
  return Step(...)
}

// Controller: orchestrate execution, tools, budgets, and errors
function run(goal: Goal): EventStream {
  state = init_state()
  while true:
    step = agent_decide(goal, state)
    emit(Event.StepPlanned(step))
    if step.kind == "tool":
      out = tools[step.name].call(step.args)
      state = record(state, Obs(...))
      emit(Event.ToolResult(out))
    else if step.kind == "ask_user":
      emit(Event.NeedUserInput(step))
      input = await view_input()
      state = record(state, Obs(...input...))
    else if step.kind == "finish":
      emit(Event.Completed(summary(state)))
      break
    enforce_budgets_and_timeouts(state)
}

// View: subscribe to events and render UI (or API responses)
subscribe(run(goal), (event) => render(event))
```

## Implementation notes

A solid ACV implementation defines clear contracts between components. The Agent should output machine-readable intentions (steps) with enough structure for the Controller to act deterministically. The Controller should be the single place for operational policy—timeouts, budgets, retries, tool sandboxing, and human approval. The View should treat the Controller as its data source, subscribing to a stream of events for progressive rendering.

- Planning and steps:
  - Prefer structured steps (JSON/DSL) over free-form text. Include tool name, args schema, and termination signal.
  - Consider a two-stage loop: “think” steps update internal rationale; “tool” steps produce side effects; “ask_user” steps pause.
  - Version prompts and step schemas to avoid breaking changes.
- State and memory:
  - Keep a canonical state (history, variables, budget) in the Controller.
  - Store observations with cost, latency, and tool provenance for audits.
  - Use summaries or embeddings to keep token usage bounded.
- Tooling and safety:
  - Define tool interfaces with schemas, idempotency notes, and side-effect policies.
  - Add guardrails: argument validation, dry-run, RBAC, PII redaction, rate limits.
  - Support human-in-the-loop for high-risk actions via “ask_user” steps.
- Reliability and control:
  - Enforce budgets (token, time, money) and max iterations to prevent runaway loops.
  - Implement retries with backoff for transient failures; escalate to the Agent for plan revisions on persistent errors.
  - Emit structured events for tracing (planned step, tool call start/stop, cost).
- View and UX:
  - Stream tokens and progress events separately: content vs. control signals.
  - Preserve a stable, typed event contract so multiple UIs can plug in.
  - Present sources, intermediate results, and approvals to build trust.
- Testing and evaluation:
  - Unit test the Controller with mocked tools and recorded transcripts.
  - Evaluate Agent prompts offline with fixed contexts; add golden tests for step structure.
  - Run end-to-end tests that simulate long conversations and failures.

## Key differences from classic MVC

ACV borrows MVC’s separation while adapting it to AI’s planning-and-acting loop. The “Model” of MVC is split: the Agent holds reasoning and planning, while the Controller owns execution, state, and policies. This split reflects that AI “models” generate behavior that must be mediated by explicit control logic for reliability and safety. The View remains focused on rendering and input, but now often deals with streams of partial results and progress events, not just final data.

- Agent ≠ data model: it is a planner/decider driven by prompts and context.
- Controller gains prominence: it mediates side effects, safety, and budgets.
- View consumes an event stream to support progressive UX and multiple clients.

## Why this pattern scales

ACV scales across teams and system size because it isolates areas of rapid iteration from areas that demand stability. Prompt and plan experimentation happens inside the Agent with minimal blast radius. Operational rigor lives in the Controller where SRE practices apply. UIs can evolve independently—new channels, different affordances—by subscribing to the same event contract. This makes ACV a practical foundation for prototypes that aim to become production systems.