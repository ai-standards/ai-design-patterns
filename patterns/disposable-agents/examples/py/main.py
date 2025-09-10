#!/usr/bin/env python3
"""
Disposable Agent pattern (mocked) — quiz_extractor (Python)

This single Python file demonstrates:
- A tiny, one-run "agent" that reads one file, extracts quiz data, validates it strictly,
  prints JSON to stdout, and exits. No memory, no background loops, no shared caches.
- A minimal orchestration that can batch-run many files and collect outputs.
- Deterministic behavior, strict schemas, timeouts, retries, and structured logs.

How to run:
  python this_file.py                               # runs the built-in demo (creates temp files)
  python this_file.py quiz_extractor path/to.md     # run the agent on a single file (JSON to stdout)
  python this_file.py run_batch file1.md file2.md   # run the batch orchestrator (summary JSON lines)

Requirements.txt:
  # No external dependencies. Uses only the Python standard library.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, TypedDict


# ------------------------------------------------------------
# Types: explicit, minimal, and stable contracts
# ------------------------------------------------------------

class QuizQuestion(TypedDict):
    stem: str
    choices: List[str]
    answerIndex: int  # 0-based


class QuizPayload(TypedDict):
    questions: List[QuizQuestion]


class AgentInfo(TypedDict):
    name: Literal["quiz_extractor"]
    version: str


class ModelInfo(TypedDict):
    name: Literal["mock-quiz-parser"]
    version: Literal["1.0.0"]
    temperature: int


class InputInfo(TypedDict):
    sourceFile: str
    sourceBytes: int
    sha256: str


class QuizAgentOutput(TypedDict):
    runId: str
    agent: AgentInfo
    model: ModelInfo
    input: InputInfo
    payload: QuizPayload


class AgentError(Exception):
    """
    Narrow error to a predictable shape for logging and exit paths.
    Agent failures must be concise and machine-readable if needed.
    """
    code: Literal["VALIDATION", "TIMEOUT", "MODEL", "IO"]

    def __init__(self, code: Literal["VALIDATION", "TIMEOUT", "MODEL", "IO"], message: str) -> None:
        super().__init__(message)
        self.code = code


# ------------------------------------------------------------
# Utilities: tiny helpers that are easy to reason about and test
# ------------------------------------------------------------

_OUT_LOCK = threading.Lock()
_LOG_LOCK = threading.Lock()


def sha256(input_text: str) -> str:
    """
    Compute a stable hash of the input string.
    Used to log input provenance without storing raw content.
    """
    h = hashlib.sha256()
    h.update(input_text.encode("utf-8"))
    return h.hexdigest()


def safe_json(value: Any) -> str:
    """
    Deterministic JSON output:
    - Compact representation to keep artifacts small.
    - Fails closed if the object cannot be stringified (raises TypeError).
    """
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def log_event(ev: Dict[str, Any]) -> None:
    """
    Structured diagnostic events to stderr, not stdout.
    Keeps stdout clean for the final JSON that downstream tools consume.
    Events include a runId for joinability in logs.
    """
    with _LOG_LOCK:
        sys.stderr.write(safe_json(ev) + "\n")
        sys.stderr.flush()


def assert_non_empty_string(field: str, value: Any) -> None:
    if not isinstance(value, str) or len(value.strip()) == 0:
        raise AgentError("VALIDATION", f"Expected non-empty string for {field}")


def assert_non_negative_int(field: str, value: Any) -> None:
    if not isinstance(value, int) or value < 0:
        raise AgentError("VALIDATION", f"Expected non-negative integer for {field}")


def validate_question(q: Any, idx: int) -> None:
    """
    Validate a QuizQuestion strictly. Throws AgentError on failure.
    Design choice: fail fast and loud. Content variance is high; predictable behavior matters.
    """
    if not isinstance(q, dict):
        raise AgentError("VALIDATION", f"Question #{idx} must be an object")
    assert_non_empty_string(f"questions[{idx}].stem", q.get("stem"))
    choices = q.get("choices")
    if not isinstance(choices, list) or len(choices) < 2:
        raise AgentError("VALIDATION", f"questions[{idx}].choices must be an array with at least 2 items")
    for i, c in enumerate(choices):
        assert_non_empty_string(f"questions[{idx}].choices[{i}]", c)
    answer_index = q.get("answerIndex")
    assert_non_negative_int(f"questions[{idx}].answerIndex", answer_index)
    if answer_index >= len(choices):
        raise AgentError("VALIDATION", f"questions[{idx}].answerIndex out of range")


def validate_quiz_payload(p: Any) -> None:
    """
    Validate a QuizPayload strictly. Throws AgentError on failure.
    """
    if not isinstance(p, dict):
        raise AgentError("VALIDATION", "payload must be an object")
    questions = p.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise AgentError("VALIDATION", "payload.questions must be a non-empty array")
    for i, q in enumerate(questions):
        validate_question(q, i)


# ------------------------------------------------------------
# Mock "model" call with timeouts and retries
# ------------------------------------------------------------

def parse_quiz_blocks(markdown: str) -> QuizPayload:
    """
    Simulates an LLM that extracts normalized quiz data from Markdown.

    Expected fenced block format (deterministic):
      ```quiz
      Q: What is 2 + 2?
      Choices: 2 | 3 | 4 | 5
      Answer: 3
      ```

    Notes:
    - Answer is 1-based in the source (common in author notes), converted to 0-based.
    - Multiple quiz blocks are supported; they concatenate into one questions array.
    - Extra whitespace is tolerated; anything outside quiz blocks is ignored.
    """
    lines = re.split(r"\r?\n", markdown)
    questions: List[QuizQuestion] = []

    in_quiz = False
    buf: List[str] = []
    for line in lines:
        trimmed = line.strip()
        if not in_quiz and trimmed.startswith("```quiz"):
            in_quiz = True
            buf = []
            continue
        if in_quiz and trimmed == "```":
            block = "\n".join(buf)
            qs = normalize_quiz_block(block)
            questions.extend(qs)
            in_quiz = False
            buf = []
            continue
        if in_quiz:
            buf.append(line)

    if len(questions) == 0:
        raise AgentError("MODEL", "No quiz blocks found")

    # Validate immediately before returning to enforce strict contract.
    payload: QuizPayload = {"questions": questions}
    validate_quiz_payload(payload)
    return payload


def normalize_quiz_block(block_body: str) -> List[QuizQuestion]:
    """
    Parses a single fenced block body into zero or more questions.
    Supports multiple Q/Choices/Answer triples inside one block.
    """
    qs: List[QuizQuestion] = []

    # Split into conceptual "records" by blank lines
    parts = [s.strip() for s in re.split(r"\n\s*\n", block_body) if s.strip()]
    for part in parts:
        q_match = re.search(r"^\s*Q:\s*(.+)$", part, flags=re.IGNORECASE | re.MULTILINE)
        c_match = re.search(r"^\s*Choices:\s*(.+)$", part, flags=re.IGNORECASE | re.MULTILINE)
        a_match = re.search(r"^\s*Answer:\s*(\d+)\s*$", part, flags=re.IGNORECASE | re.MULTILINE)
        if not q_match or not c_match or not a_match:
            # Skip malformed segments; let validator or outer logic decide if zero are found.
            continue

        stem = q_match.group(1).strip()
        choices = [s.strip() for s in c_match.group(1).split("|") if s.strip()]
        answer_1_based = int(a_match.group(1))
        answer_index = answer_1_based - 1

        candidate: QuizQuestion = {"stem": stem, "choices": choices, "answerIndex": answer_index}
        # Validate each candidate immediately for clearer error messages
        validate_question(candidate, len(qs))
        qs.append(candidate)

    return qs


def call_model_once(markdown: str, *, timeout_ms: int, retry: int) -> QuizPayload:
    """
    Wrap the mock parser with:
    - a timeout (to avoid hanging runs),
    - a single retry on model failure (not on validation),
    - deterministic "model metadata" for auditing.

    Tradeoffs:
    - A single retry can absorb rare transient errors without hiding systemic issues.
    - Deterministic behavior keeps results stable for auditing.
    """
    # Use a daemon thread to allow process to exit promptly if the main thread moves on (unref-like behavior).
    event = threading.Event()
    result_box: Dict[str, Any] = {}
    error_box: Dict[str, BaseException] = {}

    def attempt() -> None:
        try:
            # Simulate tiny, predictable latency to mimic real calls and exercise the timeout path.
            time.sleep(0.01)
            result_box["value"] = parse_quiz_blocks(markdown)
        except BaseException as e:  # capture and re-raise in outer thread
            error_box["error"] = e
        finally:
            event.set()

    t = threading.Thread(target=attempt, daemon=True, name="mock-model")
    t.start()
    ok = event.wait(timeout_ms / 1000.0)
    if not ok:
        raise AgentError("TIMEOUT", "Model call timed out")

    if "error" in error_box:
        err = to_agent_error(error_box["error"])
        if retry > 0 and err.code == "MODEL":
            return call_model_once(markdown, timeout_ms=timeout_ms, retry=retry - 1)
        raise err

    return result_box["value"]


# ------------------------------------------------------------
# Agent implementation (quiz_extractor)
# ------------------------------------------------------------

def run_quiz_extractor(source_file: str) -> QuizAgentOutput:
    """
    Disposable agent entrypoint for one file.
    - Reads the file
    - Computes provenance metadata
    - Calls the "model" with strict contracts
    - Validates the payload
    - Returns the final JSON-serializable output object
    """
    run_id = str(uuid.uuid4())
    log_event(
        {
            "ts": int(time.time() * 1000),
            "run": run_id,
            "level": "info",
            "event": "start",
            "agent": "quiz_extractor",
            "file": source_file,
        }
    )

    try:
        content = Path(source_file).read_text(encoding="utf-8")
    except Exception:
        raise AgentError("IO", f"Failed to read file: {source_file}")

    digest = sha256(content)
    payload = call_model_once(content, timeout_ms=2000, retry=1)

    # Defense in depth: validate at the boundary.
    validate_quiz_payload(payload)

    out: QuizAgentOutput = {
        "runId": run_id,
        "agent": {"name": "quiz_extractor", "version": "1.0.0"},
        "model": {"name": "mock-quiz-parser", "version": "1.0.0", "temperature": 0},
        "input": {
            "sourceFile": str(Path(source_file).resolve()),
            "sourceBytes": len(content.encode("utf-8")),
            "sha256": digest,
        },
        "payload": payload,
    }

    log_event(
        {
            "ts": int(time.time() * 1000),
            "run": run_id,
            "level": "info",
            "event": "finish",
            "questions": len(payload["questions"]),
        }
    )
    return out


# ------------------------------------------------------------
# CLI harness and small batch orchestrator
# ------------------------------------------------------------

def to_agent_error(err: BaseException) -> AgentError:
    """
    Coerce unknown errors into AgentError for consistent handling.
    """
    if isinstance(err, AgentError):
        return err
    return AgentError("MODEL", str(err))


def write_artifact(out: QuizAgentOutput, dir_path: str) -> str:
    """
    Write the agent's output to a simple artifact folder by runId.
    Mirrors common migration practice: store outputs alongside logs for audit.
    """
    d = Path(dir_path)
    d.mkdir(parents=True, exist_ok=True)
    file_path = d / f"{out['runId']}.json"
    file_path.write_text(safe_json(out) + "\n", encoding="utf-8")
    return str(file_path)


def run_batch(files: List[str], concurrency: int = 2) -> None:
    """
    Execute the agent over files with a small concurrency limit,
    logging a summary JSON line per file to stdout.

    Design notes:
    - No shared caches or long-lived state; each run is independent.
    - Fail closed: if anything throws, record an error result and continue.
    """
    artifacts_dir = str(Path.cwd() / "artifacts_quiz_extractor")
    q: "queue.Queue[str]" = queue.Queue()
    for f in files:
        q.put(f)

    def worker(worker_id: int) -> None:
        while True:
            try:
                file = q.get_nowait()
            except queue.Empty:
                return
            try:
                out = run_quiz_extractor(file)
                write_artifact(out, artifacts_dir)
                with _OUT_LOCK:
                    sys.stdout.write(safe_json({"status": "ok", "file": file, "runId": out["runId"]}) + "\n")
                    sys.stdout.flush()
            except BaseException as e:
                err = to_agent_error(e)
                with _OUT_LOCK:
                    sys.stdout.write(
                        safe_json({"status": "error", "file": file, "code": err.code, "message": str(err)}) + "\n"
                    )
                    sys.stdout.flush()
            finally:
                q.task_done()

    threads = []
    for i in range(max(1, int(concurrency))):
        t = threading.Thread(target=worker, args=(i,), daemon=True, name=f"batch-worker-{i}")
        threads.append(t)
        t.start()

    # Wait for all tasks to finish
    q.join()
    # Workers are daemon threads; they will exit naturally once queue is drained.


# ------------------------------------------------------------
# Program entry: supports three modes
# 1) quiz_extractor <file>
# 2) run_batch <file...>
# 3) no args -> run a self-contained demo
# ------------------------------------------------------------

def _self_contained_demo() -> None:
    """
    Creates a temp directory, writes three markdown files (two valid, one invalid),
    runs the batch orchestrator, and prints summary lines that demonstrate
    success and failure handling.
    """
    tmp = tempfile.mkdtemp(prefix="disposable-agent-demo-")
    files: List[str] = []

    # Valid quiz with two questions in one block
    md1 = "\n".join(
        [
            "# Lesson A",
            "",
            "```quiz",
            "Q: What is 2 + 2?",
            "Choices: 2 | 3 | 4 | 5",
            "Answer: 3",
            "",
            "Q: Select the color of the sky on a clear day.",
            "Choices: Red | Blue | Green",
            "Answer: 2",
            "```",
        ]
    )

    # Valid quiz with one question, extra prose and formatting
    md2 = "\n".join(
        [
            "# Lesson B",
            "Some intro text.",
            "",
            "```quiz",
            "Q: The earth is a _____.",
            "Choices: star | planet",
            "Answer: 2",
            "```",
            "",
            "Conclusion text.",
        ]
    )

    # Invalid: no quiz block — should produce an error
    md3 = "\n".join(
        [
            "# Lesson C",
            "This lesson forgot to include a quiz block.",
            "But contains a code fence:",
            "```js",
            "console.log('hello');",
            "```",
        ]
    )

    f1 = os.path.join(tmp, "lesson-a.md")
    f2 = os.path.join(tmp, "lesson-b.md")
    f3 = os.path.join(tmp, "lesson-c.md")
    Path(f1).write_text(md1, encoding="utf-8")
    Path(f2).write_text(md2, encoding="utf-8")
    Path(f3).write_text(md3, encoding="utf-8")
    files.extend([f1, f2, f3])

    # Run the batch with small concurrency and show structured results.
    run_batch(files, concurrency=2)

    # Tip for exploration (not required): the artifacts directory contains full JSON outputs keyed by runId.


def main() -> None:
    args = sys.argv[1:]
    if len(args) >= 1 and args[0] == "quiz_extractor":
        # Single-run CLI: read a file, print JSON to stdout, exit non-zero on validation errors.
        if len(args) != 2:
            with _OUT_LOCK:
                sys.stderr.write("Usage: python this_file.py quiz_extractor <file>\n")
                sys.stderr.flush()
            sys.exit(2)
        src = args[1]
        try:
            out = run_quiz_extractor(src)
            with _OUT_LOCK:
                sys.stdout.write(safe_json(out) + "\n")
                sys.stdout.flush()
        except BaseException as e:
            err = to_agent_error(e)
            with _OUT_LOCK:
                sys.stderr.write(f"quiz_extractor error [{err.code}]: {err}\n")
                sys.stderr.flush()
            sys.exit(1)
        return

    if len(args) >= 1 and args[0] == "run_batch":
        if len(args) < 2:
            with _OUT_LOCK:
                sys.stderr.write("Usage: python this_file.py run_batch <file...>\n")
                sys.stderr.flush()
            sys.exit(2)
        run_batch(args[1:], concurrency=3)
        return

    # No args -> demo
    _self_contained_demo()


if __name__ == "__main__":
    try:
        main()
    except BaseException as e:
        err = to_agent_error(e)
        with _OUT_LOCK:
            sys.stderr.write(f"fatal [{err.code}]: {err}\n")
            sys.stderr.flush()
        sys.exit(1)