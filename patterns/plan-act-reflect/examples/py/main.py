"""
Plan–Act–Reflect example for robust RFP field extraction (Python).

This single file demonstrates a small, production-minded agent that:
- Plans which field to extract next (based on uncertainty).
- Acts using a small toolchain (regex, section finder, "LLM"-like heuristic).
- Reflects with validators and adjusts the plan when checks fail.

The code is self-contained and runnable (python3). It mocks OCR/LLM with
deterministic helpers and keeps types tight. Inline comments explain what,
how, and why, including tradeoffs and alternatives.

Dependencies: standard library only (no third-party packages required).
"""

from __future__ import annotations

import re
import sys
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple


# ----------------------------- Types & Models ------------------------------

Field = Literal["dueDate", "budget", "preBidRequired", "contactEmail", "deliveryMethod"]
Tool = Literal["section", "table", "regex", "llm"]


@dataclass
class Step:
    field: Field
    tool: Tool
    hint: Optional[str] = None


@dataclass
class ActionArtifact:
    field: Field
    value: Any
    evidence: str
    tool: Tool
    hint: Optional[str] = None


@dataclass
class Issue:
    field: Field
    message: str
    evidence: Optional[str] = None


@dataclass
class HistoryEntry:
    step: Step
    artifact: Optional[ActionArtifact]
    issues: List[Issue]
    planAdjustment: Optional[Step] = None


@dataclass
class ExtractionResult:
    values: Dict[Field, Any]
    evidence: Dict[Field, str]
    stopReason: str
    steps: int
    history: List[HistoryEntry]


@dataclass
class ParsedDoc:
    text: str
    sections: Dict[str, str]
    locale: str  # e.g., "en-US"
    timezone: Optional[str] = None  # inferred from doc
    publishDate: Optional[datetime] = None
    publishDateText: Optional[str] = None


@dataclass
class Context:
    """
    Context holds in-progress values, their evidence, and book-keeping for reflection.
    This keeps state explicit and testable. The agent updates this on every loop.
    """
    values: Dict[Field, Any] = dc_field(default_factory=dict)
    evidence: Dict[Field, str] = dc_field(default_factory=dict)
    publishDate: Optional[datetime] = None
    publishDateText: Optional[str] = None
    timezone: Optional[str] = None
    # failure counts help detect stagnation
    failureCounts: Dict[Field, int] = dc_field(default_factory=dict)
    history: List[HistoryEntry] = dc_field(default_factory=list)


# ------------------------------ Mock Document ------------------------------
# The sample document intentionally contains:
# - Publish date after "Questions due" to trigger a due-date validator failure on first pass.
# - Two budget figures, a large sample ($1,000,000) and the real cap ($100,000)
#   with "not-to-exceed" phrasing. The agent should learn to prefer the latter.
# - Mandatory site visit phrasing for preBidRequired.
# - Clear email and delivery method text.
SAMPLE_TEXT = """
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
"""


# ----------------------- Lightweight Parsing & Indexing --------------------
def parse_doc(text: str) -> ParsedDoc:
    """
    parse_doc creates an indexed view of the raw text so tools can work cheaply:
    - Splits into coarse sections by simple uppercase headers.
    - Extracts publish date and timezone hints early since validators depend on them.

    Tradeoff:
    - This is intentionally simple; production systems may build richer structure
      (token offsets, tables, footnotes). Start small and add only if validated by need.
    """
    sections: Dict[str, str] = {}
    lines = re.split(r"\r?\n", text)
    current = "ROOT"
    sections[current] = ""
    for line in lines:
        if re.match(r"^[A-Z][A-Z\s]{2,}$", line.strip() or ""):
            current = line.strip()
            sections[current] = ""
        else:
            sections[current] = sections.get(current, "") + line + "\n"

    tz = "America/New_York" if re.search(r"\b(EST|EDT|PST|CST|UTC)\b", text, re.IGNORECASE) else "UTC"
    pub_match = re.search(r"Published:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})", text, re.IGNORECASE)
    publish_date = parse_natural_date(pub_match.group(1)) if pub_match else None

    return ParsedDoc(
        text=text,
        sections=sections,
        locale="en-US",
        timezone=tz,
        publishDate=publish_date,
        publishDateText=pub_match.group(0) if pub_match else None,
    )


