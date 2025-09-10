/**
 * Plan–Act–Reflect example for robust RFP field extraction.
 *
 * This single file demonstrates a small, production-minded agent that:
 * - Plans which field to extract next (based on uncertainty).
 * - Acts using a small toolchain (regex, section finder, "LLM"-like heuristic).
 * - Reflects with validators and adjusts the plan when checks fail.
 *
 * The code is self-contained and runnable (ts-node). It mocks OCR/LLM with
 * deterministic helpers and keeps types tight. Heavy inline comments explain
 * what, how, and why, including tradeoffs and alternatives.
 */

// ----------------------------- Types & Models ------------------------------

type Field = 'dueDate' | 'budget' | 'preBidRequired' | 'contactEmail' | 'deliveryMethod';

type Tool = 'section' | 'table' | 'regex' | 'llm';

type Step = {
  field: Field;
  hint?: string;
  tool: Tool;
};

type ActionArtifact = {
  field: Field;
  value: unknown;
  evidence: string;
  tool: Tool;
  hint?: string;
};

type Issue = {
  field: Field;
  message: string;
  evidence?: string;
};

type HistoryEntry = {
  step: Step;
  artifact: ActionArtifact | null;
  issues: Issue[];
  planAdjustment?: Step | null;
};

type ExtractionResult = {
  values: Partial<Record<Field, unknown>>;
  evidence: Partial<Record<Field, string>>;
  stopReason: string;
  steps: number;
  history: HistoryEntry[];
};

type ParsedDoc = {
  text: string;
  sections: Record<string, string>;
  locale: string; // e.g., "en-US"
  timezone?: string; // inferred from doc
  publishDate?: Date;
  publishDateText?: string;
};

/**
 * Context holds in-progress values, their evidence, and book-keeping for reflection.
 * This keeps state explicit and testable. The agent updates this on every loop.
 */
type Context = {
  values: Partial<Record<Field, unknown>>;
  evidence: Partial<Record<Field, string>>;
  publishDate?: Date;
  publishDateText?: string;
  timezone?: string;
  // failure counts help detect stagnation
  failureCounts: Map<Field, number>;
  history: HistoryEntry[];
};

// ------------------------------ Mock Document ------------------------------
/**
 * The sample document intentionally contains:
 * - Publish date after "Questions due" to trigger a due-date validator failure
 *   on first pass.
 * - Two budget figures, a large sample ($1,000,000) and the real cap ($100,000)
 *   with "not-to-exceed" phrasing. The agent should learn to prefer the latter.
 * - Mandatory site visit phrasing for preBidRequired.
 * - Clear email and delivery method text.
 */
const SAMPLE_TEXT = `
City of Springfield (EST)
Published: March 3, 2024

SCHEDULE
Questions due: March 1, 2024 5:00 PM
Bids due: March 5, 2024 2:00 PM EST

BUDGET
Sample Form Example Amount: $1,000,000
Not-to-Exceed (NTE) Budget: $100,000 USD

POLICIES
A mandatory pre-bid site visit is required. Vendors must attend.

SUBMISSION
Proposals must be submitted online via the City Portal. Email submissions will not be accepted.

CONTACT
For questions, email procurement@springfield.gov or call 555-0100.
`;

// ----------------------- Lightweight Parsing & Indexing --------------------
/**
 * parseDoc creates an indexed view of the raw text so tools can work cheaply:
 * - Splits into coarse sections by simple uppercase headers.
 * - Extracts publish date and timezone hints early since validators depend on them.
 *
 * Tradeoff:
 * - This is intentionally simple; production systems may build richer structure
 *   (token offsets, tables, footnotes). Start small and add only if validated by need.
 */
function parseDoc(text: string): ParsedDoc {
  const sections: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let current = 'ROOT';
  for (const line of lines) {
    if (/^[A-Z][A-Z\s]{2,}$/.test(line.trim())) {
      current = line.trim();
      sections[current] = '';
    } else {
      sections[current] = (sections[current] ?? '') + line + '\n';
    }
  }
  const timezone = /EST|EDT|PST|CST|UTC/i.test(text) ? 'America/New_York' : 'UTC';
  const pubMatch = /Published:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(text);
  const publishDate = pubMatch ? new Date(pubMatch[1]) : undefined;
  return {
    text,
    sections,
    locale: 'en-US',
    timezone,
    publishDate,
    publishDateText: pubMatch?.[0],
  };
}

