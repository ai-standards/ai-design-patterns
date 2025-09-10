import type * as SUTTypes from "./main";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

type SUTModule = typeof import("./main");
let SUT: SUTModule;

beforeAll(async () => {
  // Silence any console output in main() if the module executes on import.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  SUT = await import("./main");
});

beforeEach(() => {
  // Use fake timers for deterministic Date.now() behavior inside the extraction loop.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-03-10T12:00:00Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseDoc", () => {
  it("parses sections, timezone, and publish date hints", () => {
    const text = [
      "City of Example (EST)",
      "Published: February 2, 2024",
      "",
      "SCHEDULE",
      "Bids due: March 5, 2024 2:00 PM EST",
      "",
      "BUDGET",
      "Not-to-Exceed (NTE) Budget: $50,000 USD",
    ].join("\n");

    const doc = SUT.parseDoc(text);

    // Section headers should be keys in the sections map.
    expect(Object.keys(doc.sections)).toContain("SCHEDULE");
    expect(Object.keys(doc.sections)).toContain("BUDGET");

    // Timezone inference includes America/New_York when EST/EDT is present.
    expect(doc.timezone).toBe("America/New_York");

    // Publish date should be present and parsable.
    expect(doc.publishDate).toBeInstanceOf(Date);
    expect(doc.publishDateText).toContain("Published:");
  });
});

describe("act and tools integration", () => {
  it("table tool prefers Not-to-Exceed/NTE budget over sample figures", async () => {
    const text = [
      "HEADER",
      "BUDGET",
      "Sample amount: $1,000,000",
      "Not-to-Exceed (NTE) Budget: $100,000 USD",
    ].join("\n");
    const doc = SUT.parseDoc(text);

    const artifact = await SUT.act({ field: "budget", tool: "table", hint: "not-to-exceed" }, doc);

    expect(typeof artifact.value).toBe("number");
    expect(artifact.value).toBe(100000);
    expect(String(artifact.evidence).toLowerCase()).toMatch(/not[- ]?to[- ]?exceed|nte/);
  });

  it("regex tool extracts contact email", async () => {
    const text = [
      "CONTACT",
      "For questions, email procurement@example.org or call 555-0100.",
    ].join("\n");
    const doc = SUT.parseDoc(text);

    const artifact = await SUT.act({ field: "contactEmail", tool: "regex", hint: "contact email" }, doc);

    expect(artifact.value).toBe("procurement@example.org");
    expect(String(artifact.evidence)).toContain("procurement@example.org");
  });

  it("regex tool extracts delivery method from SUBMISSION", async () => {
    const text = [
      "SUBMISSION",
      "Proposals must be submitted online via the City Portal.",
    ].join("\n");
    const doc = SUT.parseDoc(text);

    const artifact = await SUT.act({ field: "deliveryMethod", tool: "regex", hint: "submission method" }, doc);

    expect(artifact.value).toBe("online");
    expect(String(artifact.evidence).toLowerCase()).toContain("submitted online");
  });

  it("llm tool targets the correct due date (Bids due) when present", async () => {
    const text = [
      "Published: March 3, 2024",
      "SCHEDULE",
      "Questions due: March 1, 2024 5:00 PM",
      "Bids due: March 5, 2024 2:00 PM EST",
    ].join("\n");
    const doc = SUT.parseDoc(text);

    const artifact = await SUT.act({ field: "dueDate", tool: "llm", hint: "bids due" }, doc);

    expect(artifact.value).toBeInstanceOf(Date);
    expect(String(artifact.evidence).toLowerCase()).toContain("bids due:");
    // Sanity: extracted date should be after the publish date.
    const due = artifact.value as Date;
    expect(due.getTime()).toBeGreaterThan((doc.publishDate as Date).getTime());
  });

  it("section tool returns a scoped blob and clear evidence", async () => {
    const text = [
      "SCHEDULE",
      "Line A",
      "",
      "BUDGET",
      "Line B",
      "",
      "SUBMISSION",
      "Line C",
    ].join("\n");
    const doc = SUT.parseDoc(text);

    const artifact = await SUT.act({ field: "budget", tool: "section", hint: "budget" }, doc);

    // Should pull one of the known sections and include it in evidence.
    expect(String(artifact.evidence)).toMatch(/^Section:(SCHEDULE|BUDGET|SUBMISSION)/);
    expect(typeof artifact.value).toBe("string");
  });
});