# --------------------------------- Utilities --------------------------------
MONTHS = (
    "January February March April May June July August September October November December".split()
)


def parse_natural_date(s: str) -> Optional[datetime]:
    """
    Parse simple date strings like:
    - "March 5, 2024"
    - "March 5, 2024 2:00 PM"
    - "March 5, 2024 14:30"
    - "March 5, 2024 2:00 PM EST"  (timezone ignored)
    """
    s = s.strip()
    # Normalize multiple spaces
    s = re.sub(r"\s+", " ", s)
    # Remove trailing timezone words (best-effort)
    s = re.sub(r"\s+\b([A-Z]{2,4}|[A-Za-z/_]+)\b$", "", s)

    fmt_candidates = [
        "%B %d, %Y %I:%M %p",
        "%B %d, %Y %H:%M",
        "%B %d, %Y",
    ]
    for fmt in fmt_candidates:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def extract_currency_number(s: str) -> Optional[float]:
    m = re.search(r"(\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)", s)
    if not m:
        return None
    raw = re.sub(r"[^\d.]", "", m.group(1))
    try:
        return float(raw)
    except ValueError:
        return None


# ------------------------------- Tools (Act) -------------------------------
# Each tool focuses on one small job. Keeping tools small and predictable
# makes reflection easier: validators can point directly to specific evidence.
# These tools are deterministic mocks—fast and dependency-free.

def find_section(doc: ParsedDoc, hint: str) -> Tuple[str, str]:
    key = next(
        (k for k in doc.sections.keys() if "SCHEDULE" in k or "BUDGET" in k or "SUBMISSION" in k),
        "ROOT",
    )
    return doc.sections.get(key, doc.text), f"Section:{key} (hint:{hint})"


def parse_budget_table(doc: ParsedDoc) -> Tuple[Optional[float], str]:
    # Prefer lines with "Not-to-Exceed" or "NTE" near currency; deprioritize "Sample"
    candidates: List[Tuple[float, str, int]] = []
    for line in re.split(r"\r?\n", doc.text):
        money_match = re.search(r"(\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)", line)
        if not money_match:
            continue
        amount = extract_currency_number(money_match.group(1))
        if amount is None:
            continue
        score = 0
        if re.search(r"(not[- ]?to[- ]?exceed|nte|cap|max(imum)?)", line, re.IGNORECASE):
            score += 5
        if re.search(r"(sample|example|form)", line, re.IGNORECASE):
            score -= 3
        if re.search(r"(budget|cost)", line, re.IGNORECASE):
            score += 1
        candidates.append((amount, line.strip(), score))

    if not candidates:
        return None, "No currency found"
    candidates.sort(key=lambda x: x[2], reverse=True)
    best = candidates[0]
    return best[0], best[1]