// ------------------------------- Tools (Act) -------------------------------
/**
 * Each tool focuses on one small job. Keeping tools small and predictable
 * makes reflection easier: validators can point directly to specific evidence.
 * These tools are deterministic mocks—fast and dependency-free.
 */

function findSection(doc: ParsedDoc, hint: string): { value: string; evidence: string } {
  const key = Object.keys(doc.sections).find((k) => k.includes('SCHEDULE') || k.includes('BUDGET') || k.includes('SUBMISSION')) ?? 'ROOT';
  return { value: doc.sections[key] ?? doc.text, evidence: `Section:${key} (hint:${hint})` };
}

function parseBudgetTable(doc: ParsedDoc): { value: number | null; evidence: string } {
  // Prefer lines with "Not-to-Exceed" or "NTE" near currency; deprioritize "Sample"
  const candidates: Array<{ amount: number; evidence: string; score: number }> = [];
  for (const line of doc.text.split(/\r?\n/)) {
    const money = /(\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/.exec(line);
    if (!money) continue;
    const raw = money[1].replace(/[\$,]/g, '');
    const amount = Number(raw);
    if (!isFinite(amount)) continue;
    const lc = line.toLowerCase();
    let score = 0;
    if (/(not[- ]?to[- ]?exceed|nte|cap|max(imum)?)/i.test(line)) score += 5;
    if (/sample|example|form/i.test(line)) score -= 3;
    if (/budget|cost/i.test(line)) score += 1;
    candidates.push({ amount, evidence: line.trim(), score });
  }
  if (candidates.length === 0) return { value: null, evidence: 'No currency found' };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { value: best.amount, evidence: best.evidence };
}

function regexExtract(doc: ParsedDoc, field: Field, hint?: string): { value: unknown; evidence: string } {
  const scope = hint ? doc.text.replace(/\s+/g, ' ') : doc.text;
  switch (field) {
    case 'contactEmail': {
      const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(scope);
      return { value: m?.[0] ?? null, evidence: m?.[0] ?? 'email not found' };
    }
    case 'deliveryMethod': {
      const line = doc.sections['SUBMISSION'] ?? doc.text;
      if (/online/i.test(line)) return { value: 'online', evidence: line.trim() };
      if (/in[- ]?person/i.test(line)) return { value: 'in-person', evidence: line.trim() };
      if (/mail|postal|courier/i.test(line)) return { value: 'mail', evidence: line.trim() };
      return { value: null, evidence: 'submission method not found' };
    }
    case 'preBidRequired': {
      const s = doc.text;
      if (/mandatory\s+pre[- ]?bid|site visit.*required/i.test(s)) return { value: true, evidence: 'mandatory pre-bid/site visit language' };
      if (/non[- ]mandatory|optional\s+pre[- ]?bid/i.test(s)) return { value: false, evidence: 'non-mandatory language' };
      return { value: null, evidence: 'pre-bid not specified' };
    }
    case 'budget': {
      const m = /(?:budget|not[- ]?to[- ]?exceed|NTE|cap|maximum).{0,30}?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i.exec(scope);
      const fallback = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/.exec(scope);
      const pick = m?.[1] ?? fallback?.[0] ?? null;
      return { value: pick ? Number(pick.replace(/[\$,]/g, '')) : null, evidence: m?.[0] ?? fallback?.[0] ?? 'no currency' };
    }
    case 'dueDate': {
      // Naive "due" pick; may grab Questions due first — good for triggering reflection.
      const m = /(?:proposal|bids?)\s+due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)/i.exec(scope)
        ?? /due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)/i.exec(scope);
      return { value: m ? new Date(m[1]) : null, evidence: m?.[0] ?? 'no due date phrase' };
    }
    default:
      return { value: null, evidence: 'unhandled field' };
  }
}

function llmExtract(doc: ParsedDoc, field: Field, hint?: string): { value: unknown; evidence: string } {
  // "LLM" stand-in: a second-pass heuristic that narrows scope by hint words
  // and applies stronger disambiguation rules. This mimics schema-constrained extraction.
  const narrowed = hint
    ? doc.text
        .split(/\r?\n/)
        .filter((l) => l.toLowerCase().includes(hint.toLowerCase()) || l.toLowerCase().includes(field.toLowerCase()))
        .join('\n')
    : doc.text;
  if (field === 'dueDate') {
    const best = /bids?\s+due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)/i.exec(narrowed);
    if (best) return { value: new Date(best[1]), evidence: best[0] };
  }
  if (field === 'budget') {
    const pref = /not[- ]?to[- ]?exceed.*?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i.exec(narrowed) || /NTE.*?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i.exec(narrowed);
    if (pref) return { value: Number(pref[1].replace(/[\$,]/g, '')), evidence: pref[0] };
  }
  return regexExtract(doc, field, hint);
}

