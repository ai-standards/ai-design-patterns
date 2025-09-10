/**
 * Disposable Agent pattern (mocked) — quiz_extractor
 *
 * This single TypeScript file demonstrates:
 * - A tiny, one-run “agent” that reads one file, extracts quiz data, validates it strictly,
 *   prints JSON to stdout, and exits. No memory, no background loops, no shared caches.
 * - A minimal orchestration that can batch-run many files and collect outputs.
 * - Deterministic behavior, strict schemas, timeouts, retries, and structured logs.
 *
 * How to run:
 *   ts-node this_file.ts                               # runs the built-in demo (creates temp files)
 *   ts-node this_file.ts quiz_extractor path/to.md     # run the agent on a single file (JSON to stdout)
 *   ts-node this_file.ts run_batch file1.md file2.md   # run the batch orchestrator (summary JSON lines)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// ------------------------------------------------------------
// Types: explicit, minimal, and stable contracts
// ------------------------------------------------------------

/**
 * QuizQuestion encodes the normalized structure the CMS importer expects.
 * - stem: the text of the question prompt
 * - choices: two or more options
 * - answerIndex: index into choices indicating the correct answer (0-based)
 */
type QuizQuestion = {
  stem: string;
  choices: string[];
  answerIndex: number; // 0-based
};

/**
 * QuizPayload is the strict content the agent must produce.
 * Additional metadata is added by the agent runner for auditing.
 */
type QuizPayload = {
  questions: QuizQuestion[];
};

/**
 * QuizAgentOutput is the final JSON document this agent prints to stdout.
 * It contains:
 * - runId: unique per run for traceability
 * - agent: stable agent identifier (useful after scripts are archived)
 * - model: pinned "version" and parameters used for deterministic behavior
 * - input: hashes and file info so an auditor can reproduce or trace the run
 * - payload: the strictly validated quiz payload
 */
type QuizAgentOutput = {
  runId: string;
  agent: {
    name: "quiz_extractor";
    version: string; // increment when logic changes
  };
  model: {
    name: "mock-quiz-parser";
    version: "1.0.0";
    temperature: 0;
  };
  input: {
    sourceFile: string;
    sourceBytes: number;
    sha256: string;
  };
  payload: QuizPayload;
};

/**
 * Narrow error to a predictable shape for logging and exit paths.
 * Agent failures must be concise and machine-readable if needed.
 */
