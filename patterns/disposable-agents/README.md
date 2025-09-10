# Disposable Agents

Disposable Agents are single-use, task-focused AI scripts designed to be fast to create, run once, and discard. Treat them like sharp, well-labeled utility knives: each does one job, integrates just enough with tools or data, and leaves no long-lived state behind. This pattern emphasizes short lifecycles, explicit inputs and outputs, and minimal operational overhead—ideal for ad‑hoc tasks, prototypes, and one-off automations.

## When and why to use it

Use Disposable Agents when speed of creation matters more than longevity or generality. They shine in situations where a small amount of glue logic around a model or tool solves a specific problem, and the solution does not need to persist as a service. Because they avoid durable state and orchestration, they are easy to reason about and safe to discard after execution, reducing both cognitive and operational load.

- The task is ad‑hoc or one-time (e.g., generate a report, clean a dataset, assist a migration).
- The required context is small enough to inline or fetch on demand.
- The risk of partial failure is low or can be mitigated by idempotent design.
- Fast iteration is more valuable than building a generic, reusable system.
- There is no need for memory, personalization, or ongoing agent learning.

## Key benefits and trade-offs

Disposable Agents optimize for speed, isolation, and clarity. The lack of persistent state makes them easy to audit and easy to delete. They also encourage a “function-of-the-inputs” mindset that improves predictability. However, the same constraints limit reuse and can lead to duplication if overused.

- Benefits:
  - Rapid creation and iteration; minimal ceremony to get value.
  - Operationally simple: no persistent storage, queues, or long-lived processes.
  - Safer-by-default: short-lived credentials and limited blast radius.
  - More predictable outputs when designed as single-shot, structured prompts.
  - Easy to audit: each run is a self-contained execution with explicit inputs.

- Trade-offs:
  - No memory or personalization; cannot learn across runs.
  - Potential duplication if many one-offs solve similar problems.
  - Repeated initialization costs (model/tool boot, context fetching).
  - Harder to monitor at scale unless runs are logged consistently.
  - Risk of “prototype sprawl” if promotions to durable systems are not managed.

## Example use cases

Disposable Agents work best for sharply scoped tasks that are easier to automate once than to do manually. They often wrap a model call with a bit of data access and post-processing, then exit.

- One-shot content generation: produce a policy draft from a template and a few inputs.
- Ad‑hoc data cleanup: normalize a CSV column using a model with strict JSON output.
- Incident response helper: summarize logs for a single ticket and suggest next actions.
- Migration assistant: translate config files or docs between versions/formats.
- Batch evaluation: score a set of prompts or completions offline and emit metrics.
- Research spike: test a new tool or API with minimal boilerplate before committing.

## Minimal example (pseudo-code)

Keep examples small and explicit. The core idea: read inputs, call the model/tools once or a bounded number of times, emit structured output, and exit. No hidden state, no background loops.

```python
# summarize_url.py (pseudo-code)

def main(url):
    llm = LLM(model="gpt-4o-mini", temperature=0, timeout=20s)
    page = http.get(url, timeout=10s).text

    system = "You are a concise analyst. Return JSON with keys: title, summary, risks."
    prompt = f"Summarize the page at {url}. Use only the provided content."

    result = llm.complete(
        system=system,
        user=prompt,
        tools=[/* none or minimal */],
        input_context=page,
        response_format=JSONSchema({
            "title": "string",
            "summary": "string",
            "risks": ["string"]
        })
    )

    print(json.dumps(result))   # stdout is the interface

if __name__ == "__main__":
    with run_id(), deadline(30s), ephemeral_credentials():
        url = parse_arg("--url")
        main(url)
```

## Implementation notes

Design Disposable Agents as small, stateless programs with explicit inputs and structured outputs. Favor determinism and guardrails over cleverness. They should be easy to read, easy to run, and easy to delete without side effects.

- Inputs and outputs:
  - Treat the agent as a pure function: inputs via args/stdin/files; outputs via stdout/JSON.
  - Define and validate a response schema; set temperature to 0 for repeatability.
  - Include a run_id in logs and outputs to correlate execution artifacts.

- Safety and reliability:
  - Use strict timeouts, budgets (max tokens/tools), and retries with backoff.
  - Make operations idempotent; use idempotency keys when writing to external systems.
  - Fail closed: on schema/validation errors, exit non‑zero with actionable messages.

- Security and privacy:
  - Prefer short‑lived credentials and least‑privilege scopes.
  - Redact sensitive inputs in logs; store full prompts only when permitted.
  - Run in disposable environments (containers, serverless) when possible.

- Reproducibility:
  - Pin model versions and dependencies; record them in the output metadata.
  - Vendor critical prompts next to code; avoid hidden prompt dependencies.
  - Capture the exact inputs used (or a hash) for later auditing.

- Observability:
  - Log structured events to stdout: start, inputs metadata (non‑sensitive), decisions, output summary, duration, costs.
  - Emit a final status line that tools can parse (e.g., {"status":"ok","run_id":...}).

- Performance:
  - Cache expensive fetches within the single run; avoid global caches.
  - Batch requests when possible; prefer single round‑trip to multi‑turn unless necessary.

- Tooling and ergonomics:
  - Create a lightweight scaffold (template) for new disposables: flags, logging, schema, deadlines.
  - Keep each script under a clear directory (e.g., /disposable_agents/<task>/main.py) with a short README.

- Promotion criteria (“graduate” to a durable agent/service) when:
  - Usage becomes recurring or scheduled.
  - State, memory, or SLAs are needed.
  - Multiple stakeholders depend on stable interfaces or monitoring.
  - The script grows features or conditional flows that complicate single-run semantics.

## Why this pattern works

Confining scope to “one run, one job” significantly reduces complexity. It encourages explicit contracts, safer defaults, and faster iteration loops. By making the throwaway path easy and the durable path deliberate, teams explore ideas quickly without committing to infrastructure too early. When a Disposable Agent starts earning repeated use, the same clarity—explicit inputs, schemas, pinned versions—makes promotion to a long‑lived system straightforward.