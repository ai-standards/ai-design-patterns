# Tool Proxy

The Tool Proxy pattern applies the classic Proxy design to AI systems: it places a trustworthy gatekeeper between a model and external tools or APIs. Instead of granting a model direct access to databases, payment systems, search engines, or shell commands, route every tool invocation through a proxy that enforces policy, validates inputs and outputs, limits risk, and records what happened. The proxy turns free-form model intentions into safe, auditable, and deterministic actions.

This pattern improves safety and reliability without stripping flexibility. It can be implemented as an in-process wrapper, a local sidecar, or a network service, and it works with most tool-calling mechanisms (function calling, JSON schema tools, RPC, REST). The proxy becomes the single, consistent contract that tools must satisfy and that models learn to use.

## When and Why to Use It

Use the Tool Proxy whenever a model can trigger side effects or access sensitive data. Models are excellent at choosing actions, but they are not reliable at enforcing security boundaries, budgets, or compliance. A proxy absorbs that responsibility, reducing blast radius and aligning tool use with organizational policy.

This pattern is particularly valuable when multiple tools live behind different permissions and rate limits, when auditing is required, or when tool outputs could contain untrusted content (prompt injections, secrets, PII). It also helps in multi-tenant settings and when swapping models, since the proxy provides a stable contract across model versions.

- Typical triggers:
  - Tools that can modify state (payments, tickets, files, infra).
  - Sensitive data access (SQL queries, customer records, EHR).
  - Compliance or audit requirements (log every action, who/what/why).
  - Cost/rate limits that the model must not exceed.
  - Multi-tool orchestration with different auth scopes.

## Key Benefits and Trade-offs

A Tool Proxy delivers safety, consistency, and observability at the cost of some additional complexity and latency. The payoff is usually significant: fewer incidents, clearer contracts, easier testing, and better governance over tool use.

- Benefits:
  - Safety and least privilege: scoped credentials, allow/deny policies, and guardrails per tool.
  - Determinism and validation: schema-constrained inputs/outputs and argument coercion.
  - Observability and audit: structured logs, correlation IDs, cost and rate tracking.
  - Portability: stable tool contracts across models and providers.
  - Resilience: timeouts, retries, circuit breaking, backoff, and graceful degradation.
  - Testability: mock tools and contract tests without changing the model.
  - Cost control: budget enforcement and pricing-aware throttling.

- Trade-offs:
  - Added latency for policy checks, logging, and mediation.
  - Extra infrastructure and maintenance (policy rules, schemas, adapters).
  - Possible false rejections that block useful actions if policies are too strict.
  - Reduced expressiveness if the proxy exposes tools too narrowly.

## Example Use Cases

The Tool Proxy slots into any agent or assistant that calls external capabilities. The following scenarios illustrate how it reduces risk and clarifies behavior without boxing the model in.

- Customer support assistant updating tickets: validates fields, enforces role-based scopes, blocks mass updates, logs deltas, and sanitizes returned comments.
- AI data analyst running SQL: converts natural language to parameterized queries, applies row- and column-level security, caps scan size and execution time.
- Developer assistant with shell access: whiteslists commands, runs in a sandbox, captures output as text-only, prevents exfiltration and destructive operations.
- Financial assistant placing trades: enforces per-instrument limits, budget ceilings, market-hours checks, and a human-approval step for large orders.
- Healthcare scheduler calling EHR APIs: redacts PHI in logs, uses short-lived tokens with narrow scopes, validates appointment windows, and records consent.

## How It Works

A Tool Proxy mediates every tool call through a structured pipeline. The model proposes an action; the proxy checks it, executes it safely, and feeds a clean result back to the model. Treat the model’s proposal as untrusted instructions and the tool’s response as untrusted data.

- Typical flow:
  1) Model proposes tool and arguments (e.g., via function/tool calling).
  2) Proxy validates against a tool registry and argument schema.
  3) Policy engine evaluates allow/deny with context (user, tenant, budget).
  4) Proxy obtains least-privilege, short-lived credentials.
  5) Adapter executes the API call with timeouts, retries, and rate limits.
  6) Output is sanitized (content filtering, PII redaction, prompt-injection shields).
  7) Structured logs and metrics are emitted with correlation IDs.
  8) A summarized, typed result is returned to the model.

