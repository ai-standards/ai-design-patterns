# Guardrails for Warehouse Robot Tickets

## Company & Problem
CinderLift Robotics runs fleets of autonomous forklifts in large e‑commerce warehouses. The operations team built a service that turns raw fault logs into maintenance tickets for the CMMS. The model reads CAN bus errors, safety events, and diagnostic text, then proposes a repair with parts and torque specs, output as strict JSON.

Reality didn’t fit the spreadsheet. Under load, the model drifted: malformed JSON, torque values outside spec, and the occasional unsafe recommendation like “bypass interlock to test.” Tickets bounced from the CMMS, technicians lost trust, and on-call engineers were triaging bad outputs at 2 a.m. The team needed reliability and safety without re‑architecting the whole pipeline.

## Applying the Pattern
The Guardrail Decorator wrapped the generation step with a belt‑and‑suspenders set of checks. Instead of asking the model to “be careful,” the service enforced it:

- Pre-validators sanitized and bounded the input log bundle.
- Post-validators enforced JSON schema, policy rules, and domain constraints (e.g., part numbers must exist; torque within catalog ranges).
- A lightweight critic asked the model to cite the log lines that justify each action, which improved precision.
- A repair strategy re‑prompted with targeted feedback (“Part X doesn’t exist; choose from this set”), and decoding constraints (JSON-only).
- A fallback produced a conservative template when retries were exhausted, so the CMMS still received a valid ticket.

In short, the core intent (draft a ticket) stayed simple, while the decorator handled quality, safety, and graceful degradation.

## Implementation Plan
- Define a strict JSON schema for TicketDraft (actions, parts[], torqueNm, citations[]).
- Build validators:
  - Schema validator (reject malformed or missing fields).
  - Safety gate (block banned phrases, require lockout/tagout steps).
  - Catalog checks (part IDs must exist; torque must match allowed ranges).
  - Link critic: each action must cite at least one source log line.
- Implement repair:
  - Re-prompt with validator feedback and allowed values.
  - Constrain decoding to JSON.
- Set budgets:
  - Max 2 retries, total 4s timeout, fallback to templated ticket.
- Instrument:
  - Log reasons, policy versions, and retry counts; redact VIN/PII.

## Implementation Steps
The decorator lived next to the model call and returned either a valid ticket or a typed “guardrail_fallback” result. It kept the interface simple: input in, ticket out.

TypeScript snippet — guarded generation loop with repair, retries, and fallback:
```ts
type Validator = (req: LogBundle, draft: TicketDraft) => string[]; // errors
export async function guardedDraft(req: LogBundle): Promise<TicketDraft> {
  let hints: Partial<PromptHints> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await llmComplete(prompt(req, hints), { json: true, timeoutMs: 1200 });
    const draft = safeParseJSON(raw); // returns null on failure
    const errors = draft ? runValidators(req, draft) : ["json_malformed"];
    if (errors.length === 0) return draft!;
    hints = toRepairHints(errors, req); // e.g., supply allowed part IDs or torque ranges
  }
  return fallbackTemplate(req); // conservative, schema-valid ticket
}
```

Validators encoded the domain. The parts/torque check consulted the same catalog used by procurement, eliminating drift between “what the model thinks exists” and inventory truth.

TypeScript snippet — catalog validator example:
```ts
const partsAndTorque: Validator = (req, draft) => {
  const errs: string[] = [];
  for (const p of draft.parts) if (!catalog.has(p.id)) errs.push(`unknown_part:${p.id}`);
  for (const step of draft.actions) {
    if (step.torqueNm && !catalog.inRange(step.partId, step.torqueNm))
      errs.push(`torque_out_of_range:${step.partId}:${step.torqueNm}`);
  }
  return errs;
};
```

A policy gate blocked unsafe guidance. The repair step injected a firm constraint list: “Permitted actions: inspect, reseat, replace, recalibrate. Bypass/disable is prohibited.” When validators failed, the next attempt included precise alternatives (e.g., “Choose from: BRK‑128, BRK‑129”).

The fallback produced a minimal, CMMS-acceptable ticket: symptoms, linked logs, “inspection required,” and no speculative torque values. Every decision logged the validator errors and policy version.

## Outcome & Takeaways
- Malformed JSON fell from 7.8% to 0.3%. CMMS ingestion errors disappeared.
- Unsafe recommendations dropped to zero; the policy gate and critic eliminated “bypass” language.
- Median latency increased by 140 ms, well within SLO; retries rarely hit the budget.
- Technician trust improved because tickets always cited the exact log lines.

Key lessons:
- Put domain truth (catalogs, ranges) in validators, not the prompt.
- Repair with specific, machine-enforceable hints; don’t “ask nicely.”
- Fail gracefully with a safe, schema-valid fallback rather than timing out.
- Centralize policies in the decorator so product teams can iterate without touching core logic.