class AgentError extends Error {
  readonly code: "VALIDATION" | "TIMEOUT" | "MODEL" | "IO";
  constructor(code: AgentError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// ------------------------------------------------------------
// Utilities: tiny helpers that are easy to reason about and test
// ------------------------------------------------------------

/**
 * sha256 computes a stable hash of the input string.
 * This is used to log input provenance without storing raw content.
 */
async function sha256(input: string): Promise<string> {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * safeJSON ensures deterministic JSON output:
 * - No pretty printing to keep artifacts small.
 * - Fails closed if the object cannot be stringified (should not happen here).
 */
function safeJSON(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * logEvent prints structured diagnostic events to stderr, not stdout.
 * This keeps stdout clean for the final JSON that downstream tools consume.
 * The events include a runId for joinability in logs.
 */
function logEvent(ev: Record<string, unknown>): void {
  process.stderr.write(safeJSON(ev) + "\n");
}

/**
 * Ensure a string is non-empty after trimming. Throws AgentError on failure.
 */
function assertNonEmptyString(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AgentError("VALIDATION", `Expected non-empty string for ${field}`);
  }
}

/**
 * Ensure a number is a non-negative integer. Throws AgentError on failure.
 */
function assertNonNegativeInt(field: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AgentError("VALIDATION", `Expected non-negative integer for ${field}`);
  }
}

/**
 * Validate a QuizQuestion strictly. Throws AgentError on failure.
 * Design choice: fail fast and loud. Content variance is high; predictable behavior matters.
 */
function validateQuestion(q: unknown, idx: number): asserts q is QuizQuestion {
  if (typeof q !== "object" || q === null) {
    throw new AgentError("VALIDATION", `Question #${idx} must be an object`);
  }
  const obj = q as Record<string, unknown>;
  assertNonEmptyString(`questions[${idx}].stem`, obj.stem);
  if (!Array.isArray(obj.choices) || obj.choices.length < 2) {
    throw new AgentError("VALIDATION", `questions[${idx}].choices must be an array with at least 2 items`);
  }
  for (let i = 0; i < obj.choices.length; i++) {
    assertNonEmptyString(`questions[${idx}].choices[${i}]`, obj.choices[i]);
  }
  assertNonNegativeInt(`questions[${idx}].answerIndex`, obj.answerIndex);
  if ((obj.answerIndex as number) >= obj.choices.length) {
    throw new AgentError("VALIDATION", `questions[${idx}].answerIndex out of range`);
  }
}

/**
 * Validate a QuizPayload strictly. Throws AgentError on failure.
 */
function validateQuizPayload(p: unknown): asserts p is QuizPayload {
  if (typeof p !== "object" || p === null) {
    throw new AgentError("VALIDATION", "payload must be an object");
  }
  const obj = p as { questions?: unknown };
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
    throw new AgentError("VALIDATION", "payload.questions must be a non-empty array");
  }
  obj.questions.forEach((q, i) => validateQuestion(q, i));
}

// ------------------------------------------------------------
// Mock "model" call with timeouts and retries
// ------------------------------------------------------------

/**
 * parseQuizBlocks simulates an LLM that extracts normalized quiz data from Markdown.
 *
 * The expected fenced block format is intentionally constrained and deterministic:
 *   ```quiz
 *   Q: What is 2 + 2?
 *   Choices: 2 | 3 | 4 | 5
 *   Answer: 3
 *   ```
 * Notes:
 * - Answer is 1-based in the source (common in author notes), converted to 0-based.
 * - Multiple quiz blocks are supported; they concatenate into one questions array.
 * - Extra whitespace is tolerated; anything outside quiz blocks is ignored.
 */
function parseQuizBlocks(markdown: string): QuizPayload {
  const lines = markdown.split(/\r?\n/);
  const questions: QuizQuestion[] = [];

  let inQuiz = false;
  let buf: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inQuiz && trimmed.startsWith("```quiz")) {
      inQuiz = true;
      buf = [];
      continue;
    }
    if (inQuiz && trimmed === "```") {
      // Flush one quiz block
      const block = buf.join("\n");
      const q = normalizeQuizBlock(block);
      questions.push(...q);
      inQuiz = false;
      buf = [];
      continue;
    }
    if (inQuiz) buf.push(line);
  }

  if (questions.length === 0) {
    throw new AgentError("MODEL", "No quiz blocks found");
  }

  // Validate immediately before returning to enforce strict contract.
  validateQuizPayload({ questions });
  return { questions };
}

/**
 * normalizeQuizBlock parses a single fenced block body into zero or more questions.
 * The function supports multiple Q/Choices/Answer triples inside one block.
 */
function normalizeQuizBlock(blockBody: string): QuizQuestion[] {
  const qs: QuizQuestion[] = [];
  // Split into conceptual "records" by blank lines
  const parts = blockBody.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Extract fields using simple, resilient patterns
    const qMatch = part.match(/^\s*Q:\s*(.+)$/im);
    const cMatch = part.match(/^\s*Choices:\s*(.+)$/im);
    const aMatch = part.match(/^\s*Answer:\s*(\d+)\s*$/im);

    if (!qMatch || !cMatch || !aMatch) {
      // Skip malformed segments; let validator or outer logic decide if zero are found.
      continue;
    }
    const stem = qMatch[1].trim();
    const choices = cMatch[1].split("|").map(s => s.trim()).filter(Boolean);
    const answer1Based = Number(aMatch[1]);
    const answerIndex = answer1Based - 1;

    const candidate: QuizQuestion = { stem, choices, answerIndex };
    // Validate each candidate immediately for clearer error messages
    validateQuestion(candidate, qs.length);
    qs.push(candidate);
  }
  return qs;
}

