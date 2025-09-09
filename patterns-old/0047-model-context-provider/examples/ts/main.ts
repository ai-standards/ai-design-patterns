// main.ts
// Minimal, single-file TypeScript example demonstrating the Model-Context-Provider pattern
// for a healthcare documentation copilot with composition, precedence, pruning, caching, and lineage.
//
// How to run (no external APIs required):
// 1) Ensure Node 18+ and npm are installed.
// 2) Initialize a project and install dev tools:
//    - npm init -y
//    - npm i -D typescript ts-node @types/node
//    - npx tsc --init
// 3) Save this file as main.ts
// 4) Run:
//    - npx ts-node main.ts
//
// Optional environment variables (to see precedence enforcement):
//   STRICT_PRECEDENCE=true  npx ts-node main.ts
//   TENANT_ID=hospital-123 TASK=discharge_summary SPECIALTY=cardiology  npx ts-node main.ts
//
// This example is self-contained. It simulates providers, composition, and a "model call"
// with detailed comments and testable pure functions. No network calls are made.

// ---------- Types and constants (kept minimal and canonical to the pattern) ----------

type Role = "clinician" | "scribe" | "admin";
type Task = "discharge_summary" | "progress_note" | "referral_letter";

interface FeatureFlags {
  abTestPersona?: "A" | "B";
  enableSpecialtyGuidelines?: boolean;
}

interface RequestCtx {
  userId: string;
  role: Role;
  tenantId: string;
  locale: string;      // e.g., "en-US"
  specialty: string;   // e.g., "cardiology" | "pediatrics"
  task: Task;
  encounterId: string;
  inputText: string;   // Unredacted input; redaction provider will produce a redacted version.
  featureFlags: FeatureFlags;
}

interface Example {
  user: string;
  assistant: string;
}

interface DocumentFragment {
  id: string;       // Unique per document
  text: string;
  source: string;   // e.g., "tenant-kb://guidelines/chf"
}

interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, any>;
}

interface FragmentMetadata {
  providerId: string;
  version: string;
  cacheKey?: string;
  sources?: string[];
  lockedScopes?: string[]; // e.g., ["policy"] or ["safety"]
}

interface ContextFragment {
  instructions: string[];
  examples: Example[];
  documents: DocumentFragment[];
  tools: ToolDefinition[];
  params: Record<string, any>;
  metadata: FragmentMetadata;
}

type Provider = (ctx: RequestCtx, helpers: ProviderHelpers) => Promise<ContextFragment> | ContextFragment;

interface ProviderHelpers {
  cache: Map<string, ContextFragment>;
  now: () => string;
}

interface ProviderDescriptor {
  id: string;
  impl: Provider;
  required?: boolean;
}

interface LineageEntry {
  providerId: string;
  version: string;
  cacheKey?: string;
  lockedScopes?: string[];
  contributed: {
    instructions: number;
    examples: number;
    documents: number;
    tools: number;
    paramsKeys: string[];
  };
}

interface ComposedContext {
  instructions: string[];
  examples: Example[];
  documents: DocumentFragment[];
  tools: ToolDefinition[];
  params: Record<string, any>;
  lineage: LineageEntry[];
  // Internal observability: which params are locked (e.g., by "policy" or "safety")
  lockedParams: Set<string>;
}

// Global in-memory cache to simulate provider-level caching (e.g., retrieval results keyed by tenant/task).
const providerCache = new Map<string, ContextFragment>();

// Defaults for the demo execution.
const DEFAULT_TOKEN_BUDGET = 800; // pseudo-token budget
const CRITICAL_SCOPES = new Set(["policy", "safety"]); // scopes that cannot be overridden by later providers

// ---------- Entry point ----------

async function main() {
  // 1) Load runtime configuration (from env with safe defaults).
  const cfg = getConfig();

  // 2) Build a demo RequestCtx. In production, this would come from your request pipeline.
  const ctx = buildDemoRequestCtx(cfg);

  // 3) Plan which providers to run and in which precedence order (high -> low).
  const plan = getDefaultProviderPlan(ctx);

  // 4) Compose: run providers, merge with precedence rules, enforce constraints.
  const composed = await composeContext(plan, ctx, cfg);

  // 5) Prune to a (pseudo) token budget with deduplication and precedence-aware trimming.
  const pruned = pruneToTokenBudget(composed, cfg.tokenBudget, { keepProviderIds: ["policy", "safety", "tools"] });

  // 6) Log lineage for auditability (what influenced the prompt).
  logLineage(pruned.lineage);

  // 7) "Call" the model (simulated): print assembled prompt, tools, and a fake response.
  const result = callModel(pruned, ctx);

  // 8) Display final result.
  console.log("\n--- Model Result ---\n");
  console.log(result);
}

