# Guardrail Decorator

The Guardrail Decorator wraps AI model calls with critics, validators, and retry logic. Use it to enforce output quality, safety policies, structural guarantees, and graceful degradation—without tangling the core application logic with checks. The pattern attaches pre- and post-processing behavior around a generation call, so the model can be critiqued, its output validated, optionally repaired, and retried or routed to a fallback when needed.

## Introduction

Modern AI models are powerful but non-deterministic. Outputs may be off-policy, malformed, unsafe, or simply low quality. The Guardrail Decorator adds a protective layer around model calls. It evaluates responses with rule-based validators or model-based critics, triggers corrective actions (such as re-prompting or constrained decoding), and applies retries or fallbacks when necessary. The result is a predictable, testable interface despite stochastic internals.

This pattern is a thin, composable wrapper—think middleware—that can be added or removed without rewriting the underlying model invocation. It cleanly separates concerns: the application focuses on intent; the decorator focuses on safety, structure, and resilience.

## When and Why to Use It

Use the Guardrail Decorator when outputs must meet explicit requirements—schemas, safety rules, or domain constraints—and when reliability matters more than raw throughput. It is also appropriate when working with external tools that can fail, when latency variability must be capped, or when compliance obligations require traceable checks.

- Enforce structural guarantees for downstream systems that expect strict formats.
- Implement safety and policy gates (e.g., toxicity, PII, regulated content).
- Add automatic repair loops (e.g., re-prompting, function-calling, constrained decoding).
- Control reliability with retries, backoff, and fallbacks to cheaper or safer models.
- Centralize observability, metrics, and audit logs for model calls.

Avoid overusing the pattern for quick prototypes or exploration where the overhead of checks and retries slows iteration. For low-risk, human-in-the-loop workflows, lighter-weight checks may suffice.

## Key Benefits and Tradeoffs

The main benefit is reliability: the decorator transforms a best-effort model call into a contract-respecting interface. It also improves safety, observability, and maintainability by localizing policies and tests in one place.

- Benefits
  - Reliability and predictability through validation, repair, and retries.
  - Safety and compliance via moderation, PII checks, and policy critics.
  - Structural integrity with schema validation and constrained decoding.
  - Separation of concerns and easier testing of guardrails in isolation.
  - Observability with consistent logging, metrics, and traces around calls.
  - Portability across models and providers by abstracting the call site.

- Tradeoffs
  - Added latency and cost due to critics, validators, and extra generations.
  - Complexity in configuration, policy versioning, and failure handling.
  - Risk of false positives/negatives from model-based judges (“LLM as critic”).
  - Maintenance burden as policies evolve and models drift over time.
  - Potential UX issues if excessive retries delay responses.

## Example Use Cases

Most applications benefit from a few guardrails, but some scenarios practically require them. Any workflow that feeds model outputs into other systems should consider validation and repair.

- Structured outputs: validate JSON against a schema; auto-repair with re-prompting or constrained decoding.
- RAG with citation checks: ensure answers include sources; verify links resolve and contain claimed facts.
- Agents and tool use: verify tool inputs/outputs, sanitize parameters, and rollback on tool errors.
- Safety and privacy: moderate content, detect PII, and redact before logging or display.
- Code generation: compile, run unit tests, and retry with compiler feedback injected into the prompt.
- Translation and summarization: check length, style, or terminology constraints; apply back-translation critics.

## Implementation Notes

Implement the decorator as a higher-order function or middleware that wraps the model call. Keep the interface narrow: accept an input, return a result or a typed error. Treat critics and validators as pluggable modules with clear contracts. Handle retries with bounded budgets and exponential backoff. When possible, repair inputs or decoding constraints instead of repeatedly prompting the same way.

Plan how the decorator behaves with streaming results, tool calls, and parallel validators. Capture telemetry consistently—prompt hashes, decision reasons, retry counts—while redacting sensitive data. Decide whether to fail fast, fail closed (block unsafe outputs), or fail open (degrade to a safer fallback) per policy.

- Composition
  - Pre-validators (check input), critics (model- or rule-based review), post-validators (check output).
  - Repair strategies: re-prompt with feedback, function calling / tool invocation, constrained decoding, or template-level constraints.
  - Fallbacks: alternate model, rule-based response, cached answer, or human-in-the-loop.

- Reliability and performance
  - Timeouts and budgets: cap total time across retries; apply jittered backoff.
  - Idempotency: ensure retries do not duplicate side effects (tool calls, writes).
  - Parallel vs. sequential validators: run cheap checks first; short-circuit on failure.

- Safety and compliance
  - Prefer rule-based gates for hard policies; use model critics for nuance.
  - Log decisions and versions of policies; redact PII before storage.
  - Test for adversarial prompts and prompt-injection; validate tool arguments strictly.

- Determinism and testing
  - Set seeds or temperature for reproducibility in tests.
  - Build fixtures that simulate critic/validator decisions.
  - Track drift by monitoring validator pass rates over time.

- Deployment
  - Apply at the service boundary (server-side) to keep policies centralized.
  - Expose configuration via flags or policy files; version and roll back cleanly.
  - Instrument with tracing spans around each guardrail step.

## Minimal Pseudo-code

The following sketch illustrates a typical control flow. It elides error handling and streaming details to keep the example focused.

```pseudo
function guardrailDecorator(model, options):
  validators = options.validators        // list of (input, output, feedback) -> {ok, reason}
  critics    = options.critics           // list of (input, output) -> feedback items
  maxRetries = options.maxRetries or 1
  fallback   = options.fallback          // optional alternate model
  repair     = options.repairStrategy    // (input, output, reason) -> newInput or newConstraints

  return function generate(input):
    attempts = 0
    lastReason = null
    while attempts <= maxRetries:
      output = model.generate(input, options.constraints)

      feedback = []
      for critic in critics:
        feedback.append(critic.review(input, output))

      failed = false
      for v in validators:
        res = v.check(input, output, feedback)
        if not res.ok:
          failed = true
          lastReason = res.reason
          // adjust prompt or decoding based on failure reason
          (input, options.constraints) = repair(input, output, res.reason)
          break

      if not failed:
        return output

      attempts += 1

    if fallback != null:
      return fallback.generate(input)

    throw ValidationError("Guardrails failed: " + lastReason)
```

For streaming, interpose chunk-level validators and buffering: validate each chunk (e.g., JSON tokens or moderation checks), and halt the stream with a user-friendly error if a violation occurs. For tool use, wrap tool calls with input sanitization and postconditions, and record tool outputs in the feedback passed to validators.

--- 

This pattern keeps AI systems dependable without sacrificing flexibility. Apply it early in the architecture to standardize behavior across models and use cases, and evolve the guardrails as policies and product requirements mature.