/**
 * callModelOnce wraps the mock parser with:
 * - a timeout (to avoid hanging runs),
 * - a single retry on model failure (not on validation),
 * - deterministic "model metadata" for auditing.
 *
 * Tradeoffs:
 * - A single retry can absorb rare transient errors without hiding systemic issues.
 * - Deterministic behavior (temperature 0) keeps results stable for auditing.
 */
async function callModelOnce(markdown: string, opts: { timeoutMs: number; retry: number }): Promise<QuizPayload> {
  const attempt = async (): Promise<QuizPayload> => {
    // Simulate tiny, predictable latency to mimic real calls and exercise the timeout path.
    await new Promise((r) => setTimeout(r, 10));
    // Deterministic mock: parse the markdown; throw AgentError("MODEL") on no blocks.
    return parseQuizBlocks(markdown);
  };

  const withTimeout = async (): Promise<QuizPayload> => {
    return await Promise.race<Promise<QuizPayload>>([
      attempt(),
      new Promise<never>((_resolve, reject) => {
        const t = setTimeout(() => reject(new AgentError("TIMEOUT", "Model call timed out")), opts.timeoutMs);
        // Ensures Node can exit promptly if the attempt resolves first:
        t.unref?.();
      }),
    ]);
  };

  try {
    return await withTimeout();
  } catch (err) {
    const e = toAgentError(err);
    if (opts.retry > 0 && e.code === "MODEL") {
      // Retry once for model extraction issues; validation/timeout errors should surface.
      return await callModelOnce(markdown, { timeoutMs: opts.timeoutMs, retry: opts.retry - 1 });
    }
    throw e;
  }
}

// ------------------------------------------------------------
// Agent implementation (quiz_extractor)
// ------------------------------------------------------------

/**
 * runQuizExtractor is the disposable agent entrypoint for one file.
 * - Reads the file
 * - Computes provenance metadata
 * - Calls the "model" with strict contracts
 * - Validates the payload
 * - Prints a single JSON object to stdout and returns it to callers
 *
 * Errors are thrown as AgentError and should be handled by the CLI harness to set exit codes.
 */
async function runQuizExtractor(sourceFile: string): Promise<QuizAgentOutput> {
  const runId = crypto.randomUUID();
  logEvent({ ts: Date.now(), run: runId, level: "info", event: "start", agent: "quiz_extractor", file: sourceFile });

  let content: string;
  try {
    content = await fs.readFile(sourceFile, "utf8");
  } catch (e) {
    throw new AgentError("IO", `Failed to read file: ${sourceFile}`);
  }
  const digest = await sha256(content);
  const payload = await callModelOnce(content, { timeoutMs: 2000, retry: 1 });

  // Double-validate to enforce the contract at the boundary (defense in depth).
  validateQuizPayload(payload);

  const out: QuizAgentOutput = {
    runId,
    agent: { name: "quiz_extractor", version: "1.0.0" },
    model: { name: "mock-quiz-parser", version: "1.0.0", temperature: 0 },
    input: {
      sourceFile: path.resolve(sourceFile),
      sourceBytes: Buffer.byteLength(content, "utf8"),
      sha256: digest,
    },
    payload,
  };

  logEvent({ ts: Date.now(), run: runId, level: "info", event: "finish", questions: payload.questions.length });
  return out;
}

// ------------------------------------------------------------
// CLI harness and small batch orchestrator
// ------------------------------------------------------------

/**
 * toAgentError coerces unknown errors into AgentError for consistent handling.
 */
function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  const m = err instanceof Error ? err.message : String(err);
  return new AgentError("MODEL", m);
}