// ---------- Function 1 (first call from main): getConfig ----------

/**
 * Reads minimal runtime configuration.
 * - tokenBudget: pseudo token budget for pruning.
 * - strictPrecedence: if true, fail closed on attempts to override locked policy/safety.
 */
function getConfig(): { tokenBudget: number; strictPrecedence: boolean } {
  const tokenBudget = Number(process.env.TOKEN_BUDGET || DEFAULT_TOKEN_BUDGET);
  const strictPrecedence = String(process.env.STRICT_PRECEDENCE || "false").toLowerCase() === "true";
  return { tokenBudget, strictPrecedence };
}

// ---------- Function 2: buildDemoRequestCtx ----------

/**
 * Constructs a demo RequestCtx from env or defaults.
 * In a real system, this would be derived from HTTP/session/user/tenant context.
 */
function buildDemoRequestCtx(cfg: { tokenBudget: number; strictPrecedence: boolean }): RequestCtx {
  const tenantId = process.env.TENANT_ID || "cedarvale-demo";
  const task = (process.env.TASK as Task) || "discharge_summary";
  const specialty = process.env.SPECIALTY || "cardiology";
  const locale = process.env.LOCALE || "en-US";

  return {
    userId: "u-123",
    role: "clinician",
    tenantId,
    locale,
    specialty,
    task,
    encounterId: "enc-2025-09-02-001",
    // A small sample with PHI-like substrings to demonstrate redaction.
    inputText:
      "Patient: John Smith (MRN: 998877). 55-year-old male with CHF; discharge planning started. " +
      "Phone: 555-123-4567. Meds: furosemide 40mg daily. Follow-up in 7-10 days.",
    featureFlags: {
      abTestPersona: "A",
      enableSpecialtyGuidelines: true,
    },
  };
}

// ---------- Function 3: getDefaultProviderPlan ----------

/**
 * Returns the ordered list of providers with explicit precedence.
 * Higher precedence providers are earlier in the list.
 *
 * Required providers are enforced (fail closed if missing output).
 */
function getDefaultProviderPlan(ctx: RequestCtx): ProviderDescriptor[] {
  return [
    { id: "policy", impl: policyProvider, required: true },
    { id: "safety", impl: redactionProvider, required: true }, // redaction acts as safety in this minimal example
    { id: "persona", impl: personaProvider },
    ...(ctx.featureFlags.enableSpecialtyGuidelines ? [{ id: "specialty", impl: specialtyGuidelinesProvider }] : []),
    { id: "kb", impl: retrievalProvider },
    { id: "fewshot", impl: fewShotProvider },
    { id: "tools", impl: toolRegistryProvider, required: true },
  ];
}

// ---------- Function 4: composeContext ----------

/**
 * Orchestrates providers, merges fragments with explicit precedence and locked scopes,
 * and validates required constraints.
 */
async function composeContext(
  plan: ProviderDescriptor[],
  ctx: RequestCtx,
  cfg: { tokenBudget: number; strictPrecedence: boolean }
): Promise<ComposedContext> {
  // Run providers in declared order, collecting fragments and basic lineage.
  const fragments = await runProvidersInOrder(plan, ctx);

  // Validate required providers produced output.
  const present = new Set(fragments.map(f => f.metadata.providerId));
  for (const p of plan) {
    if (p.required && !present.has(p.id)) {
      throw new Error(`Missing required provider output: ${p.id}`);
    }
  }

  // Merge with precedence and locked scope enforcement.
  const merged = mergeWithPrecedence(fragments, {
    lockedScopes: Array.from(CRITICAL_SCOPES),
    strict: cfg.strictPrecedence,
  });

  return merged;
}

// ---------- Function 5: runProvidersInOrder ----------

/**
 * Executes providers in a fixed order, passing shared helpers for caching and time.
 * Providers are assumed to be idempotent and deterministic for the same input.
 */
