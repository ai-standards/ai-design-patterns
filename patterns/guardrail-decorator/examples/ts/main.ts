/**
// Guardrail Decorator Pattern — End-to-end, self-contained TypeScript example
//
// What this file demonstrates:
// - A "guardrail decorator" that wraps an LLM-like generation step with:
//   - Pre-validation/sanitization of inputs (defensive boundaries on logs).
//   - Post-validation of outputs (schema, safety policy, catalog constraints, and a link critic).
//   - A repair loop that feeds targeted hints back to the generator (instead of “asking nicely”).
//   - Strict JSON-only decoding and a conservative fallback when retries are exhausted.
// - Instrumentation and safe logging with redaction.
// - Production-leaning TypeScript best practices: explicit types, narrow error handling,
//   pure helpers, and no external network calls (LLM interaction is mocked).
//
// How it works:
// - guardedDraft() is the single entry point; callers pass a LogBundle and receive a TicketDraft.
// - It orchestrates a small retry loop (max 2 retries, 3 total attempts) and enforces a global timeout.
// - Each attempt generates a draft (via a fake LLM) and validates it. If invalid, the next attempt is
//   repaired with precise hints: allowed part IDs, torque ranges, required actions, etc.
// - If all attempts fail or time out, a schema-valid fallback template is returned, ensuring downstream
//   systems (e.g., CMMS) always receive a usable ticket.
//
// Why this design:
// - The generator remains simple (draft a ticket). The decorator carries the complexity needed for
//   reliability and safety. Policy and domain truth live outside the prompt, avoiding drift.
// - Machine-enforceable validators and targeted repair close the loop. This materially reduces
//   malformed outputs and unsafe advice without brittle prompt engineering.
//
// Tradeoffs and alternatives:
// - A schema-aware decoder (e.g., structured output parsing) could reduce JSON failures further,
//   but this example keeps dependencies minimal.
// - The mock LLM simulates “drift”; in production, connect a real model and keep the decorator intact.
// - Validators could be split by policy domain and versioned separately for auditability.
*/

// ---------- Types and domain models ----------

type ActionType = "lockout_tagout" | "inspect" | "reseat" | "replace" | "recalibrate";

interface ActionStep {
  type: ActionType; // repair or safety action
  partId?: string; // present when the action targets a specific part
  torqueNm?: number; // present when torque spec is needed
  citations: number[]; // indices of log lines justifying the step
}

interface PartLine {
  id: string;
  qty: number;
}

interface TicketDraft {
  version: "v1";
  robotId: string;
  parts: PartLine[];
  actions: ActionStep[];
  notes: string[]; // plain text notes; used by technicians
  policyTag: string; // e.g., "policy/warehouse-robot-safety@1"
}

interface LogBundle {
  robotId: string;
  vin: string; // treated as sensitive, never logged directly
  lines: string[]; // raw log lines from CAN bus, safety events, diagnostics
}

type Validator = (req: LogBundle, draft: TicketDraft) => string[];

interface PromptHints {
  allowedPartIds: string[];
  // torque ranges by part id; the generator should pick values inside these bounds
  torqueByPart: Record<string, { min: number; max: number }>;
  requireLockout: boolean;
  permittedActions: ActionType[];
}

// ---------- Catalog (domain truth) with helper predicates ----------

/**
// Centralizing allowed parts and torque ranges in code mimics production best practices:
// read from the same source of truth used by procurement. This prevents divergence between
// what the generator believes and what the system will accept.
*/
const catalog = (() => {
  const parts = new Map<string, { minTorque: number; maxTorque: number }>([
    ["BRK-128", { minTorque: 5, maxTorque: 8 }],
    ["BRK-129", { minTorque: 10, maxTorque: 12 }],
  ]);
  return {
    has: (id: string) => parts.has(id),
    inRange: (id: string, torque: number) => {
      const spec = parts.get(id);
      return !!spec && torque >= spec.minTorque && torque <= spec.maxTorque;
    },
    allIds: () => Array.from(parts.keys()),
    torqueWindow: (id: string) => parts.get(id) ?? { minTorque: 0, maxTorque: 0 },
  };
})();

// ---------- Utilities: sleep, safe logging, parsing ----------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
// Redact potentially sensitive identifiers before logging. In production, apply a robust policy.
// Here, only the VIN is redacted; the robotId is considered non-PII per assumption.
*/
function redact(value: string): string {
  return value.replace(/[A-Z0-9]/gi, "•").slice(0, 6);
}

