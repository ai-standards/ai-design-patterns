# Shipping Localizations Without Breaking Placeholders

## Company & Problem
Starhopper Studios builds mid-core mobile RPGs with story-heavy content and weekly events. After expanding to 12 languages, the team added an LLM-driven “localization helper” that translated new strings, ran a couple of linters, and posted drafts to Git.

It worked—until it didn’t. The chat loop mixed reasoning, tool calls, and UI updates. ICU placeholders were occasionally mistranslated (“{count}” became “{recuento}”), glossary terms drifted across releases, and retries created duplicate PRs. Any UI tweak (CLI vs. web dashboard) broke something subtle. QA time ballooned, and three Friday hotfixes in a row rattled confidence.

## Applying the Pattern
ACV separated thinking from doing and both from showing. The Agent became a planner: given a batch of strings and locale goals, it decided the next step—use Translation Memory, fill gaps with MT, run QA, ask for human review for risky segments, then commit. The Controller executed those steps deterministically, with retries, budgets, and guardrails. The View subscribed to events to display progress, diffs, and approvals without knowing prompts or tools.

This gave testable seams. Prompts evolved without touching Git code. Tool behavior was hardened (timeouts, argument validation). The UI could stream progress the same way whether used by a PM in a browser or a build script in CI.

## Implementation Plan
- Define a step schema: apply_tm, mt_fill, qa_check, ask_reviewer, commit, done.
- Build tool adapters: TM API, glossary lookup, placeholder linter, screenshot renderer, Git PR creator.
- Implement a Controller with:
  - Per-locale budgets and max-iterations.
  - Retries with backoff; downgrade to ask_reviewer on persistent errors.
  - Event emission: planned, tool_started, tool_result, awaiting_input, completed.
- Create two Views:
  - Web: progress bar by locale, inline diffs, approval buttons.
  - CLI: terse logs for CI.
- Add tests:
  - Agent golden tests on tricky strings.
  - Controller tool mocks for timeouts, malformed args, and rate limits.

## Implementation Steps
Start with an Agent that produces machine-readable intentions. It reasons about risk (e.g., placeholders, numbers, named entities) and plans the next action.

```ts
// agent.ts
type Step =
  | { action: 'apply_tm'; batchId: string }
  | { action: 'mt_fill'; batchId: string }
  | { action: 'qa_check'; batchId: string }
  | { action: 'ask_reviewer'; batchId: string; reason: string }
  | { action: 'commit'; branch: string }
  | { action: 'done' };

export function nextStep(state: any): Step {
  if (!state.tmApplied) return { action: 'apply_tm', batchId: state.batch };
  if (state.gaps > 0) return { action: 'mt_fill', batchId: state.batch };
  if (!state.qa) return { action: 'qa_check', batchId: state.batch };
  if (state.qa.score < 0.95 || state.qa.flags.includes('placeholder_mismatch'))
    return { action: 'ask_reviewer', batchId: state.batch, reason: 'risk' };
  if (!state.committed) return { action: 'commit', branch: state.branch };
  return { action: 'done' };
}
```

The Controller runs the plan safely, records observations, and emits events the Views render.

```ts
// controller.ts
async function runStep(step: Step, ctx: Ctx) {
  ctx.emit({ type: 'planned', step });
  try {
    if (step.action === 'qa_check') {
      const report = await tools.qa(step.batchId, { timeoutMs: 8000 });
      ctx.record({ qa: report });
      ctx.emit({ type: 'qa_result', report });
      return;
    }
    if (step.action === 'commit') {
      await tools.git.createPR(ctx.branch(step), ctx.diff(), { dryRun: ctx.dryRun });
      ctx.emit({ type: 'committed' });
      return;
    }
    // ...other actions...
  } catch (e) {
    if (ctx.retries(step) < 2) return ctx.retry(step, e);
    ctx.emit({ type: 'downgraded', to: 'ask_reviewer', error: String(e) });
    ctx.record({ qa: { score: 0, flags: ['tool_error'] } });
  }
}
```

Guardrails lived in the Controller: validate placeholder sets before commit, cap MT spend per batch, and require human approval if the QA report flagged number-format changes or missing glossaries. The View only consumed emitted events. The web UI streamed QA findings, screenshots of localized screens, and a single “Approve and PR” button when the Agent planned commit.

## Outcome & Takeaways
- Placeholder errors dropped from 7.3% to 0.4%; no Friday hotfixes in six weeks.
- Throughput doubled: average turnaround for a 1,200-string event went from 2.5 days to 1.1.
- Cost predictability improved with per-locale budgets and MT caps.
- Teams iterated prompts and risk heuristics without touching Git or UI code.
- QA trust increased because intermediate steps, tool provenance, and costs were visible.

Key lesson: plan in the Agent, enforce policy in the Controller, and keep the View ignorant of prompts and tools. ACV made the localization pipeline explainable, testable, and fast enough to keep up with weekly content drops.