/**
 * writeArtifact writes the agent's output to a simple artifact folder by runId.
 * This mirrors a common migration practice: store outputs alongside logs for audit.
 */
async function writeArtifact(out: QuizAgentOutput, dir: string): Promise<string> {
  const file = path.join(dir, `${out.runId}.json`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, safeJSON(out), "utf8");
  return file;
}

/**
 * runBatch executes the agent over files with a small concurrency limit,
 * logging a summary JSON line per file to stdout.
 *
 * Design notes:
 * - No shared caches or long-lived state; each run is independent.
 * - Fail closed: if anything throws, record an error result and continue.
 */
async function runBatch(files: string[], concurrency = 2): Promise<void> {
  const queue = [...files];
  const artifactsDir = path.join(process.cwd(), "artifacts_quiz_extractor");

  // Worker function that pulls files off the queue one at a time.
  async function worker(id: number): Promise<void> {
    while (true) {
      const file = queue.shift();
      if (!file) return;
      try {
        const out = await runQuizExtractor(file);
        await writeArtifact(out, artifactsDir);
        process.stdout.write(safeJSON({ status: "ok", file, runId: out.runId }) + "\n");
      } catch (e) {
        const err = toAgentError(e);
        process.stdout.write(safeJSON({ status: "error", file, code: err.code, message: err.message }) + "\n");
      }
    }
  }

  // Launch N workers; simple parallelization without external libs.
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, (_, i) => worker(i)));
}

// ------------------------------------------------------------
// Program entry: supports three modes
// 1) quiz_extractor <file>
// 2) run_batch <file...>
// 3) no args -> run a self-contained demo
// ------------------------------------------------------------

async function main(): Promise<void> {
  const [,, cmd, ...rest] = process.argv;

  if (cmd === "quiz_extractor") {
    // Single-run CLI: read a file, print JSON to stdout, exit non-zero on validation errors.
    if (rest.length !== 1) {
      console.error("Usage: ts-node this_file.ts quiz_extractor <file>");
      process.exit(2);
    }
    try {
      const out = await runQuizExtractor(rest[0]);
      process.stdout.write(safeJSON(out) + "\n");
    } catch (e) {
      const err = toAgentError(e);
      // Concise error to stderr; exit non-zero.
      console.error(`quiz_extractor error [${err.code}]: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "run_batch") {
    if (rest.length === 0) {
      console.error("Usage: ts-node this_file.ts run_batch <file...>");
      process.exit(2);
    }
    await runBatch(rest, 3);
    return;
  }

  // Self-contained demo:
  // - Creates a temp directory
  // - Writes three markdown files (two valid, one invalid)
  // - Runs the batch orchestrator
  // - Prints summary lines that demonstrate success and failure handling
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "disposable-agent-demo-"));
  const files: string[] = [];

  // Valid quiz with two questions in one block
  const md1 = [
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
  ].join("\n");

  // Valid quiz with one question, extra prose and formatting
  const md2 = [
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
  ].join("\n");

  // Invalid: no quiz block — should produce an error
  const md3 = [
    "# Lesson C",
    "This lesson forgot to include a quiz block.",
    "But contains a code fence:",
    "```js",
    "console.log('hello');",
    "```",
  ].join("\n");

  const f1 = path.join(tmp, "lesson-a.md");
  const f2 = path.join(tmp, "lesson-b.md");
  const f3 = path.join(tmp, "lesson-c.md");
  await fs.writeFile(f1, md1, "utf8");
  await fs.writeFile(f2, md2, "utf8");
  await fs.writeFile(f3, md3, "utf8");
  files.push(f1, f2, f3);

  // Run the batch with small concurrency and show structured results.
  await runBatch(files, 2);

  // Tip for exploration (not required): the artifacts directory contains full JSON outputs keyed by runId.
}

main().catch((e) => {
  const err = toAgentError(e);
  console.error(`fatal [${err.code}]: ${err.message}`);
  process.exit(1);
});