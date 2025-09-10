from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Optional, TypedDict

# Guardrail Decorator Pattern — End-to-end, self-contained Python example
#
# What this file demonstrates:
# - A "guardrail decorator" that wraps an LLM-like generation step with:
#   - Pre-validation/sanitization of inputs (defensive boundaries on logs).
#   - Post-validation of outputs (schema, safety policy, catalog constraints, and a link critic).
#   - A repair loop that feeds targeted hints back to the generator (instead of “asking nicely”).
#   - Strict JSON-only decoding and a conservative fallback when retries are exhausted.
# - Instrumentation and safe logging with redaction.
# - Production-leaning Python best practices: explicit types, narrow error handling,
#   pure helpers, and no external network calls (LLM interaction is mocked).
#
# How it works:
# - guarded_draft() is the single entry point; callers pass a LogBundle and receive a TicketDraft.
# - It orchestrates a small retry loop (max 2 retries, 3 total attempts) and enforces a global timeout.
# - Each attempt generates a draft (via a fake LLM) and validates it. If invalid, the next attempt is
#   repaired with precise hints: allowed part IDs, torque ranges, required actions, etc.
# - If all attempts fail or time out, a schema-valid fallback template is returned, ensuring downstream
#   systems (e.g., CMMS) always receive a usable ticket.
#
# Why this design:
# - The generator remains simple (draft a ticket). The decorator carries the complexity needed for
#   reliability and safety. Policy and domain truth live outside the prompt, avoiding drift.
# - Machine-enforceable validators and targeted repair close the loop. This materially reduces
#   malformed outputs and unsafe advice without brittle prompt engineering.


# ---------- Types and domain models ----------

ActionType = Literal["lockout_tagout", "inspect", "reseat", "replace", "recalibrate"]


class ActionStep(TypedDict, total=False):
    type: ActionType  # repair or safety action
    partId: str  # present when the action targets a specific part
    torqueNm: float  # present when torque spec is needed
    citations: List[int]  # indices of log lines justifying the step


class PartLine(TypedDict):
    id: str
    qty: int


class TicketDraft(TypedDict):
    version: Literal["v1"]
    robotId: str
    parts: List[PartLine]
    actions: List[ActionStep]
    notes: List[str]  # plain text notes; used by technicians
    policyTag: str  # e.g., "policy/warehouse-robot-safety@1"


class LogBundle(TypedDict):
    robotId: str
    vin: str  # treated as sensitive, never logged directly
    lines: List[str]  # raw log lines from CAN bus, safety events, diagnostics


Validator = Callable[[LogBundle, Dict[str, Any]], List[str]]


class PromptHints(TypedDict, total=False):
    allowedPartIds: List[str]
    # torque ranges by part id; the generator should pick values inside these bounds
    torqueByPart: Dict[str, Dict[str, float]]
    requireLockout: bool
    permittedActions: List[ActionType]


# ---------- Catalog (domain truth) with helper predicates ----------

class _Catalog:
    """
    Centralizes allowed parts and torque ranges. In production, read from the same
    source of truth used by procurement to avoid divergence between generation and enforcement.
    """

    def __init__(self) -> None:
        self._parts: Dict[str, Dict[str, float]] = {
            "BRK-128": {"minTorque": 5.0, "maxTorque": 8.0},
            "BRK-129": {"minTorque": 10.0, "maxTorque": 12.0},
        }

    def has(self, part_id: str) -> bool:
        return part_id in self._parts

    def in_range(self, part_id: str, torque: float) -> bool:
        spec = self._parts.get(part_id)
        return bool(spec) and (spec["minTorque"] <= torque <= spec["maxTorque"])

    def all_ids(self) -> List[str]:
        return list(self._parts.keys())

    def torque_window(self, part_id: str) -> Dict[str, float]:
        spec = self._parts.get(part_id)
        if not spec:
            return {"minTorque": 0.0, "maxTorque": 0.0}
        return spec.copy()


catalog = _Catalog()


# ---------- Utilities: sleep, safe logging, parsing ----------

async def sleep_ms(ms: int) -> None:
    await asyncio.sleep(ms / 1000.0)


def redact(value: str) -> str:
    """
    Redact potentially sensitive identifiers before logging. In production, apply a robust policy.
    Here, only the VIN is redacted; the robotId is considered non-PII per assumption.
    """
    return re.sub(r"[A-Za-z0-9]", "•", value)[:6]


def safe_parse_json(raw: str) -> Optional[Dict[str, Any]]:
    """
    Parse JSON safely and narrow errors; returns None on failure.
    Avoids throwing from deep inside loops and keeps control flow explicit.
    """
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
        return None
    except Exception:
        return None