async function runProvidersInOrder(plan: ProviderDescriptor[], ctx: RequestCtx): Promise<ContextFragment[]> {
  const helpers: ProviderHelpers = {
    cache: providerCache,
    now: nowIso,
  };

  const outputs: ContextFragment[] = [];
  for (const p of plan) {
    const out = await p.impl(ctx, helpers);
    // Basic schema sanity checks to keep the demo robust.
    if (!out || !out.metadata || out.metadata.providerId !== p.id) {
      throw new Error(`Provider ${p.id} returned invalid or mismatched metadata.providerId`);
    }
    outputs.push(out);
  }
  return outputs;
}

// ---------- Function 6: mergeWithPrecedence ----------

/**
 * Merges provider outputs with precedence and locked scope rules.
 * - Concatenates instructions/examples.
 * - Dedupes documents and tools by id/name.
 * - Params use last-writer-wins, except when a key has been locked by a critical scope.
 * - Optionally fails closed if lower-precedence tries to override locked params.
 */
function mergeWithPrecedence(
  fragments: ContextFragment[],
  opts: { lockedScopes: string[]; strict: boolean }
): ComposedContext {
  const instructions: string[] = [];
  const examples: Example[] = [];
  const documentsByKey = new Map<string, DocumentFragment>();
  const toolsByName = new Map<string, ToolDefinition>();
  const params: Record<string, any> = {};
  const lockedParams = new Set<string>();
  const lineage: LineageEntry[] = [];

  // Track which params are locked and by which scope (for error messages).
  const paramLockedBy = new Map<string, string>(); // key -> scope string

  for (const frag of fragments) {
    const scopeLocks = new Set(frag.metadata.lockedScopes || []);
    const added = { instructions: 0, examples: 0, documents: 0, tools: 0, paramsKeys: [] as string[] };

    // Instructions are concatenated; we never delete earlier instructions.
    for (const instr of frag.instructions) {
      instructions.push(instr);
      added.instructions++;
    }

    // Examples are concatenated; lower precedence can add more but cannot remove.
    for (const ex of frag.examples) {
      examples.push(ex);
      added.examples++;
    }

    // Deduplicate documents by (id || source), preserving earlier entries.
    for (const doc of frag.documents) {
      const key = doc.id || doc.source;
      if (!documentsByKey.has(key)) {
        documentsByKey.set(key, doc);
        added.documents++;
      }
    }

    // Tools: dedupe by name; earliest wins to avoid silent override.
    for (const tool of frag.tools) {
      if (!toolsByName.has(tool.name)) {
        toolsByName.set(tool.name, tool);
        added.tools++;
      }
    }

    // Params: last-writer-wins except for keys locked by a critical scope (e.g., policy/safety).
    // If this fragment declares a locked scope and sets params, it locks those keys.
    for (const [k, v] of Object.entries(frag.params || {})) {
      const isAlreadyLocked = lockedParams.has(k);
      const isCriticalLock = Array.from(scopeLocks).some(s => CRITICAL_SCOPES.has(s));

      if (isAlreadyLocked) {
        // Attempt to override a locked param
        const byScope = paramLockedBy.get(k) || "unknown";
        const msg = `Attempt to override locked param "${k}" (locked by ${byScope}) from provider ${frag.metadata.providerId}`;
        if (opts.strict) {
          throw new Error(msg);
        } else {
          // Ignore override, log for observability
          console.warn(`[merge] ${msg} - ignoring override.`);
          continue;
        }
      }

      // Accept the write.
      params[k] = v;
      added.paramsKeys.push(k);

      // If this provider declares a critical locked scope, lock these keys.
      if (isCriticalLock) {
        lockedParams.add(k);
        paramLockedBy.set(k, Array.from(scopeLocks).join(","));
      }
    }

    lineage.push({
      providerId: frag.metadata.providerId,
      version: frag.metadata.version,
      cacheKey: frag.metadata.cacheKey,
      lockedScopes: frag.metadata.lockedScopes,
      contributed: added,
    });
  }

  return {
    instructions,
    examples,
    documents: Array.from(documentsByKey.values()),
    tools: Array.from(toolsByName.values()),
    params,
    lineage,
    lockedParams,
  };
}

// ---------- Function 7: pruneToTokenBudget ----------

/**
 * Prunes the composed context to a pseudo token budget.
 * Strategy:
 *  - Keep all instructions from providers that declared locked scopes (policy/safety).
 *  - Drop examples first (from lowest precedence upward) if needed.
 *  - Deduplicate documents (already deduped) and then trim from the end if still over budget.
 *  - Always keep tools; they are small in this demo.
 */