async function act(step: Step, doc: ParsedDoc): Promise<ActionArtifact> {
  if (step.tool === 'section') {
    const r = findSection(doc, step.hint ?? step.field);
    return { field: step.field, value: r.value, evidence: r.evidence, tool: step.tool, hint: step.hint };
  }
  if (step.tool === 'table') {
    const r = parseBudgetTable(doc);
    return { field: step.field, value: r.value, evidence: r.evidence, tool: step.tool, hint: step.hint };
  }
  if (step.tool === 'regex') {
    const r = regexExtract(doc, step.field, step.hint);
    return { field: step.field, value: r.value, evidence: r.evidence, tool: step.tool, hint: step.hint };
  }
  const r = llmExtract(doc, step.field, step.hint);
  return { field: step.field, value: r.value, evidence: r.evidence, tool: step.tool, hint: step.hint };
}

// ------------------------------- Validators --------------------------------
/**
 * Validators turn reflection into grounded decisions. Keep them small,
 * composable, and return specific evidence so the planner can adjust.
 */
function validate(ctx: Context): Issue[] {
  const issues: Issue[] = [];
  const due = ctx.values.dueDate instanceof Date ? ctx.values.dueDate : null;
  const bud = typeof ctx.values.budget === 'number' ? ctx.values.budget : null;
  const email = typeof ctx.values.contactEmail === 'string' ? ctx.values.contactEmail : null;

  if (due && ctx.publishDate && due <= ctx.publishDate) {
    issues.push({ field: 'dueDate', message: 'Due date precedes publish date', evidence: ctx.evidence.dueDate });
  }
  if (bud !== null) {
    const text = ctx.evidence.budget ?? '';
    if (bud > 5_000_000 && !/(cap|max|not[- ]?to[- ]?exceed|NTE)/i.test(text)) {
      issues.push({ field: 'budget', message: 'Large value found without cap language', evidence: text });
    }
    if (!/\$|USD/i.test(text)) {
      issues.push({ field: 'budget', message: 'Budget missing explicit USD markers', evidence: text });
    }
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: 'contactEmail', message: 'Invalid email format', evidence: email });
  }
  return issues;
}

// -------------------------------- Planner ----------------------------------
/**
 * Planner chooses the next best step. Heuristics:
 * - Prefer fields not yet set or those flagged by issues.
 * - Start with fields with cheap checks and high leverage (dueDate, budget).
 * - Attach hints to focus the tools; escalate tool strength if prior attempts failed.
 */
function planNext(ctx: Context, outstandingIssues: Issue[], doc: ParsedDoc): Step | null {
  const order: Field[] = ['dueDate', 'budget', 'preBidRequired', 'contactEmail', 'deliveryMethod'];
  const invalid = new Set(outstandingIssues.map((i) => i.field));

  // Promote fields with issues to the front
  const candidates = order.filter((f) => ctx.values[f] == null || invalid.has(f));
  if (candidates.length === 0) return null;

  const field = candidates[0];
  const fails = ctx.failureCounts.get(field) ?? 0;

  // Hints tailored by field and any issue messages
  const hintMap: Record<Field, string> = {
    dueDate: fails === 0 ? 'proposal due' : 'bids due',
    budget: fails === 0 ? 'budget' : 'not-to-exceed',
    preBidRequired: 'mandatory pre-bid',
    contactEmail: 'contact email',
    deliveryMethod: 'submission method',
  };

  // Tool escalation strategy:
  // regex -> llm (heuristic) -> section/table for structure-aware scanning
  let tool: Tool = 'regex';
  if (field === 'budget' && fails >= 1) tool = 'table';
  else if (field === 'dueDate' && fails >= 1) tool = 'llm';
  else if (fails >= 2) tool = 'section';

  return { field, hint: hintMap[field], tool };
}

// ----------------------------- Reflection Loop -----------------------------
/**
 * runExtraction implements Plan–Act–Reflect:
 * - Loop until all fields valid OR bounds reached.
 * - After every action, run validators; if a field fails, record issue and adjust plan.
 * - Detect stagnation by counting repeated failures per field.
 *
 * Termination bounds:
 * - All fields valid OR 8 steps OR ~20 seconds OR repeated same failure twice.
 *
 * Design choices:
 * - Pure functions for tools/validators keep the core loop readable and testable.
 * - Context is immutable-ish (reassigned fields) to avoid hidden side effects.
 */
