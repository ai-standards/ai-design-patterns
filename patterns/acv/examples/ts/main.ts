// ACV (Agent–Controller–View) example for a localization pipeline.
// The file is self-contained, runnable with ts-node, and includes heavy inline comments.
// It simulates a batch translation flow with deterministic "tools", planning logic,
// guarded execution (budgets, retries, validations), and two views (CLI and Web-like).
// The goal is to show how separating planning (Agent), execution (Controller),
// and presentation (Views) yields testable seams and robust behavior.

//////////////////////////
// Types and Utilities  //
//////////////////////////

// Step is the machine-readable "intention" the Agent produces.
// It is intentionally free of tool details and UI concerns.
// This keeps the plan stable and testable, independent of execution and display.
type Step =
  | { action: 'apply_tm'; batchId: string }
  | { action: 'mt_fill'; batchId: string }
  | { action: 'qa_check'; batchId: string }
  | { action: 'ask_reviewer'; batchId: string; reason: string }
  | { action: 'commit'; branch: string }
  | { action: 'done' };

// QAReport expresses objective quality and risk signals the Controller can enforce.
// The Controller uses flags to gate committing and to trigger human review.
interface QAReport {
  score: number;
  flags: string[];
  details: string[];
}

// A localizable string with an optional glossary term that must be preserved.
interface SourceString {
  id: string;
  text: string;
  glossaryTerm?: string;
}

// The batch being processed: source strings, target locales, and in-progress translations.
// This is what "tools" read/write; the Controller keeps state derived from it.
interface Batch {
  id: string;
  branch: string;
  locales: string[];
  source: SourceString[];
  translations: Record<string, Record<string, string>>; // locale -> id -> text
  committed: boolean;
  tmApplied: boolean;
  qa?: QAReport;
}

// Controller-level config and guardrails, including per-locale budgets.
// Budgets simulate spend limits for machine translation per locale.
interface ControllerConfig {
  maxIterations: number;
  mtBudgetPerLocale: Record<string, number>;
  dryRun: boolean;
}

// Progress and audit events the Views consume. Views do not know prompts or tools.
// They simply render these events (e.g., logs, progress bars, buttons).
type Event =
  | { type: 'planned'; step: Step }
  | { type: 'tool_started'; tool: string; detail?: string }
  | { type: 'tool_result'; tool: string; detail?: string }
  | { type: 'qa_result'; report: QAReport }
  | { type: 'awaiting_input'; reason: string }
  | { type: 'downgraded'; to: 'ask_reviewer'; error: string }
  | { type: 'cost'; locale: string; spent: number; budget: number }
  | { type: 'committed'; branch: string }
  | { type: 'completed' };

// Minimal strongly-typed event emitter. Simpler than Node's EventEmitter
// and easy to control for tests. Views subscribe via .on().
class Emitter<T> {
  private listeners: Array<(e: T) => void> = [];
  on(fn: (e: T) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }
  emit(e: T): void {
    for (const l of this.listeners) l(e);
  }
}

// Helper: extract ICU-style placeholders from a string: "{name}" -> "name".
// Using a conservative regex avoids false positives and handles repeated matches.
function extractPlaceholders(s: string): Set<string> {
  const out = new Set<string>();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.add(m[1]);
  return out;
}

// Helper: compute a trivial textual diff summary (line counts only) for demonstration.
// In production, integrate a real diff. Here, only the existence of diffs is important.
function diffSummary(batch: Batch): string {
  const total = Object.values(batch.translations).reduce(
    (acc, map) => acc + Object.keys(map).length,
    0
  );
  return `diff: ${total} translated segments across ${Object.keys(batch.translations).length} locales`;
}

/////////////////////////////
// Mock "Tool" Adapters    //
/////////////////////////////