describe("planner (planNext) heuristics", () => {
  it("prioritizes dueDate with regex initially, then escalates to llm after a failure", () => {
    type Ctx = Parameters<typeof SUT.planNext>[0];

    const doc = SUT.parseDoc(["Published: March 3, 2024", "SCHEDULE", "Bids due: March 5, 2024 2:00 PM EST"].join("\n"));

    // New context: nothing extracted yet.
    const ctx1: Ctx = {
      values: {},
      evidence: {},
      publishDate: doc.publishDate,
      publishDateText: doc.publishDateText,
      timezone: doc.timezone,
      failureCounts: new Map(),
      history: [],
    };

    // First plan: should target dueDate with regex.
    const step1 = SUT.planNext(ctx1, [], doc);
    expect(step1).not.toBeNull();
    expect(step1?.field).toBe("dueDate");
    expect(step1?.tool).toBe("regex");

    // Simulate a dueDate-related failure and ensure escalation to llm.
    const ctx2: Ctx = {
      ...ctx1,
      failureCounts: new Map([["dueDate", 1]]),
    };
    const step2 = SUT.planNext(ctx2, [{ field: "dueDate", message: "Due date precedes publish date" }], doc);
    expect(step2?.field).toBe("dueDate");
    expect(step2?.tool).toBe("llm");
  });

  it("escalates budget to table after a failure", () => {
    type Ctx = Parameters<typeof SUT.planNext>[0];

    const doc = SUT.parseDoc("BUDGET\nNot-to-Exceed Budget: $10,000 USD");

    const ctx: Ctx = {
      values: { /* no budget yet */ },
      evidence: {},
      failureCounts: new Map([["budget", 1]]),
      history: [],
      publishDate: undefined,
      publishDateText: undefined,
      timezone: "UTC",
    };

    const step = SUT.planNext(ctx, [{ field: "budget", message: "Large value found without cap language" }], doc);
    expect(step?.field).toBe("budget");
    expect(step?.tool).toBe("table");
  });
});

describe("validators (validate)", () => {
  it("flags budget evidence missing explicit USD markers", () => {
    type Ctx = Parameters<typeof SUT.validate>[0];

    const ctx = {
      values: { budget: 75000 },
      evidence: { budget: "Budget cap: 75000" }, // No $ or USD markers
      failureCounts: new Map<string, number>(),
      history: [],
      publishDate: undefined,
      publishDateText: undefined,
      timezone: "UTC",
    } as unknown as Ctx;

    const issues = SUT.validate(ctx);

    expect(issues.some((i) => i.field === "budget" && /USD markers/i.test(i.message))).toBe(true);
  });

  it("flags invalid email formats", () => {
    type Ctx = Parameters<typeof SUT.validate>[0];

    const ctx = {
      values: { contactEmail: "bad@invalid" }, // missing TLD
      evidence: {},
      failureCounts: new Map<string, number>(),
      history: [],
      publishDate: undefined,
      publishDateText: undefined,
      timezone: "UTC",
    } as unknown as Ctx;

    const issues = SUT.validate(ctx);

    expect(issues.some((i) => i.field === "contactEmail" && /Invalid email format/i.test(i.message))).toBe(true);
  });

  it("flags due date earlier than publish date", () => {
    type Ctx = Parameters<typeof SUT.validate>[0];

    const publishDate = new Date("2024-03-03T00:00:00Z");
    const dueDate = new Date("2024-03-01T00:00:00Z");

    const ctx = {
      values: { dueDate },
      evidence: { dueDate: "Questions due: March 1, 2024" },
      failureCounts: new Map<string, number>(),
      history: [],
      publishDate,
      publishDateText: "Published: March 3, 2024",
      timezone: "America/New_York",
    } as unknown as Ctx;

    const issues = SUT.validate(ctx);

    expect(issues.some((i) => i.field === "dueDate" && /precedes publish date/i.test(i.message))).toBe(true);
  });
});