/**
// Parse JSON safely and narrow errors; returns null on failure.
// Avoids throwing from deep inside loops and keeps control flow explicit.
*/
function safeParseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------- Validators (schema, safety, catalog, link critic) ----------

const schemaValidator: Validator = (_req, draft) => {
  const errs: string[] = [];
  if (draft.version !== "v1") errs.push("schema_version_invalid");
  if (!draft.robotId || typeof draft.robotId !== "string") errs.push("robot_id_missing");
  if (!Array.isArray(draft.parts)) errs.push("parts_not_array");
  if (!Array.isArray(draft.actions)) errs.push("actions_not_array");
  if (!Array.isArray(draft.notes)) errs.push("notes_not_array");
  if (!draft.policyTag) errs.push("policy_tag_missing");
  // Light structural checks inside arrays:
  draft.parts?.forEach((p, i) => {
    if (!p?.id || typeof p.id !== "string") errs.push(`part_id_missing:${i}`);
    if (!(Number.isInteger(p?.qty) && p.qty > 0)) errs.push(`part_qty_invalid:${i}`);
  });
  draft.actions?.forEach((a, i) => {
    if (!a?.type) errs.push(`action_type_missing:${i}`);
    if (!Array.isArray(a?.citations) || a.citations.length === 0) errs.push(`citations_missing:${i}`);
  });
  return errs;
};

const safetyGateValidator: Validator = (_req, draft) => {
  const errs: string[] = [];
  // Safety: banned phrases anywhere in notes are rejected outright
  const banned = [/bypass/i, /disable.*interlock/i];
  for (const note of draft.notes ?? []) {
    if (banned.some((re) => re.test(note))) errs.push("policy_banned_phrase");
  }
  // Safety: require lockout/tagout as the first step
  if (!(draft.actions?.[0]?.type === "lockout_tagout")) {
    errs.push("missing_lockout_tagout");
  }
  // Safety: ensure only permitted actions are used
  const permitted: ActionType[] = ["lockout_tagout", "inspect", "reseat", "replace", "recalibrate"];
  for (const [i, step] of (draft.actions ?? []).entries()) {
    if (!permitted.includes(step.type)) errs.push(`action_not_permitted:${i}:${step.type}`);
  }
  return errs;
};

const catalogValidator: Validator = (_req, draft) => {
  const errs: string[] = [];
  for (const p of draft.parts ?? []) if (!catalog.has(p.id)) errs.push(`unknown_part:${p.id}`);
  for (const [i, step] of (draft.actions ?? []).entries()) {
    if (step.partId && !catalog.has(step.partId)) errs.push(`unknown_part_in_action:${i}:${step.partId}`);
    if (typeof step.torqueNm === "number" && step.partId) {
      if (!catalog.inRange(step.partId, step.torqueNm)) errs.push(`torque_out_of_range:${step.partId}:${step.torqueNm}`);
    }
  }
  return errs;
};

const linkCriticValidator: Validator = (req, draft) => {
  const errs: string[] = [];
  const n = req.lines.length;
  for (const [i, step] of (draft.actions ?? []).entries()) {
    // Each action must cite at least one valid log line index
    if (!Array.isArray(step.citations) || step.citations.length === 0) {
      errs.push(`citation_missing:${i}`);
    } else if (!step.citations.every((idx) => Number.isInteger(idx) && idx >= 0 && idx < n)) {
      errs.push(`citation_invalid_index:${i}`);
    }
  }
  return errs;
};

function runValidators(req: LogBundle, draft: TicketDraft): string[] {
  // Order can matter: fail-fast on schema before deeper checks reduces noise
  const validators: Validator[] = [schemaValidator, safetyGateValidator, catalogValidator, linkCriticValidator];
  return validators.flatMap((v) => v(req, draft));
}

// ---------- Repair hinting: translate validator errors into concrete constraints ----------