// Tools stand in for real integrations. They are deterministic and fast.
// Each tool validates inputs and returns predictable results to keep the example runnable offline.
const tools = {
  // Translation Memory apply: fills exact matches (case-sensitive) from a tiny in-memory TM.
  // Tradeoff: exact-match only keeps logic simple; a real TM would handle fuzziness.
  applyTM(batch: Batch): void {
    // In-memory TM with one known segment. In reality, this would be keyed by source id or text.
    const TM: Record<string, Record<string, string>> = {
      'You have {count} apples.': {
        es: 'Tienes {count} manzanas.',
        fr: 'Vous avez {count} pommes.',
      },
    };
    for (const src of batch.source) {
      const tmEntry = TM[src.text];
      if (!tmEntry) continue;
      for (const locale of batch.locales) {
        const hit = tmEntry[locale];
        if (!hit) continue;
        batch.translations[locale] = batch.translations[locale] || {};
        batch.translations[locale][src.id] = hit;
      }
    }
  },

  // Machine translation: fills gaps and (intentionally) mistranslates placeholders for one string
  // to simulate a risky output. It charges "cost" per character.
  mtFill(
    batch: Batch,
    budgets: Record<string, number>
  ): { spentPerLocale: Record<string, number> } {
    const SPANISH_BAD = (s: string) =>
      s.replace('Hello, {name}!', '¡Hola, {nombre}!'); // placeholder drift on purpose
    const costPerChar = 0.00001;
    const spentPerLocale: Record<string, number> = {};

    for (const locale of batch.locales) {
      let spent = 0;
      batch.translations[locale] = batch.translations[locale] || {};
      for (const src of batch.source) {
        if (batch.translations[locale][src.id]) continue;
        const mtOut =
          locale === 'es'
            ? SPANISH_BAD(src.text)
            : `[${locale}] ${src.text}`; // neutral mock MT for other locales
        const cost = mtOut.length * costPerChar;
        if (spent + cost > (budgets[locale] ?? 0)) {
          // Stop if budget exceeded; remaining gaps persist.
          break;
        }
        batch.translations[locale][src.id] = mtOut;
        spent += cost;
      }
      spentPerLocale[locale] = spent;
    }
    return { spentPerLocale };
  },

  // QA: checks placeholder set equality and glossary preservation.
  // It returns a score penalized by flags. The Controller enforces guardrails based on this.
  qa(batch: Batch, glossary: Record<string, string>): QAReport {
    const flags: string[] = [];
    const details: string[] = [];
    let penalties = 0;

    for (const locale of batch.locales) {
      const tmap = batch.translations[locale] || {};
      for (const src of batch.source) {
        const t = tmap[src.id];
        if (!t) continue;
        const srcPH = extractPlaceholders(src.text);
        const trgPH = extractPlaceholders(t);
        const mismatch =
          srcPH.size !== trgPH.size ||
          [...srcPH].some((p) => !trgPH.has(p));
        if (mismatch) {
          flags.push('placeholder_mismatch');
          details.push(
            `locale=${locale} id=${src.id} placeholders ${[...srcPH].join(',')} -> ${[
              ...trgPH,
            ].join(',')}`
          );
          penalties += 0.25;
        }
        const term = src.glossaryTerm ? glossary[src.glossaryTerm] : undefined;
        if (term && !t.includes(term)) {
          flags.push('glossary_missing');
          details.push(`locale=${locale} id=${src.id} missing term "${term}"`);
          penalties += 0.15;
        }
      }
    }

    const score = Math.max(0, 1 - penalties);
    return { score, flags: Array.from(new Set(flags)), details };
  },

  // Git PR creation mock: validates arguments and "succeeds".
  git: {
    createPR(branch: string, diff: string, opts: { dryRun: boolean }): void {
      if (!branch || !diff) throw new Error('git: missing branch or diff');
      // Dry-run simulates CI usage. Real code would call out to a VCS API.
      if (opts.dryRun) return;
    },
  },
};

/////////////////
// Agent Logic //
/////////////////

// The Agent plans the next action based on current state.
// It does no I/O and makes no calls; this keeps it pure and golden-testable.
// The logic encodes risk heuristics (e.g., placeholders) and sequencing.
function nextStep(state: {
  batch: string;
  tmApplied: boolean;
  gaps: number;
  qa?: QAReport;
  committed: boolean;
  branch: string;
}): Step {
  if (!state.tmApplied) return { action: 'apply_tm', batchId: state.batch };
  if (state.gaps > 0) return { action: 'mt_fill', batchId: state.batch };
  if (!state.qa) return { action: 'qa_check', batchId: state.batch };
  if (state.qa.score < 0.95 || state.qa.flags.includes('placeholder_mismatch'))
    return { action: 'ask_reviewer', batchId: state.batch, reason: 'risk' };
  if (!state.committed) return { action: 'commit', branch: state.branch };
  return { action: 'done' };
}

//////////////////////
// Controller (ACV) //
//////////////////////

// The Controller executes planned steps deterministically and safely.
// It handles retries, budgets, validations, and emits events for Views.
// This separation means tool and policy changes do not touch the Agent or Views.
class Controller {
  private emitter = new Emitter<Event>();
  private retries: Record<string, number> = {};
  private glossary: Record<string, string> = { guild: 'Guild' }; // tiny glossary
  constructor(private batch: Batch, private cfg: ControllerConfig) {}

  onEvent(fn: (e: Event) => void): () => void {
    return this.emitter.on(fn);
  }