def regex_extract(doc: ParsedDoc, field: Field, hint: Optional[str] = None) -> Tuple[Any, str]:
    scope = re.sub(r"\s+", " ", doc.text) if hint else doc.text

    if field == "contactEmail":
        m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", scope)
        return (m.group(0) if m else None, m.group(0) if m else "email not found")

    if field == "deliveryMethod":
        line = doc.sections.get("SUBMISSION", doc.text)
        if re.search(r"online", line, re.IGNORECASE):
            return "online", line.strip()
        if re.search(r"in[- ]?person", line, re.IGNORECASE):
            return "in-person", line.strip()
        if re.search(r"mail|postal|courier", line, re.IGNORECASE):
            return "mail", line.strip()
        return None, "submission method not found"

    if field == "preBidRequired":
        s = doc.text
        if re.search(r"mandatory\s+pre[- ]?bid|site visit.*required", s, re.IGNORECASE):
            return True, "mandatory pre-bid/site visit language"
        if re.search(r"non[- ]mandatory|optional\s+pre[- ]?bid", s, re.IGNORECASE):
            return False, "non-mandatory language"
        return None, "pre-bid not specified"

    if field == "budget":
        m = re.search(
            r"(?:budget|not[- ]?to[- ]?exceed|NTE|cap|maximum).{0,30}?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
            scope,
            re.IGNORECASE,
        )
        fallback = re.search(r"\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?", scope)
        pick = (m.group(1) if m else (fallback.group(0) if fallback else None))
        return (
            float(re.sub(r"[^\d.]", "", pick)) if pick else None,
            m.group(0) if m else (fallback.group(0) if fallback else "no currency"),
        )

    if field == "dueDate":
        # Naive "due" pick; may grab Questions due first — good for triggering reflection.
        m = re.search(
            r"(?:proposal|bids?)\s+due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)",
            scope,
            re.IGNORECASE,
        )
        if not m:
            m = re.search(
                r"due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)",
                scope,
                re.IGNORECASE,
            )
        dt = parse_natural_date(m.group(1)) if m else None
        return dt, (m.group(0) if m else "no due date phrase")

    return None, "unhandled field"


def llm_extract(doc: ParsedDoc, field: Field, hint: Optional[str] = None) -> Tuple[Any, str]:
    # "LLM" stand-in: a second-pass heuristic that narrows scope by hint words
    # and applies stronger disambiguation rules. This mimics schema-constrained extraction.
    if hint:
        narrowed_lines = [
            l for l in re.split(r"\r?\n", doc.text)
            if hint.lower() in l.lower() or field.lower() in l.lower()
        ]
        narrowed = "\n".join(narrowed_lines)
    else:
        narrowed = doc.text

    if field == "dueDate":
        best = re.search(
            r"bids?\s+due[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?(?:\s+\w+)*)",
            narrowed,
            re.IGNORECASE,
        )
        if best:
            return parse_natural_date(best.group(1)), best.group(0)

    if field == "budget":
        pref = re.search(
            r"not[- ]?to[- ]?exceed.*?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
            narrowed,
            re.IGNORECASE,
        ) or re.search(
            r"NTE.*?(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
            narrowed,
            re.IGNORECASE,
        )
        if pref:
            return float(re.sub(r"[^\d.]", "", pref.group(1))), pref.group(0)

    return regex_extract(doc, field, hint)


def act(step: Step, doc: ParsedDoc) -> ActionArtifact:
    if step.tool == "section":
        value, evidence = find_section(doc, step.hint or step.field)
        return ActionArtifact(step.field, value=value, evidence=evidence, tool=step.tool, hint=step.hint)
    if step.tool == "table":
        value, evidence = parse_budget_table(doc)
        return ActionArtifact(step.field, value=value, evidence=evidence, tool=step.tool, hint=step.hint)
    if step.tool == "regex":
        value, evidence = regex_extract(doc, step.field, step.hint)
        return ActionArtifact(step.field, value=value, evidence=evidence, tool=step.tool, hint=step.hint)
    value, evidence = llm_extract(doc, step.field, step.hint)
    return ActionArtifact(step.field, value=value, evidence=evidence, tool=step.tool, hint=step.hint)


# ------------------------------- Validators --------------------------------
# Validators turn reflection into grounded decisions. Keep them small,
# composable, and return specific evidence so the planner can adjust.

