# Turning Messy RFPs into Reliable Data

## Company & Problem
BidBridge aggregates public-sector Requests for Proposals (RFPs) from hundreds of municipal portals. Cities post as PDFs, Word docs, and web pages with wildly inconsistent formats. Buyers rely on BidBridge’s dataset to filter by due date, budget, and mandatory meeting requirements.

A one-shot extraction prompt produced brittle results. Deadlines were misread when a document included both “Questions due” and “Bids due.” Budgets swung by orders of magnitude when “$1,000,000” appeared in a sample form but the actual cap was “$100,000.” Mandatory site visits were missed unless phrased exactly. Support tickets spiked every Monday as vendors prepared their week.

The team needed a way to make steady, verifiable progress on each document and recover from partial failures without restarting the whole job.

## Applying the Pattern
Plan–Act–Reflect fit the problem. It split extraction into small, checkable steps with explicit goals and constraints. The agent planned which field to extract next, acted by running a targeted toolchain (OCR, section finder, LLM), then reflected by comparing results to validators: date logic, currency normalization, and policy rules learned per city.

When a validation failed—say, the due date preceded the publish date—the agent didn’t guess. It revised the plan: search for alternate phrasings, constrain the scope to a section, or switch a tool (e.g., table parser instead of free text). The loop ended when all fields passed checks or a budget was exhausted, producing traceable reasons to stop.

## Implementation Plan
- State
  - Objective: extract {dueDate, budget, preBidRequired, contactEmail, deliveryMethod}
  - Constraints: dates after publish, budget in USD, timezone from locale, email RFC compliance
  - History: steps, raw snippets, tool outputs, validators
- Planner
  - Choose the next field with highest uncertainty and cheapest check
  - Attach a search hint (e.g., “bid opening,” “proposal due,” “mandatory pre-bid”)
- Actor
  - Tools: OCR/PDF text, section indexer, regex finders, LLM extractor with schema
- Reflector
  - Run validators; if failures, produce a bounded critique and adjustments
- Termination
  - All fields valid OR 8 steps OR 20 seconds OR repeated same failure twice

## Implementation Steps
The agent started with fields that anchor others (publish date and timezone), then iterated on higher-risk fields. Each action produced artifacts (snippet, tokens, offsets) that validators could point back to.

Small, typed steps made the loop predictable:

```ts
type Field = 'dueDate' | 'budget' | 'preBidRequired' | 'contactEmail' | 'deliveryMethod';
type Step = { field: Field; hint?: string; tool: 'section' | 'table' | 'regex' | 'llm' };

async function act(step: Step, doc: ParsedDoc): Promise<{ value: unknown; evidence: string }> {
  if (step.tool === 'section') return findSection(doc, step.hint ?? step.field);
  if (step.tool === 'table') return parseBudgetTable(doc);
  if (step.tool === 'regex') return regexExtract(doc, step.field);
  return llmExtract(doc, step.field, step.hint); // schema-constrained
}
```

Reflection used concrete signals, not vibes. Validators were small, composable functions with evidence:

```ts
type Issue = { field: Field; message: string; evidence?: string };
function validate(ctx: any): Issue[] {
  const issues: Issue[] = [];
  if (ctx.dueDate && ctx.publishDate && ctx.dueDate <= ctx.publishDate)
    issues.push({ field: 'dueDate', message: 'Due date precedes publish date', evidence: ctx.dueDateText });
  if (ctx.budget && ctx.budget > 5_000_000 && !/cap|maximum|not-to-exceed/i.test(ctx.budgetText))
    issues.push({ field: 'budget', message: 'Large value found without cap language', evidence: ctx.budgetText });
  if (ctx.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.contactEmail))
    issues.push({ field: 'contactEmail', message: 'Invalid email format', evidence: ctx.contactEmailText });
  return issues;
}
```

When a validator failed, the planner revised the next step:
- Due date ambiguous? Switch hint from “proposal due” to “bid opening,” limit search to the calendar section, and prefer table parsing if a schedule table exists.
- Budget too large without “cap” language? Re-scan for “not-to-exceed” phrases and deprioritize amounts in sample forms.
- Pre-bid unclear? Search for “mandatory,” “site visit,” or “non-mandatory”; if conflicted, require explicit yes/no from the LLM with citation to the closest sentence.

The loop logged each critique as issue+evidence+plan adjustment, keeping context tight and recoverable.

## Outcome & Takeaways
After rollout, field-level accuracy rose from 69% to 95% on a 1,200-document benchmark. The average document took 3.1 iterations and 14 seconds, up from 7 seconds one-shot, but support tickets dropped by 62% and vendor trust improved. Explicit traces made policy reviews straightforward: auditors could see why a budget was accepted and which sentences supported it.

Key lessons:
- Make validators first; they turn “reflection” into grounded decisions.
- Keep actions small and tool-specific; switching from free text to table parsing rescued many edge cases.
- Prioritize high-uncertainty fields early; certainty compounds across steps.
- Add stagnation detection; repeating the same due-date error twice triggers a safe stop with a human-review flag.

Plan–Act–Reflect converted a brittle prompt into a controllable extraction workflow, trading a bit of latency for reliability and auditability where correctness mattered.