def log_event(level: int, event: str, **fields: Any) -> None:
    logging.log(level, "%s %s", event, json.dumps(fields, ensure_ascii=False))


# ---------- Validators (schema, safety, catalog, link critic) ----------

def schema_validator(_req: LogBundle, draft: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    if draft.get("version") != "v1":
        errs.append("schema_version_invalid")
    if not isinstance(draft.get("robotId"), str) or not draft.get("robotId"):
        errs.append("robot_id_missing")
    if not isinstance(draft.get("parts"), list):
        errs.append("parts_not_array")
    if not isinstance(draft.get("actions"), list):
        errs.append("actions_not_array")
    if not isinstance(draft.get("notes"), list):
        errs.append("notes_not_array")
    if not draft.get("policyTag"):
        errs.append("policy_tag_missing")

    # Light structural checks inside arrays:
    for i, p in enumerate(draft.get("parts") or []):
        if not isinstance(p, dict):
            errs.append(f"part_invalid:{i}")
            continue
        if not p.get("id") or not isinstance(p.get("id"), str):
            errs.append(f"part_id_missing:{i}")
        qty = p.get("qty")
        if not isinstance(qty, int) or qty <= 0:
            errs.append(f"part_qty_invalid:{i}")

    for i, a in enumerate(draft.get("actions") or []):
        if not isinstance(a, dict):
            errs.append(f"action_invalid:{i}")
            continue
        if not a.get("type"):
            errs.append(f"action_type_missing:{i}")
        citations = a.get("citations")
        if not isinstance(citations, list) or len(citations) == 0:
            errs.append(f"citations_missing:{i}")

    return errs


def safety_gate_validator(_req: LogBundle, draft: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    banned = [re.compile(r"bypass", re.I), re.compile(r"disable.*interlock", re.I)]
    for note in draft.get("notes") or []:
        if any(regex.search(note or "") for regex in banned):
            errs.append("policy_banned_phrase")

    actions = draft.get("actions") or []
    if not (isinstance(actions, list) and actions and isinstance(actions[0], dict) and actions[0].get("type") == "lockout_tagout"):
        errs.append("missing_lockout_tagout")

    permitted: List[ActionType] = ["lockout_tagout", "inspect", "reseat", "replace", "recalibrate"]
    for i, step in enumerate(actions):
        t = step.get("type") if isinstance(step, dict) else None
        if t not in permitted:
            errs.append(f"action_not_permitted:{i}:{t}")
    return errs


def catalog_validator(_req: LogBundle, draft: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    for p in draft.get("parts") or []:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if isinstance(pid, str) and not catalog.has(pid):
            errs.append(f"unknown_part:{pid}")

    for i, step in enumerate(draft.get("actions") or []):
        if not isinstance(step, dict):
            continue
        part_id = step.get("partId")
        torque = step.get("torqueNm")
        if isinstance(part_id, str) and not catalog.has(part_id):
            errs.append(f"unknown_part_in_action:{i}:{part_id}")
        if isinstance(part_id, str) and isinstance(torque, (int, float)):
            if not catalog.in_range(part_id, float(torque)):
                errs.append(f"torque_out_of_range:{part_id}:{torque}")
    return errs


def link_critic_validator(req: LogBundle, draft: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    n = len(req["lines"])
    for i, step in enumerate(draft.get("actions") or []):
        if not isinstance(step, dict):
            errs.append(f"citation_missing:{i}")
            continue
        citations = step.get("citations")
        if not isinstance(citations, list) or not citations:
            errs.append(f"citation_missing:{i}")
            continue
        if not all(isinstance(idx, int) and 0 <= idx < n for idx in citations):
            errs.append(f"citation_invalid_index:{i}")
    return errs


def run_validators(req: LogBundle, draft: Dict[str, Any]) -> List[str]:
    # Order can matter: fail-fast on schema before deeper checks reduces noise
    validators: List[Validator] = [schema_validator, safety_gate_validator, catalog_validator, link_critic_validator]
    errors: List[str] = []
    for v in validators:
        errors.extend(v(req, draft))
    return errors


# ---------- Repair hinting: translate validator errors into concrete constraints ----------

def to_repair_hints(errors: List[str], _req: LogBundle) -> PromptHints:
    # Build a minimal set of actionable hints. Keep it machine-friendly.
    hints: PromptHints = {}
    if any(e.startswith("unknown_part") for e in errors):
        hints["allowedPartIds"] = catalog.all_ids()
    if any(e.startswith("torque_out_of_range") for e in errors):
        torque_by_part: Dict[str, Dict[str, float]] = {}
        for pid in catalog.all_ids():
            w = catalog.torque_window(pid)
            torque_by_part[pid] = {"min": w["minTorque"], "max": w["maxTorque"]}
        hints["torqueByPart"] = torque_by_part
    if "missing_lockout_tagout" in errors:
        hints["requireLockout"] = True
    # Always include permitted actions; gives the generator a clear, finite set.
    hints["permittedActions"] = ["lockout_tagout", "inspect", "reseat", "replace", "recalibrate"]
    return hints


# ---------- Prompt scaffolding (for the mocked generator) ----------

def prompt(req: LogBundle, hints: PromptHints) -> str:
    # The mock generator will parse these hints from the string. A real system would pass structured args.
    return "\n".join([
        "SYSTEM: Generate a JSON-only TicketDraft (version v1) for the CMMS.",
        "Strictly follow permitted actions and torque ranges if given.",
        f"HINTS:{json.dumps(hints)}",
        f"LINES:{len(req['lines'])}",
        # The model would also receive summarized logs; for brevity, omit full text here.
    ])


# ---------- Mock LLM: deterministic “drift” followed by repair when hints arrive ----------

@dataclass(frozen=True)
class CompletionOptions:
    json: bool
    timeout_ms: int


async def llm_complete(input_text: str, _opts: CompletionOptions) -> str:
    """
    This mock simulates two behaviors:
    1) On the first attempt (no actionable hints), it emits a flawed draft: unknown part,
       torque outside spec, missing lockout_tagout, and weak citations.
    2) When hints are present (allowed parts/torques and requireLockout), it corrects the output.

    The goal is to exercise the validator + repair loop without external dependencies.
    """
    await sleep_ms(150)  # simulate latency

    hints: PromptHints = {}
    m = re.search(r"HINTS:(\{.*\})", input_text, re.S)
    if m:
        maybe = safe_parse_json(m.group(1))
        if isinstance(maybe, dict):
            hints = maybe  # type: ignore[assignment]

    n_lines = 1
    mm = re.search(r"LINES:(\d+)", input_text)
    if mm:
        try:
            n_lines = int(mm.group(1))
        except Exception:
            n_lines = 1

    base: Dict[str, Any] = {
        "version": "v1",
        "robotId": "RB-42",
        "parts": [],
        "actions": [],
        "notes": ["Auto-generated draft"],
        "policyTag": "policy/warehouse-robot-safety@1",
    }

    def choose_citation() -> int:
        return max(0, min(n_lines - 1, 0))

    no_hints = not hints or (not hints.get("allowedPartIds") and not hints.get("torqueByPart") and not hints.get("requireLockout"))

    if no_hints:
        # Intentionally flawed: malformed JSON ~10% of the time to simulate drift
        flip = (time.time_ns() // 1_000_000) % 10 == 0
        if flip:
            return '{"not":"json"'

        flawed: Dict[str, Any] = {
            **base,
            "parts": [{"id": "BRK-999", "qty": 1}],
            "actions": [
                {"type": "replace", "partId": "BRK-999", "torqueNm": 20, "citations": []},
                {"type": "recalibrate", "citations": [choose_citation()]},
            ],
            "notes": ["Consider bypass interlock to test"],
            "policyTag": "policy/warehouse-robot-safety@1",
        }
        return json.dumps(flawed)

    # With hints present, generate a compliant draft
    allowed_ids = hints.get("allowedPartIds") or []
    good_part = allowed_ids[0] if allowed_ids else "BRK-128"
    torque_range = (hints.get("torqueByPart") or {}).get(good_part) or {"min": 5.0, "max": 8.0}
    safe_torque = round((float(torque_range["min"]) + float(torque_range["max"])) / 2)

    safe: Dict[str, Any] = {
        **base,
        "parts": [{"id": good_part, "qty": 1}],
        "actions": [
            *([{"type": "lockout_tagout", "citations": [choose_citation()]}] if hints.get("requireLockout") else []),
            {"type": "inspect", "citations": [choose_citation()]},
            {"type": "replace", "partId": good_part, "torqueNm": safe_torque, "citations": [choose_citation()]},
            {"type": "recalibrate", "citations": [choose_citation()]},
        ],
        "notes": ["Diagnostic code indicates actuator wear; replacing within spec."],
        "policyTag": "policy/warehouse-robot-safety@1",
    }
    return json.dumps(safe)


# ---------- Input pre-validation / sanitization ----------

def sanitize_input(req: LogBundle) -> LogBundle:
    """
    Enforce bounds on the incoming log bundle to prevent prompt bloat and PII leaks.
    - Truncates logs to a safe count.
    - Trims lines to a max length.
    - Returns a shallow-cloned, sanitized structure.
    """
    MAX_LINES = 50
    MAX_LEN = 160
    lines = [str(l)[:MAX_LEN] for l in (req.get("lines") or [])][:MAX_LINES]
    return {
        "robotId": req["robotId"],
        "vin": req["vin"],
        "lines": lines,
    }


# ---------- Guarded generation with retry, repair, and fallback ----------

async def guarded_draft(req: LogBundle) -> TicketDraft:
    start = time.perf_counter()
    TIME_BUDGET_MS = 4000  # total budget across attempts
    MAX_ATTEMPTS = 3  # first try + 2 retries

    sanitized = sanitize_input(req)
    hints: PromptHints = {}

    for attempt in range(1, MAX_ATTEMPTS + 1):
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        if elapsed_ms >= TIME_BUDGET_MS:
            log_event(logging.WARNING, "timeout_budget_exhausted", robotId=sanitized["robotId"], vin=redact(sanitized["vin"]))
            return fallback_template(sanitized)

        remaining = TIME_BUDGET_MS - elapsed_ms
        per_attempt_timeout = min(1200, remaining)

        raw = ""
        try:
            # Enforce per-attempt timeout with wait_for
            raw = await asyncio.wait_for(
                llm_complete(prompt(sanitized, hints), CompletionOptions(json=True, timeout_ms=per_attempt_timeout)),
                timeout=per_attempt_timeout / 1000.0,
            )
        except asyncio.TimeoutError:
            log_event(logging.WARNING, "llm_timeout", attempt=attempt, robotId=sanitized["robotId"])
            raw = ""
        except Exception:
            # Real clients should catch network/abort errors here.
            log_event(logging.WARNING, "llm_error", attempt=attempt, robotId=sanitized["robotId"])
            raw = ""

        draft = safe_parse_json(raw)
        errors = run_validators(sanitized, draft) if draft else ["json_malformed"]

        if not errors:
            log_event(logging.INFO, "guardrails_ok", attempt=attempt, policyTag=draft.get("policyTag", "policy/warehouse-robot-safety@1"), robotId=sanitized["robotId"])  # type: ignore[arg-type]
            # Narrow the type to TicketDraft for the return
            return draft  # type: ignore[return-value]

        # Instrument failures with redaction and policy tagging for auditing
        log_event(
            logging.WARNING,
            "guardrails_violation",
            attempt=attempt,
            errors=errors,
            policyTag=(draft.get("policyTag") if draft else "policy/warehouse-robot-safety@1"),
            robotId=sanitized["robotId"],
            vin=redact(sanitized["vin"]),
        )

        # Prepare precise, machine-usable repair hints
        hints = to_repair_hints(errors, sanitized)

    # Retries exhausted: return conservative, schema-valid fallback
    log_event(logging.WARNING, "guardrails_fallback", robotId=sanitized["robotId"], vin=redact(sanitized["vin"]))
    return fallback_template(sanitized)


# ---------- Fallback: conservative, schema-valid ticket ----------

def fallback_template(req: LogBundle) -> TicketDraft:
    # Provide only safe steps; avoid speculative torques/parts.
    idx = 0 if req["lines"] else -1
    citations = [idx] if idx >= 0 else []
    return {
        "version": "v1",
        "robotId": req["robotId"],
        "parts": [],
        "actions": [
            {"type": "lockout_tagout", "citations": citations},
            {"type": "inspect", "citations": citations},
        ],
        "notes": ["Fallback: inspection required. No torque or replacement specified."],
        "policyTag": "policy/warehouse-robot-safety@1",
    }


# ---------- Example usage ----------

async def main() -> None:
    # Example logs that hint at a brake-related fault; in real systems, include structured fields.
    req: LogBundle = {
        "robotId": "RB-42",
        "vin": "3CZRE38579G705123",
        "lines": [
            "ERROR CAN: BRK actuator overcurrent on channel A (code E-OVC-12)",
            "WARN: intermittent encoder jitter detected",
            "INFO: safety interlock engaged",
        ],
    }

    ticket = await guarded_draft(req)

    # Print the final ticket draft; in production, this is posted to a CMMS API
    print("final_ticket_draft", json.dumps(ticket, indent=2))


if __name__ == "__main__":
    # Configure logging for structured-ish event logs
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass