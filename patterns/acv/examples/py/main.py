from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, Iterable, List, Optional, Set, Tuple, TypeVar, Union


########################
# Types and Utilities  #
########################

# QA report expresses objective quality and risk signals the Controller can enforce.
@dataclass
class QAReport:
  score: float
  flags: List[str]
  details: List[str]


# A localizable string with an optional glossary term that must be preserved.
@dataclass
class SourceString:
  id: str
  text: str
  glossary_term: Optional[str] = None


# The batch being processed: source strings, target locales, and in-progress translations.
# This is what "tools" read/write; the Controller keeps state derived from it.
@dataclass
class Batch:
  id: str
  branch: str
  locales: List[str]
  source: List[SourceString]
  translations: Dict[str, Dict[str, str]]
  committed: bool
  tm_applied: bool
  qa: Optional[QAReport] = None


# Controller-level config and guardrails, including per-locale budgets.
# Budgets simulate spend limits for machine translation per locale.
@dataclass
class ControllerConfig:
  max_iterations: int
  mt_budget_per_locale: Dict[str, float]
  dry_run: bool


# Minimal strongly-typed event emitter. Views subscribe via .on().
T = TypeVar("T")


class Emitter(Generic[T]):
  def __init__(self) -> None:
    self._listeners: List[Callable[[T], None]] = []

  def on(self, fn: Callable[[T], None]) -> Callable[[], None]:
    self._listeners.append(fn)
    def unsubscribe() -> None:
      self._listeners[:] = [l for l in self._listeners if l is not fn]
    return unsubscribe

  def emit(self, e: T) -> None:
    for l in list(self._listeners):
      l(e)


# Helper: extract ICU-style placeholders from a string: "{name}" -> "name".
_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def extract_placeholders(s: str) -> Set[str]:
  return set(m.group(1) for m in _PLACEHOLDER_RE.finditer(s))


# Helper: compute a trivial textual diff summary (line counts only) for demonstration.
def diff_summary(batch: Batch) -> str:
  total = sum(len(map_) for map_ in batch.translations.values())
  return f"diff: {total} translated segments across {len(batch.translations)} locales"


###########################
# Steps (Agent Intents)   #
###########################

# Step is the machine-readable "intention" the Agent produces.
# It is intentionally free of tool details and UI concerns.

@dataclass(frozen=True)
class ApplyTM:
  batch_id: str
  action: str = field(default="apply_tm", init=False)


@dataclass(frozen=True)
class MTFill:
  batch_id: str
  action: str = field(default="mt_fill", init=False)


@dataclass(frozen=True)
class QACheck:
  batch_id: str
  action: str = field(default="qa_check", init=False)


@dataclass(frozen=True)
class AskReviewer:
  batch_id: str
  reason: str
  action: str = field(default="ask_reviewer", init=False)


@dataclass(frozen=True)
class Commit:
  branch: str
  action: str = field(default="commit", init=False)


@dataclass(frozen=True)
class Done:
  action: str = field(default="done", init=False)


Step = Union[ApplyTM, MTFill, QACheck, AskReviewer, Commit, Done]


#######################
# Events for the View #
#######################

@dataclass(frozen=True)
class Planned:
  step: Step


@dataclass(frozen=True)
class ToolStarted:
  tool: str
  detail: Optional[str] = None


@dataclass(frozen=True)
class ToolResult:
  tool: str
  detail: Optional[str] = None


@dataclass(frozen=True)
class QAResult:
  report: QAReport


@dataclass(frozen=True)
class AwaitingInput:
  reason: str


@dataclass(frozen=True)
class Downgraded:
  to: str
  error: str


@dataclass(frozen=True)
class Cost:
  locale: str
  spent: float
  budget: float


@dataclass(frozen=True)
class Committed:
  branch: str


@dataclass(frozen=True)
class Completed:
  pass


Event = Union[
  Planned,
  ToolStarted,
  ToolResult,
  QAResult,
  AwaitingInput,
  Downgraded,
  Cost,
  Committed,
  Completed,
]


#############################
# Mock "Tool" Adapters      #
#############################