describe("runExtraction end-to-end", () => {
  it("extracts all fields on a clean document and stops with 'all fields valid'", async () => {
    const text = [
      "City of Springfield (EST)",
      "Published: March 3, 2024",
      "",
      "SCHEDULE",
      "Questions due: March 1, 2024 5:00 PM",
      "Bids due: March 5, 2024 2:00 PM EST",
      "",
      "BUDGET",
      "Sample Amount: $1,000,000",
      "Not-to-Exceed Budget: $100,000 USD",
      "",
      "POLICIES",
      "A mandatory pre-bid site visit is required.",
      "",
      "SUBMISSION",
      "Proposals must be submitted online via the City Portal.",
      "",
      "CONTACT",
      "For questions, email procurement@springfield.gov or call 555-0100.",
    ].join("\n");

    const doc = SUT.parseDoc(text);
    const result = await SUT.runExtraction(doc);

    // Core field assertions
    expect(result.values.dueDate).toBeInstanceOf(Date);
    expect(result.values.budget).toBe(100000);
    expect(result.values.preBidRequired).toBe(true);
    expect(result.values.contactEmail).toBe("procurement@springfield.gov");
    expect(result.values.deliveryMethod).toBe("online");

    // Evidence should include recognizable fragments
    expect(String(result.evidence.budget)).toMatch(/Not-to-Exceed|NTE|USD/i);
    expect(String(result.evidence.dueDate)).toMatch(/Bids due:/i);

    // The agent should complete successfully under limits.
    expect(result.stopReason).toBe("all fields valid");
    expect(result.steps).toBeGreaterThan(0);
    expect(result.steps).toBeLessThanOrEqual(8);

    // History is captured for auditability.
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history.length).toBeGreaterThan(0);
  });

  it("detects stagnation when only 'Questions due' is present (no 'Bids due')", async () => {
    const text = [
      "Published: March 3, 2024",
      "",
      "SCHEDULE",
      "Questions due: March 1, 2024 5:00 PM",
      // No "Bids due" line; forces the agent to pick an invalid due date twice.
      "",
      "BUDGET",
      "Not-to-Exceed Budget: $60,000 USD",
      "",
      "SUBMISSION",
      "Proposals must be submitted online.",
      "",
      "CONTACT",
      "email: buyer@example.com",
    ].join("\n");

    const doc = SUT.parseDoc(text);
    const result = await SUT.runExtraction(doc);

    // The loop should halt due to repeated dueDate failures.
    expect(result.stopReason).toBe("stagnation detected");

    // At least two initial steps targeting dueDate should record the same validator issue.
    const firstTwo = result.history.slice(0, 2);
    expect(firstTwo.length).toBeGreaterThanOrEqual(2);
    for (const entry of firstTwo) {
      expect(entry.step.field).toBe("dueDate");
      expect(entry.issues.some((i) => /precedes publish date/i.test(i.message))).toBe(true);
    }

    // Plan adjustment should switch to llm for dueDate.
    expect(firstTwo[0]?.planAdjustment?.tool).toBe("llm");
  });

  it("stops by step limit when planner keeps returning a null-y extraction (no validator issues)", async () => {
    // Build a simple doc with no extractable fields to emphasize the stop condition.
    const doc = SUT.parseDoc("HEADER\nNo actionable content.");

    // Force the planner to always request the same field, and the actor to return null values.
    const planSpy = vi.spyOn(SUT, "planNext").mockReturnValue({
      field: "dueDate",
      tool: "regex",
      hint: "proposal due",
    });
    const actSpy = vi.spyOn(SUT, "act").mockResolvedValue({
      field: "dueDate",
      value: null,
      evidence: "no match",
      tool: "regex",
      hint: "proposal due",
    });

    const result = await SUT.runExtraction(doc);

    expect(result.stopReason).toBe("step limit");
    expect(result.steps).toBe(8); // loop upper bound
    expect(planSpy).toHaveBeenCalled();
    expect(actSpy).toHaveBeenCalled();
  });
});