function toRepairHints(errors: string[], req: LogBundle): Partial<PromptHints> {
  // Build a minimal set of actionable hints. Keep it machine-friendly.
  const hints: Partial<PromptHints> = {};
  if (errors.some((e) => e.startsWith("unknown_part"))) {
    hints.allowedPartIds = catalog.allIds();
  }
  if (errors.some((e) => e.startsWith("torque_out_of_range"))) {
    const torqueByPart: Record<string, { min: number; max: number }> = {};
    for (const id of catalog.allIds()) {
      const w = catalog.torqueWindow(id);
      torqueByPart[id] = { min: w.minTorque, max: w.maxTorque };
    }
    hints.torqueByPart = torqueByPart;
  }
  if (errors.includes("missing_lockout_tagout")) {
    hints.requireLockout = true;
  }
  // Always include permitted actions; gives the generator a clear, finite set.
  hints.permittedActions = ["lockout_tagout", "inspect", "reseat", "replace", "recalibrate"];
  // Hints could also include example citations; for brevity, trust the generator to cite within bounds 0..n-1.
  return hints;
}

// ---------- Prompt scaffolding (for the mocked generator) ----------

function prompt(req: LogBundle, hints: Partial<PromptHints>): string {
  // The mock generator will parse these hints from the string. A real system would pass structured args.
  return [
    "SYSTEM: Generate a JSON-only TicketDraft (version v1) for the CMMS.",
    "Strictly follow permitted actions and torque ranges if given.",
    `HINTS:${JSON.stringify(hints)}`,
    `LINES:${req.lines.length}`,
    // The model would also receive summarized logs; for brevity, omit full text here.
  ].join("\n");
}

// ---------- Mock LLM: deterministic “drift” followed by repair when hints arrive ----------

interface CompletionOptions {
  json: boolean;
  timeoutMs: number;
}

/**
// This mock simulates two behaviors:
// 1) On the first attempt (no actionable hints), it emits a flawed draft: unknown part,
//    torque outside spec, missing lockout_tagout, and weak citations.
// 2) When hints are present (allowed parts/torques and requireLockout), it corrects the output.
//
// The goal is to exercise the validator + repair loop without external dependencies.
*/
async function llmComplete(input: string, _opts: CompletionOptions): Promise<string> {
  await sleep(150); // simulate latency
  const hintsMatch = input.match(/HINTS:(\{.*\})/);
  const hints = hintsMatch ? safeParseJSON<Partial<PromptHints>>(hintsMatch[1]) ?? {} : {};
  const linesMatch = input.match(/LINES:(\d+)/);
  const nLines = linesMatch ? parseInt(linesMatch[1], 10) : 1;

  const base: Omit<TicketDraft, "policyTag"> & { policyTag?: string } = {
    version: "v1",
    robotId: "RB-42",
    parts: [],
    actions: [],
    notes: ["Auto-generated draft"],
    policyTag: "policy/warehouse-robot-safety@1",
  };

  const chooseCitation = () => Math.max(0, Math.min(nLines - 1, 0));

  // If no strong hints, return a flawed structure to trigger repair.
  const noHints =
    !hints ||
    (!hints.allowedPartIds && !hints.torqueByPart && !hints.requireLockout);

  if (noHints) {
    // Intentionally flawed: malformed JSON 10% of the time to simulate drift
    const flip = Date.now() % 10 === 0;
    if (flip) return '{"not":"json"'; // malformed

    // Unknown part and torque out of range; also no lockout step; citations missing.
    const flawed: TicketDraft = {
      ...base,
      parts: [{ id: "BRK-999", qty: 1 }],
      actions: [
        { type: "replace", partId: "BRK-999", torqueNm: 20, citations: [] },
        { type: "recalibrate", citations: [chooseCitation()] },
      ],
      notes: ["Consider bypass interlock to test"], // banned phrase
      policyTag: "policy/warehouse-robot-safety@1",
    };
    return JSON.stringify(flawed);
  }

  // With hints present, generate a compliant draft
  const goodPart = (hints.allowedPartIds && hints.allowedPartIds[0]) || "BRK-128";
  const torqueRange = hints.torqueByPart?.[goodPart] ?? { min: 5, max: 8 };
  const safeTorque = Math.round((torqueRange.min + torqueRange.max) / 2);

  const safe: TicketDraft = {
    ...base,
    parts: [{ id: goodPart, qty: 1 }],
    actions: [
      ...(hints.requireLockout ? [{ type: "lockout_tagout", citations: [chooseCitation()] as number[] }] : []),
      { type: "inspect", citations: [chooseCitation()] },
      { type: "replace", partId: goodPart, torqueNm: safeTorque, citations: [chooseCitation()] },
      { type: "recalibrate", citations: [chooseCitation()] },
    ],
    notes: ["Diagnostic code indicates actuator wear; replacing within spec."],
    policyTag: "policy/warehouse-robot-safety@1",
  };
  return JSON.stringify(safe);
}