class Tools:
  # Translation Memory apply: fills exact matches (case-sensitive) from a tiny in-memory TM.
  @staticmethod
  def apply_tm(batch: Batch) -> None:
    TM: Dict[str, Dict[str, str]] = {
      "You have {count} apples.": {
        "es": "Tienes {count} manzanas.",
        "fr": "Vous avez {count} pommes.",
      },
    }
    for src in batch.source:
      tm_entry = TM.get(src.text)
      if not tm_entry:
        continue
      for locale in batch.locales:
        hit = tm_entry.get(locale)
        if not hit:
          continue
        batch.translations.setdefault(locale, {})
        batch.translations[locale][src.id] = hit

  # Machine translation: fills gaps and (intentionally) mistranslates placeholders for one string
  # to simulate a risky output. It charges "cost" per character.
  @staticmethod
  def mt_fill(
    batch: Batch, budgets: Dict[str, float]
  ) -> Dict[str, float]:
    def es_bad(s: str) -> str:
      return s.replace("Hello, {name}!", "¡Hola, {nombre}!")  # placeholder drift on purpose

    cost_per_char = 0.00001
    spent_per_locale: Dict[str, float] = {}

    for locale in batch.locales:
      spent = 0.0
      batch.translations.setdefault(locale, {})
      tmap = batch.translations[locale]
      for src in batch.source:
        if src.id in tmap:
          continue
        mt_out = es_bad(src.text) if locale == "es" else f"[{locale}] {src.text}"
        cost = len(mt_out) * cost_per_char
        budget = budgets.get(locale, 0.0)
        if spent + cost > budget:
          break
        tmap[src.id] = mt_out
        spent += cost
      spent_per_locale[locale] = spent
    return spent_per_locale

  # QA: checks placeholder set equality and glossary preservation.
  # It returns a score penalized by flags. The Controller enforces guardrails based on this.
  @staticmethod
  def qa(batch: Batch, glossary: Dict[str, str]) -> QAReport:
    flags: List[str] = []
    details: List[str] = []
    penalties = 0.0

    for locale in batch.locales:
      tmap = batch.translations.get(locale, {})
      for src in batch.source:
        t = tmap.get(src.id)
        if not t:
          continue
        src_ph = extract_placeholders(src.text)
        trg_ph = extract_placeholders(t)
        mismatch = (len(src_ph) != len(trg_ph)) or any(p not in trg_ph for p in src_ph)
        if mismatch:
          flags.append("placeholder_mismatch")
          details.append(
            f"locale={locale} id={src.id} placeholders {','.join(sorted(src_ph))} -> {','.join(sorted(trg_ph))}"
          )
          penalties += 0.25
        # Glossary preservation: enforce only if source mentions the key term textually.
        # This avoids false positives when the source refers to a concept indirectly.
        if src.glossary_term:
          key = src.glossary_term
          target_term = glossary.get(key)
          if target_term and key.lower() in src.text.lower():
            if target_term not in t:
              flags.append("glossary_missing")
              details.append(f'locale={locale} id={src.id} missing term "{target_term}"')
              penalties += 0.15

    score = max(0.0, 1.0 - penalties)
    # De-duplicate flags while preserving rough order
    seen: Set[str] = set()
    dedup_flags = []
    for f in flags:
      if f not in seen:
        seen.add(f)
        dedup_flags.append(f)
    return QAReport(score=score, flags=dedup_flags, details=details)

  class git:
    @staticmethod
    def create_pr(branch: str, diff: str, *, dry_run: bool) -> None:
      if not branch or not diff:
        raise ValueError("git: missing branch or diff")
      # Dry-run simulates CI usage. Real code would call out to a VCS API.
      if dry_run:
        return
      # In a real integration, this would create a PR and possibly return metadata.


#################
# Agent Logic   #
#################

@dataclass(frozen=True)
class AgentState:
  batch: str
  tm_applied: bool
  gaps: int
  qa: Optional[QAReport]
  committed: bool
  branch: str


def next_step(state: AgentState) -> Step:
  if not state.tm_applied:
    return ApplyTM(batch_id=state.batch)
  if state.gaps > 0:
    return MTFill(batch_id=state.batch)
  if state.qa is None:
    return QACheck(batch_id=state.batch)
  if state.qa.score < 0.95 or "placeholder_mismatch" in state.qa.flags:
    return AskReviewer(batch_id=state.batch, reason="risk")
  if not state.committed:
    return Commit(branch=state.branch)
  return Done()


########################
# Controller (ACV)     #
########################