  // Entry point: run until Agent returns "done" or iteration cap is hit.
  run(): void {
    for (let i = 0; i < this.cfg.maxIterations; i++) {
      const state = this.deriveState();
      const step = nextStep(state);
      this.emitter.emit({ type: 'planned', step });
      if (step.action === 'done') {
        this.emitter.emit({ type: 'completed' });
        return;
      }
      try {
        this.runStep(step);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const key = step.action;
        const count = (this.retries[key] = (this.retries[key] ?? 0) + 1);
        if (count <= 2) {
          // Backoff is implicit (no timers in this demo). Log and let loop retry.
          this.emitter.emit({
            type: 'downgraded',
            to: 'ask_reviewer',
            error: `${step.action} failed: ${err.message}`,
          });
          // Force a safe downgrade by injecting a QA failure the Agent will respond to.
          this.batch.qa = { score: 0, flags: ['tool_error'], details: [err.message] };
        } else {
          // After persistent failure, request human input.
          this.emitter.emit({ type: 'awaiting_input', reason: 'persistent_tool_error' });
          return;
        }
      }
    }
    // Exceeded iterations indicates a bug or a dead loop; surface via event.
    this.emitter.emit({ type: 'awaiting_input', reason: 'max_iterations_reached' });
  }

  // Executes a single step. Each variant validates its inputs, updates batch,
  // and emits tool lifecycle events. Guardrails are applied before risky actions.
  private runStep(step: Step): void {
    switch (step.action) {
      case 'apply_tm': {
        this.emitter.emit({ type: 'tool_started', tool: 'applyTM' });
        tools.applyTM(this.batch);
        this.batch.tmApplied = true;
        this.emitter.emit({ type: 'tool_result', tool: 'applyTM', detail: 'TM applied' });
        return;
      }
      case 'mt_fill': {
        this.emitter.emit({ type: 'tool_started', tool: 'mtFill' });
        const { spentPerLocale } = tools.mtFill(this.batch, this.cfg.mtBudgetPerLocale);
        for (const [locale, spent] of Object.entries(spentPerLocale)) {
          this.emitter.emit({
            type: 'cost',
            locale,
            spent,
            budget: this.cfg.mtBudgetPerLocale[locale] ?? 0,
          });
        }
        this.emitter.emit({ type: 'tool_result', tool: 'mtFill', detail: 'Gaps filled' });
        return;
      }
      case 'qa_check': {
        this.emitter.emit({ type: 'tool_started', tool: 'qa' });
        const report = tools.qa(this.batch, this.glossary);
        this.batch.qa = report;
        this.emitter.emit({ type: 'qa_result', report });
        return;
      }
      case 'ask_reviewer': {
        // Simulate human-in-the-loop as a deterministic patcher that fixes placeholders only.
        // Design choice: controllers may apply safe, localized autofixes to reduce reviewer toil.
        this.emitter.emit({ type: 'awaiting_input', reason: step.reason });
        this.autofixPlaceholders();
        // Re-run QA immediately after autofix to verify risk is mitigated.
        const report = tools.qa(this.batch, this.glossary);
        this.batch.qa = report;
        this.emitter.emit({ type: 'qa_result', report });
        return;
      }
      case 'commit': {
        // Guardrail: refuse to commit if placeholders still mismatched or score low.
        const report = this.batch.qa;
        if (!report || report.score < 0.95 || report.flags.includes('placeholder_mismatch')) {
          throw new Error('commit blocked by QA');
        }
        this.emitter.emit({ type: 'tool_started', tool: 'git.createPR' });
        tools.git.createPR(this.batch.branch, diffSummary(this.batch), {
          dryRun: this.cfg.dryRun,
        });
        this.batch.committed = true;
        this.emitter.emit({ type: 'committed', branch: this.batch.branch });
        return;
      }
      case 'done':
        return;
    }
  }

  // Derive state for the Agent from the mutable batch.
  private deriveState(): {
    batch: string;
    tmApplied: boolean;
    gaps: number;
    qa?: QAReport;
    committed: boolean;
    branch: string;
  } {
    const gaps = this.countGaps();
    return {
      batch: this.batch.id,
      tmApplied: this.batch.tmApplied,
      gaps,
      qa: this.batch.qa,
      committed: this.batch.committed,
      branch: this.batch.branch,
    };
  }

  // Count untranslated segments across all locales; the Agent uses this to decide MT filling.
  private countGaps(): number {
    let gaps = 0;
    for (const locale of this.batch.locales) {
      const t = this.batch.translations[locale] || {};
      for (const src of this.batch.source) {
        if (!t[src.id]) gaps++;
      }
    }
    return gaps;
  }

