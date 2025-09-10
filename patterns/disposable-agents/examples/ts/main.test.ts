import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Partially mock node:crypto to make randomUUID deterministic while preserving real hashing
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  // Pre-seeded deterministic IDs; tests can also override via mock implementations if needed
  const ids = ["run-aaa", "run-bbb", "run-ccc", "run-ddd", "run-eee"];
  let i = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => ids[i++] ?? `run-${i}`),
  };
});

import * as SUT from "./main";
import * as crypto from "node:crypto";

describe("Disposable Agents: quiz_extractor", () => {
  // Utility to create an isolated temp directory
  async function tempDir(prefix = "vitest-quiz-extractor-"): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  }

  // Utility Markdown builders for test scenarios
  const mdValidSingle = [
    "# Title",
    "```quiz",
    "Q: 2 + 2 = ?",
    "Choices: 1 | 2 | 3 | 4",
    "Answer: 4",
    "```",
  ].join("\n");

  const mdValidMultiBlock = [
    "# Lesson",
    "Intro",
    "```quiz",
    "Q: A?",
    "Choices: X | Y",
    "Answer: 1",
    "",
    "Q: B?",
    "Choices: A | B | C",
    "Answer: 2",
    "```",
    "",
    "Some text",
    "```quiz",
    "Q: C?",
    "Choices: 0 | 1",
    "Answer: 2",
    "```",
  ].join("\n");

  const mdNoQuiz = ["# No quiz here", "```js", "console.log('hi')", "```"].join("\n");

  const mdInvalidValidation = [
    "# Invalid",
    "```quiz",
    "Q: Too high answer index?",
    "Choices: foo | bar",
    "Answer: 3",
    "```",
  ].join("\n");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("sha256", () => {
    it("computes stable, deterministic hashes", async () => {
      const h1 = await SUT.sha256("abc");
      const h2 = await SUT.sha256("abc");
      const h3 = await SUT.sha256("abcd");

      // Known vector for 'abc'
      expect(h1).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
      expect(h2).toBe(h1);
      expect(h3).not.toBe(h1);
    });
  });

  describe("safeJSON", () => {
    it("serializes without pretty printing and round-trips losslessly", () => {
      const obj = { a: 1, b: "x", c: [1, 2, 3] };
      const s = SUT.safeJSON(obj);

      // No spaces/newlines for compact output
      expect(s.includes(" ")).toBe(false);
      expect(s.includes("\n")).toBe(false);

      const parsed = JSON.parse(s);
      expect(parsed).toEqual(obj);
    });
  });

  describe("toAgentError", () => {
    it("returns the same AgentError instance unchanged", () => {
      // Construct an AgentError via public export if available
      // If AgentError is part of the public API, verify pass-through behavior
      expect(typeof (SUT as any).AgentError).toBe("function");
      const AgentErrorCtor = (SUT as unknown as { AgentError: new (code: "VALIDATION" | "TIMEOUT" | "MODEL" | "IO", msg: string) => Error & { code: string } }).AgentError;
      const err = new AgentErrorCtor("MODEL", "test");
      const coerced = SUT.toAgentError(err);
      expect(coerced).toBe(err);
      expect((coerced as { code: string }).code).toBe("MODEL");
      expect(coerced.message).toBe("test");
    });

    it("wraps non-AgentError into an AgentError with MODEL code", () => {
      const e = new Error("boom");
      const coerced = SUT.toAgentError(e);
      expect(coerced).toBeInstanceOf(Error);
      expect((coerced as { code: string }).code).toBe("MODEL");
      expect(coerced.message).toBe("boom");
    });
  });

  describe("parseQuizBlocks", () => {
    it("parses multiple quiz blocks and normalizes answers to 0-based indices", () => {
      const payload = SUT.parseQuizBlocks(mdValidMultiBlock);
      // Expected 3 questions across two blocks
      expect(payload.questions).toHaveLength(3);
      // Answer lines are 1-based; payload must be 0-based
      expect(payload.questions[0].answerIndex).toBe(0);
      expect(payload.questions[1].answerIndex).toBe(1);
      expect(payload.questions[2].answerIndex).toBe(1);
      // Strings are trimmed
      expect(payload.questions[0].choices[0]).toBe("X");
    });

    it("throws a MODEL error when no quiz blocks are found", () => {
      expect(() => SUT.parseQuizBlocks(mdNoQuiz)).toThrowErrorMatchingObject({ code: "MODEL" });
    });
  });

  describe("normalizeQuizBlock", () => {
    it("extracts valid question triples inside a single block, skipping malformed ones", () => {
      const body = [
        "Q: Valid one?",
        "Choices: a | b",
        "Answer: 1",
        "",
        "Q: Missing answer should be skipped",
        "Choices: a | b",
        "",
        "Q: Another valid",
        "Choices: x | y | z",
        "Answer: 3",
      ].join("\n");

      const qs = SUT.normalizeQuizBlock(body);
      expect(qs).toHaveLength(2);
      expect(qs[0].stem).toBe("Valid one?");
      expect(qs[0].answerIndex).toBe(0);
      expect(qs[1].stem).toBe("Another valid");
      expect(qs[1].answerIndex).toBe(2);
    });
  });

  describe("callModelOnce", () => {
    it("resolves under normal conditions (within timeout)", async () => {
      vi.useFakeTimers();
      const p = SUT.callModelOnce(mdValidSingle, { timeoutMs: 1000, retry: 1 });

      // The mock 'model' introduces a 10ms delay. Fast-forward time to complete.
      await vi.advanceTimersByTimeAsync(10);
      const payload = await p;
      expect(payload.questions).toHaveLength(1);
      expect(payload.questions[0].answerIndex).toBe(3); // Answer: 4 -> 0-based 3
    });

    it("times out when timeoutMs is smaller than the simulated latency", async () => {
      vi.useFakeTimers();
      const p = SUT.callModelOnce(mdValidSingle, { timeoutMs: 5, retry: 0 });
      await vi.advanceTimersByTimeAsync(5);
      await expect(p).rejects.toMatchObject({ code: "TIMEOUT" });
    });

    it("retries once on MODEL errors and then surfaces the error", async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(SUT, "parseQuizBlocks");
      const p = SUT.callModelOnce(mdNoQuiz, { timeoutMs: 1000, retry: 1 });
      // Each attempt waits 10ms
      await vi.advanceTimersByTimeAsync(20);
      await expect(p).rejects.toMatchObject({ code: "MODEL" });
      // Should attempt twice
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("does not retry on VALIDATION errors", async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(SUT, "parseQuizBlocks");
      const p = SUT.callModelOnce(mdInvalidValidation, { timeoutMs: 1000, retry: 3 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(p).rejects.toMatchObject({ code: "VALIDATION" });
      // Validate no retries occurred
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("runQuizExtractor", () => {
    it("produces a complete, deterministic output and logs start/finish events", async () => {
      const tmp = await tempDir();
      const file = path.join(tmp, "quiz.md");
      await fs.writeFile(file, mdValidSingle, "utf8");

      // Spy on stderr to capture structured logs
      type Write = NodeJS.WriteStream["write"];
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      }) as unknown as Write);

      // Provide deterministic runId sequence via our crypto mock
      const runIdMock = vi.spyOn(crypto, "randomUUID");

      const out = await SUT.runQuizExtractor(file);

      // Check runId and metadata
      expect(runIdMock).toHaveBeenCalledTimes(1);
      expect(out.runId).toBe("run-aaa");
      expect(out.agent.name).toBe("quiz_extractor");
      expect(out.model.name).toBe("mock-quiz-parser");
      expect(out.model.temperature).toBe(0);

      // Input provenance
      expect(out.input.sourceFile).toBe(path.resolve(file));
      expect(out.input.sourceBytes).toBe(Buffer.byteLength(mdValidSingle, "utf8"));
      const expectedDigest = await SUT.sha256(mdValidSingle);
      expect(out.input.sha256).toBe(expectedDigest);

      // Payload is validated and non-empty
      expect(out.payload.questions).toHaveLength(1);

      // Logs: start and finish events with the run id
      const logs = stderrLines.join("").trim().split("\n").map((l) => JSON.parse(l));
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ agent: "quiz_extractor", event: "start", run: out.runId });
      expect(logs[1]).toMatchObject({ event: "finish", questions: 1, run: out.runId });

      errSpy.mockRestore();
    });

    it("throws IO error for missing files and logs only the start event", async () => {
      // Spy on stderr to assert a start log is emitted
      type Write = NodeJS.WriteStream["write"];
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      }) as unknown as Write);

      await expect(SUT.runQuizExtractor(path.join(os.tmpdir(), "non-existent-file.md"))).rejects.toMatchObject({
        code: "IO",
      });

      const logs = stderrLines.join("").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "start", agent: "quiz_extractor" });

      errSpy.mockRestore();
    });

    it("surfaces model extraction errors (MODEL) and does not log finish", async () => {
      const tmp = await tempDir();
      const file = path.join(tmp, "no-quiz.md");
      await fs.writeFile(file, mdNoQuiz, "utf8");

      type Write = NodeJS.WriteStream["write"];
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      }) as unknown as Write);

      await expect(SUT.runQuizExtractor(file)).rejects.toMatchObject({ code: "MODEL" });

      const logs = stderrLines.join("").trim().split("\n").map((l) => JSON.parse(l));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "start", agent: "quiz_extractor" });

      errSpy.mockRestore();
    });
  });

  describe("writeArtifact", () => {
    it("writes the output JSON to the artifacts directory by runId", async () => {
      const tmp = await tempDir();
      const file = path.join(tmp, "quiz.md");
      await fs.writeFile(file, mdValidSingle, "utf8");

      const out = await SUT.runQuizExtractor(file);
      const artifactsDir = path.join(tmp, "artifacts");
      const artifactPath = await SUT.writeArtifact(out, artifactsDir);

      expect(artifactPath).toBe(path.join(artifactsDir, `${out.runId}.json`));

      const raw = await fs.readFile(artifactPath, "utf8");
      const obj = JSON.parse(raw);
      expect(obj).toEqual(out);
    });
  });

  describe("runBatch", () => {
    it("processes multiple files, writes artifacts, and emits summary JSON lines", async () => {
      const tmp = await tempDir();
      const cwdBefore = process.cwd();
      try {
        process.chdir(tmp);

        // Prepare files: two valid, one invalid
        const f1 = path.join(tmp, "a.md");
        const f2 = path.join(tmp, "b.md");
        const f3 = path.join(tmp, "c.md");
        await fs.writeFile(f1, mdValidSingle, "utf8");
        await fs.writeFile(f2, mdValidSingle, "utf8");
        await fs.writeFile(f3, mdNoQuiz, "utf8");

        // Capture stdout summary lines
        type Write = NodeJS.WriteStream["write"];
        const stdoutLines: string[] = [];
        const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
          stdoutLines.push(String(chunk));
          return true;
        }) as unknown as Write);

        await SUT.runBatch([f1, f2, f3], 2);

        // Parse summary JSONL
        const lines = stdoutLines.join("").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

        // Expect two ok and one error
        const oks = lines.filter((l) => l.status === "ok");
        const errs = lines.filter((l) => l.status === "error");
        expect(oks).toHaveLength(2);
        expect(errs).toHaveLength(1);
        expect(errs[0]).toMatchObject({ file: f3, code: "MODEL" });

        // Artifacts created for successful runs
        const artifactsDir = path.join(tmp, "artifacts_quiz_extractor");
        for (const ok of oks) {
          const artifact = path.join(artifactsDir, `${ok.runId}.json`);
          const exists = await fs.readFile(artifact, "utf8");
          expect(JSON.parse(exists)).toMatchObject({ runId: ok.runId, input: { sourceFile: expect.any(String) } });
        }

        outSpy.mockRestore();
      } finally {
        process.chdir(cwdBefore);
      }
    });
  });
});