// ---------- Input pre-validation / sanitization ----------

/**
// Enforce bounds on the incoming log bundle to prevent prompt bloat and PII leaks.
// - Truncates logs to a safe count.
// - Trims lines to a max length.
// - Returns a shallow-cloned, sanitized structure.
*/
function sanitizeInput(req: LogBundle): LogBundle {
  const MAX_LINES = 50;
  const MAX_LEN = 160;
  const lines = req.lines.slice(0, MAX_LINES).map((l) => l.slice(0, MAX_LEN));
  return { ...req, lines };
}

// ---------- Guarded generation with retry, repair, and fallback ----------

async function guardedDraft(req: LogBundle): Promise<TicketDraft> {
  const start = Date.now();
  const TIME_BUDGET_MS = 4000; // total budget across attempts
  const MAX_ATTEMPTS = 3; // first try + 2 retries

  const sanitized = sanitizeInput(req);
  let hints: Partial<PromptHints> = {};

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Enforce remaining time budget for this attempt (soft guard)
    const elapsed = Date.now() - start;
    if (elapsed >= TIME_BUDGET_MS) {
      console.warn("timeout_budget_exhausted", { robotId: sanitized.robotId, vin: redact(sanitized.vin) });
      return fallbackTemplate(sanitized);
    }

    const remaining = TIME_BUDGET_MS - elapsed;
    const perAttemptTimeout = Math.min(1200, remaining);

    let raw = "";
    try {
      raw = await llmComplete(prompt(sanitized, hints), { json: true, timeoutMs: perAttemptTimeout });
    } catch {
      // The mock never throws, but real clients should catch network/abort errors here.
      console.warn("llm_error", { attempt, robotId: sanitized.robotId });
      raw = "";
    }

    const draft = safeParseJSON<TicketDraft>(raw);
    const errors = draft ? runValidators(sanitized, draft) : ["json_malformed"];

    if (errors.length === 0) {
      console.info("guardrails_ok", {
        attempt,
        policyTag: draft.policyTag,
        robotId: sanitized.robotId,
      });
      return draft;
    }

    // Instrument failures with redaction and policy tagging for auditing
    console.warn("guardrails_violation", {
      attempt,
      errors,
      policyTag: draft?.policyTag ?? "policy/warehouse-robot-safety@1",
      robotId: sanitized.robotId,
      vin: redact(sanitized.vin),
    });

    // Prepare precise, machine-usable repair hints
    hints = toRepairHints(errors, sanitized);
  }

  // Retries exhausted: return conservative, schema-valid fallback
  console.warn("guardrails_fallback", { robotId: sanitized.robotId, vin: redact(sanitized.vin) });
  return fallbackTemplate(sanitized);
}

// ---------- Fallback: conservative, schema-valid ticket ----------

function fallbackTemplate(req: LogBundle): TicketDraft {
  // Provide only safe steps; avoid speculative torques/parts.
  return {
    version: "v1",
    robotId: req.robotId,
    parts: [],
    actions: [
      { type: "lockout_tagout", citations: [0].filter((i) => i < req.lines.length) },
      { type: "inspect", citations: [0].filter((i) => i < req.lines.length) },
    ],
    notes: ["Fallback: inspection required. No torque or replacement specified."],
    policyTag: "policy/warehouse-robot-safety@1",
  };
}

// ---------- Example usage ----------

async function main() {
  // Example logs that hint at a brake-related fault; in real systems, include structured fields.
  const req: LogBundle = {
    robotId: "RB-42",
    vin: "3CZRE38579G705123",
    lines: [
      "ERROR CAN: BRK actuator overcurrent on channel A (code E-OVC-12)",
      "WARN: intermittent encoder jitter detected",
      "INFO: safety interlock engaged",
    ],
  };

  const ticket = await guardedDraft(req);

  // Print the final ticket draft; in production, this is posted to a CMMS API
  console.log("final_ticket_draft", JSON.stringify(ticket, null, 2));
}

main().catch((err) => {
  console.error("fatal_error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});