  // Autofix strategy: for each translation, force the placeholder set to match the source
  // by renaming mismatched placeholders while preserving positions as much as possible.
  // Tradeoff: this is a heuristic; a real system may propose fixes to a reviewer instead.
  private autofixPlaceholders(): void {
    for (const locale of this.batch.locales) {
      const tmap = this.batch.translations[locale] || {};
      for (const src of this.batch.source) {
        const t = tmap[src.id];
        if (!t) continue;
        const srcPH = [...extractPlaceholders(src.text)];
        const trgPH = [...extractPlaceholders(t)];
        if (srcPH.length === trgPH.length && srcPH.every((p) => trgPH.includes(p))) continue;
        let fixed = t;
        // Replace each target placeholder (orderwise) with source placeholder names.
        // This preserves ICU token count while correcting drifted identifiers.
        for (let i = 0; i < trgPH.length; i++) {
          const from = trgPH[i];
          const to = srcPH[i] ?? from;
          fixed = fixed.replace(new RegExp(`\\{${from}\\}`, 'g'), `{${to}}`);
        }
        tmap[src.id] = fixed;
      }
      this.batch.translations[locale] = tmap;
    }
  }
}

////////////
// Views  //
////////////

// CLI view: terse logs suitable for CI. Consumes events; knows nothing about prompts or tools.
// This demonstrates how swapping UIs does not affect Agent or Controller.
class CLIView {
  constructor(ctrl: Controller) {
    ctrl.onEvent((e) => {
      if (e.type === 'planned') console.log(`[plan] ${e.step.action}`);
      if (e.type === 'tool_started') console.log(`[tool] start ${e.tool}`);
      if (e.type === 'tool_result') console.log(`[tool] done ${e.tool} - ${e.detail ?? ''}`);
      if (e.type === 'qa_result')
        console.log(`[qa] score=${e.report.score.toFixed(2)} flags=${e.report.flags.join(',')}`);
      if (e.type === 'awaiting_input') console.log(`[wait] ${e.reason}`);
      if (e.type === 'cost')
        console.log(`[cost] ${e.locale} spent=${e.spent.toFixed(4)} budget=${e.budget}`);
      if (e.type === 'committed') console.log(`[git] PR created on ${e.branch}`);
      if (e.type === 'completed') console.log(`[done] pipeline complete`);
      if (e.type === 'downgraded')
        console.log(`[degrade] -> ${e.to} because ${e.error}`);
    });
  }
}

// "Web" view: capture state for a UI. It shows a progress-like snapshot.
// Here, it simply aggregates the latest QA and commit status for illustration.
class WebView {
  latest: { qa?: QAReport; committed?: boolean } = {};
  constructor(ctrl: Controller, private batch: Batch) {
    ctrl.onEvent((e) => {
      if (e.type === 'qa_result') this.latest.qa = e.report;
      if (e.type === 'committed') this.latest.committed = true;
    });
  }
  render(): void {
    const status = this.latest.committed ? 'Committed' : 'In Progress';
    const qa =
      this.latest.qa ? `QA ${this.latest.qa.score.toFixed(2)} [${this.latest.qa.flags.join(',')}]` : 'QA pending';
    console.log(`[web] ${status} | ${qa}`);
  }
}

///////////////////////
// Usage / "Tests"   //
///////////////////////

// Build a batch with two strings, one with a placeholder and glossary term, the other a greeting.
// The Spanish MT intentionally drifts "{name}" to "{nombre}" to trigger the placeholder guardrail.
const batch: Batch = {
  id: 'batch-42',
  branch: 'feature/l10n-weekly-event',
  locales: ['es', 'fr'],
  source: [
    { id: 's1', text: 'You have {count} apples.', glossaryTerm: 'guild' }, // contains glossary "Guild"
    { id: 's2', text: 'Hello, {name}!' },
  ],
  translations: {},
  committed: false,
  tmApplied: false,
};

// Configure the Controller with sane budgets and small iteration cap.
// Budgets are generous enough to fill both strings.
const cfg: ControllerConfig = {
  maxIterations: 20,
  mtBudgetPerLocale: { es: 1, fr: 1 }, // dollars
  dryRun: true, // do not actually create a PR
};

// Wire ACV: Controller + two Views.
const controller = new Controller(batch, cfg);
new CLIView(controller);
const web = new WebView(controller, batch);

// 1) Golden-test-like check: the Agent should sequence apply_tm -> mt_fill -> qa_check initially.
(() => {
  const initialState = {
    batch: batch.id,
    tmApplied: batch.tmApplied,
    gaps: 2 * batch.locales.length, // all empty
    qa: undefined,
    committed: batch.committed,
    branch: batch.branch,
  };
  const first = nextStep(initialState);
  console.log(`[test] first step = ${first.action}`); // expect "apply_tm"
})();

// 2) Run the pipeline end-to-end. Views will log and update progressively.
controller.run();
web.render(); // Show a compact status snapshot

// 3) Assert the guardrail worked: placeholders should match after autofix, enabling commit gating.
// Even in dryRun, committed flag is set true after passing QA and "PR creation".
const esS2 = batch.translations['es']?.['s2'] ?? '';
console.log(`[assert] ES s2 placeholders ok = ${extractPlaceholders(esS2).has('name')}`); // true after autofix
console.log(`[assert] committed = ${batch.committed}`); // true in dryRun mode as well