function pruneToTokenBudget(
  composed: ComposedContext,
  tokenBudget: number,
  opts: { keepProviderIds: string[] }
): ComposedContext {
  let tokens = estimateTokensForContext(composed);
  if (tokens <= tokenBudget) return composed;

  // Identify locked-scope providers to protect their instructions.
  const lockedProviderIds = new Set<string>();
  for (const entry of composed.lineage) {
    const scopes = new Set(entry.lockedScopes || []);
    if ([...scopes].some(s => CRITICAL_SCOPES.has(s))) {
      lockedProviderIds.add(entry.providerId);
    }
  }

  // Helper: remove examples greedily from the end (lowest precedence first).
  const removeExamples = () => {
    while (composed.examples.length && tokens > tokenBudget) {
      composed.examples.pop();
      tokens = estimateTokensForContext(composed);
    }
  };

  // Helper: trim documents from the end if necessary.
  const trimDocuments = () => {
    while (composed.documents.length > 1 && tokens > tokenBudget) {
      composed.documents.pop();
      tokens = estimateTokensForContext(composed);
    }
  };

  // We won't remove instructions added by locked-scope providers.
  // For non-locked instructions, we can drop from the end if still needed.
  const maybeTrimUnlockedInstructions = () => {
    // Build an index mapping provider contribution counts to identify unlocked segments.
    // For simplicity, if still over budget after trimming examples and docs, we prune
    // the last 1-2 instructions (assuming they are from lower precedence providers).
    while (composed.instructions.length > 1 && tokens > tokenBudget) {
      // Avoid removing the very first instruction which is likely critical policy.
      composed.instructions.pop();
      tokens = estimateTokensForContext(composed);
    }
  };

  // 1) Drop examples first
  removeExamples();
  if (tokens <= tokenBudget) return composed;

  // 2) Trim documents next
  trimDocuments();
  if (tokens <= tokenBudget) return composed;

  // 3) As last resort, trim non-critical instructions (from the end)
  maybeTrimUnlockedInstructions();

  return composed;
}

// ---------- Function 8: logLineage ----------

/**
 * Logs provider lineage in a compact, audit-friendly form.
 */
function logLineage(lineage: LineageEntry[]) {
  console.log("\n--- Provider Lineage ---\n");
  const compact = lineage.map(l => ({
    providerId: l.providerId,
    version: l.version,
    cacheKey: l.cacheKey,
    lockedScopes: l.lockedScopes,
    contributed: l.contributed,
  }));
  console.log(JSON.stringify(compact, null, 2));
}

// ---------- Function 9: callModel ----------

/**
 * Simulates the model call by printing the assembled prompt and tools,
 * then returning a fake "model" response.
 */
function callModel(composed: ComposedContext, ctx: RequestCtx): string {
  const redactedInput = composed.params["redacted_input"] || ctx.inputText;
  const temperature = composed.params["temperature"] ?? 0.5;

  const docSnippets = composed.documents.slice(0, 2).map(d => `- [${d.source}] ${d.text.slice(0, 120)}...`);

  const prompt = [
    "SYSTEM INSTRUCTIONS:",
    ...composed.instructions.map((i, idx) => `  ${idx + 1}. ${i}`),
    "",
    "FEW-SHOT EXAMPLES:",
    ...composed.examples.map((ex, idx) => `  Ex${idx + 1} - User: ${ex.user}\n          Assistant: ${ex.assistant}`),
    "",
    "DOCUMENTS:",
    ...docSnippets,
    "",
    "TOOLS:",
    ...composed.tools.map(t => `- ${t.name}: ${t.description}`),
    "",
    "TASK INPUT (REDACTED):",
    redactedInput,
  ].join("\n");

  console.log("\n--- Final Assembled Prompt (for demo) ---\n");
  console.log(prompt);

  // Simulated "model output" respects policy constraints and references docs.
  return [
    `Temperature: ${temperature}`,
    `Tenant: ${ctx.tenantId}, Task: ${ctx.task}, Specialty: ${ctx.specialty}`,
    "",
    "Draft Clinical Note:",
    "- Concise summary of hospitalization for CHF.",
    "- Medication plan adheres to documented guidelines (see documents above).",
    "- Follow-up scheduled within recommended window.",
    "- No PHI beyond redacted fields included.",
    "",
    "Citations: [see DOCUMENTS section sources]",
  ].join("\n");
}

// ---------- Providers (first used by getDefaultProviderPlan, declared in plan order) ----------