def validate(ctx: Context) -> List[Issue]:
    issues: List[Issue] = []
    due = ctx.values.get("dueDate")
    due_dt: Optional[datetime] = due if isinstance(due, datetime) else None
    bud = ctx.values.get("budget")
    bud_num: Optional[float] = float(bud) if isinstance(bud, (int, float)) else None
    email = ctx.values.get("contactEmail")
    email_str: Optional[str] = str(email) if isinstance(email, str) else None

    if due_dt and ctx.publishDate and due_dt <= ctx.publishDate:
        issues.append(Issue(field="dueDate", message="Due date precedes publish date", evidence=ctx.evidence.get("dueDate")))

    if bud_num is not None:
        text = ctx.evidence.get("budget", "")
        if bud_num > 5_000_000 and not re.search(r"(cap|max|not[- ]?to[- ]?exceed|NTE)", text, re.IGNORECASE):
            issues.append(Issue(field="budget", message="Large value found without cap language", evidence=text))
        if not re.search(r"(\$|USD)", text, re.IGNORECASE):
            issues.append(Issue(field="budget", message="Budget missing explicit USD markers", evidence=text))

    if email_str and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email_str):
        issues.append(Issue(field="contactEmail", message="Invalid email format", evidence=email_str))

    return issues


# -------------------------------- Planner ----------------------------------
# Planner chooses the next best step. Heuristics:
# - Prefer fields not yet set or those flagged by issues.
# - Start with fields with cheap checks and high leverage (dueDate, budget).
# - Attach hints to focus the tools; escalate tool strength if prior attempts failed.

def plan_next(ctx: Context, outstanding_issues: List[Issue], doc: ParsedDoc) -> Optional[Step]:
    order: List[Field] = ["dueDate", "budget", "preBidRequired", "contactEmail", "deliveryMethod"]
    invalid = {i.field for i in outstanding_issues}

    # Promote fields with issues to the front
    candidates = [f for f in order if ctx.values.get(f) is None or f in invalid]
    if not candidates:
        return None

    field_name = candidates[0]
    fails = ctx.failureCounts.get(field_name, 0)

    hint_map: Dict[Field, str] = {
        "dueDate": "proposal due" if fails == 0 else "bids due",
        "budget": "budget" if fails == 0 else "not-to-exceed",
        "preBidRequired": "mandatory pre-bid",
        "contactEmail": "contact email",
        "deliveryMethod": "submission method",
    }

    # Tool escalation strategy:
    # regex -> llm (heuristic) -> section/table for structure-aware scanning
    tool: Tool = "regex"
    if field_name == "budget" and fails >= 1:
        tool = "table"
    elif field_name == "dueDate" and fails >= 1:
        tool = "llm"
    elif fails >= 2:
        tool = "section"

    return Step(field=field_name, hint=hint_map[field_name], tool=tool)


# ----------------------------- Reflection Loop -----------------------------
# run_extraction implements Plan–Act–Reflect:
# - Loop until all fields valid OR bounds reached.
# - After every action, run validators; if a field fails, record issue and adjust the plan.
# - Detect stagnation by counting repeated failures per field.
#
# Termination bounds:
# - All fields valid OR 8 steps OR ~20 seconds OR repeated same failure twice.
#
# Design choices:
# - Pure functions for tools/validators keep the core loop readable and testable.
# - Context is immutable-ish (reassigned fields) to avoid hidden side effects.