class Controller:
  def __init__(self, batch: Batch, cfg: ControllerConfig) -> None:
    self._batch = batch
    self._cfg = cfg
    self._emitter: Emitter[Event] = Emitter()
    self._retries: Dict[str, int] = {}
    self._glossary: Dict[str, str] = {"guild": "Guild"}  # tiny glossary

  def on_event(self, fn: Callable[[Event], None]) -> Callable[[], None]:
    return self._emitter.on(fn)

  # Entry point: run until Agent returns "done" or iteration cap is hit.
  def run(self) -> None:
    for _ in range(self._cfg.max_iterations):
      state = self._derive_state()
      step = next_step(state)
      self._emitter.emit(Planned(step=step))
      if isinstance(step, Done):
        self._emitter.emit(Completed())
        return
      try:
        self._run_step(step)
      except Exception as e:
        key = getattr(step, "action", "unknown")
        count = self._retries.get(key, 0) + 1
        self._retries[key] = count
        if count <= 2:
          self._emitter.emit(Downgraded(to="ask_reviewer", error=f"{key} failed: {e}"))
          # Force a safe downgrade by injecting a QA failure the Agent will respond to.
          self._batch.qa = QAReport(score=0.0, flags=["tool_error"], details=[str(e)])
        else:
          # After persistent failure, request human input.
          self._emitter.emit(AwaitingInput(reason="persistent_tool_error"))
          return
    # Exceeded iterations indicates a bug or a dead loop; surface via event.
    self._emitter.emit(AwaitingInput(reason="max_iterations_reached"))

  # Executes a single step. Each variant validates its inputs, updates batch,
  # and emits tool lifecycle events. Guardrails are applied before risky actions.
  def _run_step(self, step: Step) -> None:
    if isinstance(step, ApplyTM):
      self._emitter.emit(ToolStarted(tool="applyTM"))
      Tools.apply_tm(self._batch)
      self._batch.tm_applied = True
      self._emitter.emit(ToolResult(tool="applyTM", detail="TM applied"))
      return

    if isinstance(step, MTFill):
      self._emitter.emit(ToolStarted(tool="mtFill"))
      spent_per_locale = Tools.mt_fill(self._batch, self._cfg.mt_budget_per_locale)
      for locale, spent in spent_per_locale.items():
        self._emitter.emit(Cost(locale=locale, spent=spent, budget=self._cfg.mt_budget_per_locale.get(locale, 0.0)))
      self._emitter.emit(ToolResult(tool="mtFill", detail="Gaps filled"))
      return

    if isinstance(step, QACheck):
      self._emitter.emit(ToolStarted(tool="qa"))
      report = Tools.qa(self._batch, self._glossary)
      self._batch.qa = report
      self._emitter.emit(QAResult(report=report))
      return

    if isinstance(step, AskReviewer):
      # Simulate human-in-the-loop as a deterministic patcher that fixes placeholders only.
      # Design choice: controllers may apply safe, localized autofixes to reduce reviewer toil.
      self._emitter.emit(AwaitingInput(reason=step.reason))
      self._autofix_placeholders()
      # Re-run QA immediately after autofix to verify risk is mitigated.
      report = Tools.qa(self._batch, self._glossary)
      self._batch.qa = report
      self._emitter.emit(QAResult(report=report))
      return

    if isinstance(step, Commit):
      # Guardrail: refuse to commit if placeholders still mismatched or score low.
      report = self._batch.qa
      if report is None or report.score < 0.95 or "placeholder_mismatch" in report.flags:
        raise RuntimeError("commit blocked by QA")
      self._emitter.emit(ToolStarted(tool="git.createPR"))
      Tools.git.create_pr(self._batch.branch, diff_summary(self._batch), dry_run=self._cfg.dry_run)
      self._batch.committed = True
      self._emitter.emit(Committed(branch=self._batch.branch))
      return

  # Derive state for the Agent from the mutable batch.
  def _derive_state(self) -> AgentState:
    gaps = self._count_gaps()
    return AgentState(
      batch=self._batch.id,
      tm_applied=self._batch.tm_applied,
      gaps=gaps,
      qa=self._batch.qa,
      committed=self._batch.committed,
      branch=self._batch.branch,
    )

  # Count untranslated segments across all locales; the Agent uses this to decide MT filling.
  def _count_gaps(self) -> int:
    gaps = 0
    for locale in self._batch.locales:
      tmap = self._batch.translations.get(locale, {})
      for src in self._batch.source:
        if src.id not in tmap:
          gaps += 1
    return gaps

  # Autofix strategy: for each translation, force the placeholder set to match the source
  # by renaming mismatched placeholders while preserving positions as much as possible.
  def _autofix_placeholders(self) -> None:
    for locale in self._batch.locales:
      tmap = self._batch.translations.get(locale, {})
      for src in self._batch.source:
        t = tmap.get(src.id)
        if not t:
          continue
        src_ph = list(extract_placeholders(src.text))
        trg_ph = list(extract_placeholders(t))
        if len(src_ph) == len(trg_ph) and all(p in trg_ph for p in src_ph):
          continue
        fixed = t
        for i in range(len(trg_ph)):
          from_name = trg_ph[i]
          to_name = src_ph[i] if i < len(src_ph) else from_name
          fixed = re.sub(r"\{" + re.escape(from_name) + r"\}", "{" + to_name + "}", fixed)
        tmap[src.id] = fixed
      self._batch.translations[locale] = tmap