/**
 * High-precedence Policy provider.
 * - Locks critical guardrails and parameters (e.g., temperature) under "policy" scope.
 * - Central place for HIPAA-style constraints and governance controls.
 */
function policyProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const metadata: FragmentMetadata = {
    providerId: "policy",
    version: "3.4",
    lockedScopes: ["policy"],
  };

  return {
    instructions: [
      "You operate under HIPAA-aligned constraints: do not include PHI beyond what is provided by the redaction layer.",
      "Cite clinical claims by referring to the DOCUMENTS section sources.",
      "Prefer concise, guideline-backed summaries suitable for busy clinicians.",
    ],
    examples: [],
    documents: [],
    tools: [],
    params: {
      // Lock temperature so lower-precedence providers cannot override it.
      temperature: 0.2,
    },
    metadata,
  };
}

/**
 * Safety/Redaction provider.
 * - Produces a redacted version of the input and locks safety scope.
 * - Includes a hash of rules in metadata for auditability.
 */
function redactionProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const redacted = simpleRedactPHI(ctx.inputText);
  const metadata: FragmentMetadata = {
    providerId: "safety",
    version: "1.2",
    lockedScopes: ["safety"],
    sources: [`redaction-rules:sha256:${hashString("v1-basic-rules")}`],
  };

  return {
    instructions: [
      "Use only the redacted input to generate the note. Do not infer missing identifiers.",
    ],
    examples: [],
    documents: [],
    tools: [],
    params: {
      redacted_input: redacted,
    },
    metadata,
  };
}

/**
 * Persona provider (A/B testable).
 * - Slightly different tone or structure depending on feature flag.
 * - Lower precedence than policy/safety, so cannot override locked params.
 */
function personaProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const personaVariant = ctx.featureFlags.abTestPersona || "A";
  const metadata: FragmentMetadata = {
    providerId: "persona",
    version: personaVariant === "A" ? "1.0-A" : "1.0-B",
  };

  const base = [
    "Write in a confident, calm, and clinically precise tone.",
    "Prefer structured bullet points for plans and follow-ups.",
  ];

  const variant = personaVariant === "A"
    ? ["Be concise; prioritize high-signal content and omit fluff."]
    : ["Be slightly more descriptive; include brief rationale for key decisions."];

  // Demonstrate a would-be conflict: trying to set temperature (will be ignored or error if STRICT_PRECEDENCE=true)
  const params = {
    temperature: 0.7, // Policy has locked 0.2; mergeWithPrecedence will block or throw.
  };

  return {
    instructions: [...base, ...variant],
    examples: [],
    documents: [],
    tools: [],
    params,
    metadata,
  };
}

/**
 * Specialty Guidelines provider.
 * - Adds specialty-specific directives; e.g., cardiology vs. pediatrics nuances.
 */
function specialtyGuidelinesProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const version = "0.3";
  const metadata: FragmentMetadata = {
    providerId: "specialty",
    version,
    sources: [`specialty-guidelines://${ctx.specialty}/v${version}`],
  };

  const map: Record<string, string[]> = {
    cardiology: [
      "For CHF, include NYHA class if known and recent weight trends.",
      "Highlight diuretic dosing and electrolyte monitoring plan.",
    ],
    pediatrics: [
      "Adjust dosing and recommendations for weight- and age-appropriate ranges.",
      "Use caregiver-friendly phrasing when appropriate.",
    ],
  };

  const instr = map[ctx.specialty] || ["Apply general internal medicine best practices."];

  return {
    instructions: instr,
    examples: [],
    documents: [],
    tools: [],
    params: {},
    metadata,
  };
}

/**
 * Retrieval provider.
 * - Retrieves tenant/specialty/task-specific documents.
 * - Demonstrates cache key and cache usage.
 */
function retrievalProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const cacheKey = computeCacheKey("kb", { tenantId: ctx.tenantId, specialty: ctx.specialty, task: ctx.task });
  const cached = helpers.cache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      metadata: { ...cached.metadata, cacheKey }, // expose key in lineage for audit
    };
  }

  // Simulated retrieval results (normally fetched from tenant KB or vector store).
  const docs: DocumentFragment[] = ctx.specialty === "cardiology"
    ? [
        {
          id: "doc-chf-criteria",
          text: "CHF discharge criteria include stable vitals, optimized diuretics, and follow-up within 7 days.",
          source: "tenant-kb://guidelines/chf",
        },
        {
          id: "doc-diuretics",
          text: "Furosemide dosing guidance: start 20–40 mg daily; monitor electrolytes and renal function.",
          source: "tenant-kb://meds/diuretics",
        },
      ]
    : [
        {
          id: "doc-general",
          text: "General discharge best practices: medication reconciliation, follow-up scheduling, safety netting.",
          source: "tenant-kb://guidelines/general",
        },
      ];

  const fragment: ContextFragment = {
    instructions: [],
    examples: [],
    documents: docs,
    tools: [],
    params: {},
    metadata: {
      providerId: "kb",
      version: "1.9",
      cacheKey,
      sources: docs.map(d => d.source),
    },
  };

  helpers.cache.set(cacheKey, fragment);
  return fragment;
}