async function runExtraction(doc: ParsedDoc): Promise<ExtractionResult> {
  const start = Date.now();
  const ctx: Context = {
    values: {},
    evidence: {},
    publishDate: doc.publishDate,
    publishDateText: doc.publishDateText,
    timezone: doc.timezone,
    failureCounts: new Map(),
    history: [],
  };

  let steps = 0;
  while (steps < 8 && Date.now() - start < 20_000) {
    // Plan based on current context and any outstanding issues from last iteration
    const lastIssues = ctx.history.at(-1)?.issues ?? [];
    const step = planNext(ctx, lastIssues, doc);
    if (!step) break;

    // Act using the chosen tool
    const artifact = await act(step, doc);

    // Write result only if it targets a concrete field value (ignore 'section' outputs)
    if (step.field && artifact.value !== null && step.tool !== 'section') {
      ctx.values[step.field] = artifact.value as any;
      ctx.evidence[step.field] = artifact.evidence;
    }

    // Reflect with validators
    const issues = validate(ctx);
    const related = issues.filter((i) => i.field === step.field);

    // Stagnation tracking: increment failure count if the same field keeps failing
    if (related.length > 0) {
      ctx.failureCounts.set(step.field, (ctx.failureCounts.get(step.field) ?? 0) + 1);
    } else {
      ctx.failureCounts.delete(step.field);
    }

    // Adjust plan hint/tool when a validator flags a problem
    let planAdjustment: Step | null = null;
    if (related.length > 0) {
      if (step.field === 'dueDate') {
        planAdjustment = { field: 'dueDate', hint: 'bid opening OR bids due', tool: 'llm' };
      } else if (step.field === 'budget') {
        planAdjustment = { field: 'budget', hint: 'not-to-exceed', tool: 'table' };
      } else if (step.field === 'preBidRequired') {
        planAdjustment = { field: 'preBidRequired', hint: 'mandatory OR non-mandatory', tool: 'llm' };
      }
      // Clear the suspect value to encourage a fresh attempt
      delete ctx.values[step.field];
    }

    ctx.history.push({ step, artifact, issues, planAdjustment });
    steps++;

    // Early termination: if the same field failed twice, stop for human review
    const stagnating = Array.from(ctx.failureCounts.entries()).some(([, c]) => c >= 2);
    const allValid = ['dueDate', 'budget', 'preBidRequired', 'contactEmail', 'deliveryMethod'].every((f) => ctx.values[f as Field] != null) && issues.length === 0;
    if (allValid) return { values: ctx.values, evidence: ctx.evidence, stopReason: 'all fields valid', steps, history: ctx.history };
    if (stagnating) return { values: ctx.values, evidence: ctx.evidence, stopReason: 'stagnation detected', steps, history: ctx.history };
  }

  const reason = steps >= 8 ? 'step limit' : Date.now() - start >= 20_000 ? 'time limit' : 'no plan';
  return { values: ctx.values, evidence: ctx.evidence, stopReason: reason, steps, history: ctx.history };
}

// ---------------------------------- Demo -----------------------------------
/**
 * The usage example demonstrates an end-to-end run on SAMPLE_TEXT.
 * It prints:
 * - Final extracted values
 * - Evidence (snippets) that supported each value
 * - Stop reason and a compact history of steps
 *
 * Best practices shown:
 * - Log concise artifacts and rationales; this enables auditability.
 * - Separate values from evidence so later reviewers can verify the source.
 */
async function main(): Promise<void> {
  const doc = parseDoc(SAMPLE_TEXT);
  const result = await runExtraction(doc);

  console.log('== Extracted Values ==');
  console.log({
    dueDate: result.values.dueDate instanceof Date ? (result.values.dueDate as Date).toISOString() : result.values.dueDate,
    budget: result.values.budget,
    preBidRequired: result.values.preBidRequired,
    contactEmail: result.values.contactEmail,
    deliveryMethod: result.values.deliveryMethod,
  });

  console.log('\n== Evidence ==');
  console.log(result.evidence);

  console.log('\n== Stop Reason & Steps ==');
  console.log({ stopReason: result.stopReason, steps: result.steps });

  console.log('\n== History (compact) ==');
  for (const h of result.history) {
    console.log({
      step: h.step,
      value: h.artifact?.value,
      evidence: h.artifact?.evidence,
      issues: h.issues.map((i) => `${i.field}: ${i.message}`),
      planAdjustment: h.planAdjustment,
    });
  }
}

// Execute when run directly
main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});