def run_extraction(doc: ParsedDoc) -> ExtractionResult:
    start = time.time()
    ctx = Context(
        values={},
        evidence={},
        publishDate=doc.publishDate,
        publishDateText=doc.publishDateText,
        timezone=doc.timezone,
        failureCounts={},
        history=[],
    )

    steps = 0
    while steps < 8 and (time.time() - start) < 20.0:
        # Plan based on current context and any outstanding issues from last iteration
        last_issues = ctx.history[-1].issues if ctx.history else []
        step = plan_next(ctx, last_issues, doc)
        if not step:
            break

        # Act using the chosen tool
        artifact = act(step, doc)

        # Write result only if it targets a concrete field value (ignore 'section' outputs)
        if step.field and artifact.value is not None and step.tool != "section":
            ctx.values[step.field] = artifact.value
            ctx.evidence[step.field] = artifact.evidence

        # Reflect with validators
        issues = validate(ctx)
        related = [i for i in issues if i.field == step.field]

        # Stagnation tracking: increment failure count if the same field keeps failing
        if related:
            ctx.failureCounts[step.field] = ctx.failureCounts.get(step.field, 0) + 1
        else:
            ctx.failureCounts.pop(step.field, None)

        # Adjust plan hint/tool when a validator flags a problem
        plan_adjustment: Optional[Step] = None
        if related:
            if step.field == "dueDate":
                plan_adjustment = Step(field="dueDate", hint="bid opening OR bids due", tool="llm")
            elif step.field == "budget":
                plan_adjustment = Step(field="budget", hint="not-to-exceed", tool="table")
            elif step.field == "preBidRequired":
                plan_adjustment = Step(field="preBidRequired", hint="mandatory OR non-mandatory", tool="llm")
            # Clear the suspect value to encourage a fresh attempt
            ctx.values.pop(step.field, None)

        ctx.history.append(HistoryEntry(step=step, artifact=artifact, issues=issues, planAdjustment=plan_adjustment))
        steps += 1

        # Early termination: if the same field failed twice, stop for human review
        stagnating = any(c >= 2 for c in ctx.failureCounts.values())
        all_fields: List[Field] = ["dueDate", "budget", "preBidRequired", "contactEmail", "deliveryMethod"]
        all_valid = all(ctx.values.get(f) is not None for f in all_fields) and len(issues) == 0

        if all_valid:
            return ExtractionResult(values=ctx.values, evidence=ctx.evidence, stopReason="all fields valid", steps=steps, history=ctx.history)
        if stagnating:
            return ExtractionResult(values=ctx.values, evidence=ctx.evidence, stopReason="stagnation detected", steps=steps, history=ctx.history)

    if steps >= 8:
        reason = "step limit"
    elif (time.time() - start) >= 20.0:
        reason = "time limit"
    else:
        reason = "no plan"

    return ExtractionResult(values=ctx.values, evidence=ctx.evidence, stopReason=reason, steps=steps, history=ctx.history)


# ---------------------------------- Demo -----------------------------------
# The usage example demonstrates an end-to-end run on SAMPLE_TEXT.
# It prints:
# - Final extracted values
# - Evidence (snippets) that supported each value
# - Stop reason and a compact history of steps
#
# Best practices shown:
# - Log concise artifacts and rationales; this enables auditability.
# - Separate values from evidence so later reviewers can verify the source.

def main() -> None:
    doc = parse_doc(SAMPLE_TEXT)
    result = run_extraction(doc)

    print("== Extracted Values ==")
    values_printable = {
        "dueDate": result.values["dueDate"].isoformat() if isinstance(result.values.get("dueDate"), datetime) else result.values.get("dueDate"),
        "budget": result.values.get("budget"),
        "preBidRequired": result.values.get("preBidRequired"),
        "contactEmail": result.values.get("contactEmail"),
        "deliveryMethod": result.values.get("deliveryMethod"),
    }
    print(values_printable)

    print("\n== Evidence ==")
    print(result.evidence)

    print("\n== Stop Reason & Steps ==")
    print({"stopReason": result.stopReason, "steps": result.steps})

    print("\n== History (compact) ==")
    for h in result.history:
        print({
            "step": {"field": h.step.field, "tool": h.step.tool, "hint": h.step.hint},
            "value": h.artifact.value if h.artifact else None,
            "evidence": h.artifact.evidence if h.artifact else None,
            "issues": [f"{i.field}: {i.message}" for i in h.issues],
            "planAdjustment": {"field": h.planAdjustment.field, "tool": h.planAdjustment.tool, "hint": h.planAdjustment.hint} if h.planAdjustment else None,
        })


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"Fatal error: {err}", file=sys.stderr)
        sys.exit(1)