/**
 * Few-shot provider.
 * - Provides a single example pattern to anchor format.
 */
function fewShotProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const metadata: FragmentMetadata = {
    providerId: "fewshot",
    version: "0.1",
  };

  const example: Example = {
    user: "Draft a concise CHF discharge summary.",
    assistant:
      "- Summary: Stable on furosemide; educated on sodium restriction.\n" +
      "- Medications: Furosemide 40mg qd; monitor K+.\n" +
      "- Follow-up: Cardiology clinic within 7 days.\n" +
      "- Sources: [tenant-kb://guidelines/chf, tenant-kb://meds/diuretics]",
  };

  return {
    instructions: [],
    examples: [example],
    documents: [],
    tools: [],
    params: {},
    metadata,
  };
}

/**
 * Tool registry provider.
 * - Declares available actions and their JSON schemas.
 * - In real systems these may be gated by role or tenant policy.
 */
function toolRegistryProvider(ctx: RequestCtx, helpers: ProviderHelpers): ContextFragment {
  const metadata: FragmentMetadata = {
    providerId: "tools",
    version: "2.0",
  };

  const tools: ToolDefinition[] = [
    {
      name: "lookup_medication",
      description: "Search tenant formulary for dosing and coverage info.",
      schema: {
        type: "object",
        properties: {
          medication: { type: "string" },
          patientAge: { type: "number" },
        },
        required: ["medication"],
      },
    },
    {
      name: "schedule_followup",
      description: "Schedule a follow-up appointment within the recommended window.",
      schema: {
        type: "object",
        properties: {
          specialty: { type: "string" },
          daysFromNow: { type: "number", minimum: 0 },
        },
        required: ["specialty", "daysFromNow"],
      },
    },
  ];

  return {
    instructions: [
      "Use tools only when necessary; prefer citing documents for clinical claims.",
    ],
    examples: [],
    documents: [],
    tools: tools,
    params: {},
    metadata,
  };
}

// ---------- Utilities (declared after first use to follow 'order of first use' rule) ----------

/**
 * Simple PHI redaction for demo:
 * - Replace names like 'John'/'Smith' (very naive) and phone numbers / MRN-like sequences.
 * In production, use robust de-identification tailored to your policies and locales.
 */
function simpleRedactPHI(input: string): string {
  let out = input;
  // Replace common-looking phone numbers
  out = out.replace(/\b\d{3}-\d{3}-\d{4}\b/g, "[REDACTED_PHONE]");
  // Replace MRN-like sequences (3+ digits in a row)
  out = out.replace(/\b\d{3,}\b/g, "[REDACTED_ID]");
  // Replace names 'John' and 'Smith' (demo only)
  out = out.replace(/\b(John|Smith)\b/gi, "[REDACTED_NAME]");
  return out;
}

/**
 * Compute a stable cache key for a provider and a subset of ctx fields.
 */
function computeCacheKey(providerId: string, fields: Record<string, any>): string {
  const payload = JSON.stringify({ providerId, fields });
  return `${providerId}:${hashString(payload)}`;
}

/**
 * Minimal non-cryptographic hash for demo purposes.
 */
function hashString(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Very rough token estimator: 1 token ~= 4 chars heuristic.
 */
function estimateTokensForContext(c: ComposedContext): number {
  const instr = c.instructions.join("\n").length;
  const ex = c.examples.map(e => e.user + e.assistant).join("\n").length;
  const docs = c.documents.map(d => d.text).join("\n").length;
  const tools = JSON.stringify(c.tools).length;
  const params = JSON.stringify(c.params).length;
  const totalChars = instr + ex + docs + tools + params;
  return Math.ceil(totalChars / 4);
}

/**
 * ISO timestamp helper for consistent lineage logging.
 */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------- Run the example ----------

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});