###########
# Views   #
###########

class CLIView:
  # CLI view: terse logs suitable for CI. Consumes events; knows nothing about prompts or tools.
  def __init__(self, ctrl: Controller) -> None:
    ctrl.on_event(self._on_event)

  def _on_event(self, e: Event) -> None:
    if isinstance(e, Planned):
      # Step always has an 'action' attribute
      action = getattr(e.step, "action")
      print(f"[plan] {action}")
    elif isinstance(e, ToolStarted):
      print(f"[tool] start {e.tool}")
    elif isinstance(e, ToolResult):
      detail = e.detail or ""
      print(f"[tool] done {e.tool} - {detail}")
    elif isinstance(e, QAResult):
      flags = ",".join(e.report.flags)
      print(f"[qa] score={e.report.score:.2f} flags={flags}")
    elif isinstance(e, AwaitingInput):
      print(f"[wait] {e.reason}")
    elif isinstance(e, Cost):
      print(f"[cost] {e.locale} spent={e.spent:.4f} budget={e.budget}")
    elif isinstance(e, Committed):
      print(f"[git] PR created on {e.branch}")
    elif isinstance(e, Completed):
      print("[done] pipeline complete")
    elif isinstance(e, Downgraded):
      print(f"[degrade] -> {e.to} because {e.error}")


class WebView:
  # "Web" view: capture state for a UI. It shows a progress-like snapshot.
  def __init__(self, ctrl: Controller, batch: Batch) -> None:
    self._latest: Dict[str, Any] = {}
    self._batch = batch
    ctrl.on_event(self._on_event)

  def _on_event(self, e: Event) -> None:
    if isinstance(e, QAResult):
      self._latest["qa"] = e.report
    elif isinstance(e, Committed):
      self._latest["committed"] = True

  def render(self) -> None:
    committed = self._latest.get("committed", False)
    status = "Committed" if committed else "In Progress"
    qa: Optional[QAReport] = self._latest.get("qa")
    qa_str = f"QA {qa.score:.2f} [{','.join(qa.flags)}]" if qa else "QA pending"
    print(f"[web] {status} | {qa_str}")


#########################
# Usage / "Tests"       #
#########################

def _build_demo_batch() -> Batch:
  # Build a batch with two strings, one with a placeholder and glossary term,
  # the other a greeting. The Spanish MT intentionally drifts "{name}" to "{nombre}"
  # to trigger the placeholder guardrail.
  return Batch(
    id="batch-42",
    branch="feature/l10n-weekly-event",
    locales=["es", "fr"],
    source=[
      SourceString(id="s1", text="You have {count} apples.", glossary_term="guild"),
      SourceString(id="s2", text="Hello, {name}!"),
    ],
    translations={},
    committed=False,
    tm_applied=False,
  )


def _build_demo_config() -> ControllerConfig:
  # Configure the Controller with sane budgets and small iteration cap.
  # Budgets are generous enough to fill both strings.
  return ControllerConfig(
    max_iterations=20,
    mt_budget_per_locale={"es": 1.0, "fr": 1.0},
    dry_run=True,  # do not actually create a PR
  )


def main() -> None:
  batch = _build_demo_batch()
  cfg = _build_demo_config()

  # Wire ACV: Controller + two Views.
  controller = Controller(batch, cfg)
  CLIView(controller)
  web = WebView(controller, batch)

  # 1) Golden-test-like check: the Agent should sequence apply_tm -> mt_fill -> qa_check initially.
  initial_state = AgentState(
    batch=batch.id,
    tm_applied=batch.tm_applied,
    gaps=len(batch.source) * len(batch.locales),
    qa=None,
    committed=batch.committed,
    branch=batch.branch,
  )
  first = next_step(initial_state)
  print(f"[test] first step = {getattr(first, 'action')}")  # expect "apply_tm"

  # 2) Run the pipeline end-to-end. Views will log and update progressively.
  controller.run()
  web.render()  # Show a compact status snapshot

  # 3) Assert the guardrail worked: placeholders should match after autofix, enabling commit gating.
  es_s2 = batch.translations.get("es", {}).get("s2", "")
  print(f"[assert] ES s2 placeholders ok = {'name' in extract_placeholders(es_s2)}")  # true after autofix
  print(f"[assert] committed = {batch.committed}")  # true in dryRun mode as well


if __name__ == "__main__":
  main()