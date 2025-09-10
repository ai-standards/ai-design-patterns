# One-Run Helpers for a Content Migration Deadline

## Company & Problem
StepWise Learning, an online education platform, rebuilt its content stack around a headless CMS. The legacy repository held 3,200 Markdown lessons authored over five years by dozens of instructors. Each lesson mixed prose with “quiz:” fenced blocks, free‑form glossary notes, and links pointing to old paths. The new CMS required structured blocks (quizzes as JSON), normalized terms (e.g., consistently use “learning objectives”), and link rewrites to canonical slugs.

A durable migration service was tempting, but time was tight and content variance was high. The team needed rapid iteration and strong guardrails: transform one file at a time, produce auditable JSON, and fail loudly on schema issues. They also wanted minimal infrastructure risk—no long‑lived agents holding credentials or accumulating state.

## Applying the Pattern
Disposable Agents fit the migration perfectly. Each agent was a tiny CLI that did one job, read a single lesson file, emitted structured output, and exited. No memory, no background loops, no shared caches. If a run failed, rerun on that file with the same inputs; if it worked, commit the result and move on.

Three disposables covered the gap:
- quiz_extractor: parse Markdown and emit a normalized quiz JSON block.
- link_rewriter: convert legacy links to CMS slugs, report unresolved targets.
- glossary_normalizer: identify nonstandard terms and propose replacements with diffs.

Because each script accepted explicit inputs and returned strict JSON, results were easy to pipe into the CMS importer and to audit later. Credentials were short‑lived, and all runs logged a run_id and model/version metadata.

## Implementation Plan
- Define per‑agent schemas with strict validation.
- Pin model versions and set deterministic parameters.
- Build a tiny CLI harness: file-in, JSON-out, nonzero exit on validation errors.
- Add request timeouts, retries, and per-run budgets.
- Log structured events to stdout; store artifacts by run_id.
- Parallelize over files in batches; rerun only failed ones.
- Archive agents and prompts next to migration scripts; delete after cutover.

## Implementation Steps
The team scaffolded a minimal TypeScript template shared by all three agents. quiz_extractor illustrates the pattern: read a file, call the model once with a schema, print JSON, exit.

```ts
// quiz_extractor.ts
import { z } from "zod";
import fs from "node:fs/promises";
import { callModel } from "./llm"; // thin wrapper with timeouts

const QuizSchema = z.object({
  questions: z.array(z.object({
    stem: z.string(),
    choices: z.array(z.string()).min(2),
    answerIndex: z.number().int().nonnegative()
  }))
});

const md = await fs.readFile(process.argv[2], "utf8");
const res = await callModel({ system: "Extract quizzes; output JSON only.",
  input: md, schema: QuizSchema, model: "gpt-4o-mini-2024-07", temperature: 0 });
console.log(JSON.stringify({ runId: crypto.randomUUID(), quiz: QuizSchema.parse(res) }));
```

link_rewriter took the same shape, but returned a patch and a report of misses. The orchestration layer did not become a service; a simple runner batched files and captured outputs per run_id.

```ts
// run_batch.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

for (const file of process.argv.slice(2)) {
  const { stdout } = await run("node", ["quiz_extractor.js", file], { timeout: 20000 });
  const out = JSON.parse(stdout);
  process.stdout.write(JSON.stringify({ status: "ok", file, runId: out.runId }) + "\n");
}
```

Each agent failed closed: if parsing or schema validation failed, it exited non‑zero with a concise error message. Runs emitted a short summary line that the batch runner collected. No agent wrote directly to the CMS; instead, a separate idempotent importer consumed the JSON, applied patches, and logged successful writes with the corresponding run_id.

## Outcome & Takeaways
The migration finished in four days instead of the estimated three weeks. The disposables automated 89% of lessons end‑to‑end; editors handled the remaining edge cases flagged by validation. Because every run was self‑contained, reruns were trivial and safe. There were no dangling credentials or background processes to clean up.

Key lessons:
- Treat each agent like a pure function: explicit inputs, strict outputs, no side effects.
- Pin models and validate aggressively to keep behavior predictable under deadline pressure.
- Keep disposables tiny and purpose‑built; avoid generalizing prematurely.
- Log just enough metadata to audit and rerun confidently.

After cutover, the scripts were archived. Only link monitoring—proven useful beyond migration—graduated into a small scheduled job, built from the same clear contracts the disposables established.