## Minimal Pseudo-code

A small sketch shows the moving parts. Keep concrete implementations simple; details vary by language and runtime.

```pseudo
# Tool descriptors define a safe contract
tool_registry = {
  "update_ticket": {
    schema: {
      id: string,
      status: enum["open","pending","closed"],
      comment: string(max=500)
    },
    auth_scope: "tickets:write",
    rate_limit: "5/min",
    budget: "$0.10/call",
    allow: ctx -> ctx.user.role in ["agent","admin"]
  }
}

class ToolProxy:
  def call(tool_name, args, ctx):
    tool = tool_registry.get(tool_name) or deny("unknown tool")
    coerced = validate_and_coerce(args, tool.schema) or deny("bad args")
    check_policy(tool.allow, ctx) or deny("policy")
    enforce_rate_limit(tool_name, ctx)
    enforce_budget(tool_name, ctx)
    token = issue_scoped_token(tool.auth_scope, ctx)
    result = execute_adapter(tool_name, coerced, token, timeout=5s, retries=2)
    clean = sanitize_output(result)  # redact PII, strip prompts, cap size
    log_call(tool_name, coerced, clean.meta, ctx)
    return summarize(clean)  # concise, typed result for the model
```

## Implementation Notes

Keep the proxy’s responsibilities crisp: validate, authorize, execute safely, and report. Avoid embedding task-specific logic inside the proxy; that belongs in planners or the model’s prompts. The proxy should remain a predictable, policy-driven interface.

- Tool registry and schemas:
  - Define each tool with a name, description, JSON schema (or equivalent), auth scope, limits, and pricing metadata.
  - Prefer narrow, composable tools over a single “do_anything” endpoint.
  - Version tools to avoid breaking existing prompts.

- Policy engine:
  - Allow/deny rules should consider user identity, tenant, environment, time, budget, and model trust tier.
  - Include human-in-the-loop gates for high-impact actions.
  - Record the model’s rationale and the final decision for audits.

- Security:
  - Treat model proposals and tool outputs as untrusted.
  - Use least-privilege, short-lived credentials (e.g., OAuth with fine scopes).
  - Never expose raw secrets to the model; redact or hash sensitive values in logs.
  - Defend against prompt injection in tool outputs: strip prompts, allowlist formats, and avoid feeding untrusted instructions back to the model without filtering.

- Reliability:
  - Apply timeouts, retries with backoff, and circuit breakers per tool.
  - Provide fallbacks (cache, read-only variants) and surface partial failures clearly.
  - Design idempotent operations or include request IDs for safe retries.

- Cost and rate control:
  - Track per-user and per-tool budgets; enforce hard caps.
  - Batch or cache frequent read operations where safe.
  - Consider dynamic throttling based on spend and latency.

- Observability:
  - Emit structured logs with correlation IDs, tool names, arguments (redacted), outcomes, latency, and cost.
  - Capture metrics per tool: success rate, error classes, rate-limit hits, and budget denials.
  - Provide replay tooling for investigations using sanitized records.

- Testing:
  - Supply mock adapters and a fake proxy for unit tests.
  - Add contract tests for each tool schema and policy.
  - Red-team prompts to probe injection, escalation, and exfiltration paths.

## Design Tips

Start with the smallest useful set of tools and tight schemas. Expand capability by adding new tools rather than widening arguments. Keep the proxy language-agnostic if multiple services consume it, and prefer returning compact, structured summaries to models instead of raw payloads. When a tool produces large or sensitive outputs, store the raw data server-side and return a short handle plus a safe summary to the model.

When composing with other patterns, place the Tool Proxy beneath planners or agents and alongside guardrails. The planner decides what to do; the proxy ensures it is done safely. This separation keeps prompts simple, policies centralized, and systems auditable.

## Summary

The Tool Proxy pattern gives models controlled, auditable access to real-world capabilities. By interposing validation, policy, security, and observability between the model and tools, it reduces risk and increases reliability without sacrificing flexibility. Use it whenever an AI system reaches beyond text into actions that matter.