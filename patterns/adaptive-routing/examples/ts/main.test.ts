import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as SUT from "./main";

describe("Utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("estimateTokens: returns 0 for empty/undefined, positive and roughly monotonic otherwise", () => {
    // Basic sanity for empty-ish inputs
    expect(SUT.estimateTokens(undefined)).toBe(0);
    expect(SUT.estimateTokens("")).toBe(0);

    // Non-empty inputs should yield positive values and scale with text length
    const short = SUT.estimateTokens("hello world");
    const longer = SUT.estimateTokens("hello world this is a longer sentence with more words");
    expect(short).toBeGreaterThan(0);
    expect(longer).toBeGreaterThan(short);
  });

  it("detectLanguage: ASCII-heavy is 'en'; non-ASCII heavy content is 'other'; undefined defaults to 'en'", () => {
    expect(SUT.detectLanguage(undefined)).toBe("en");
    expect(SUT.detectLanguage("hello world")).toBe("en");

    // Mix of ASCII and significant non-ASCII should flip to "other"
    const mixed = "hello " + "こんにちは世界".repeat(3); // high non-ASCII ratio
    expect(SUT.detectLanguage(mixed)).toBe("other");
  });

  it("hasPII: detects loose credit-card-like sequences", () => {
    expect(SUT.hasPII("Card: 4111 1111 1111 1111")).toBe(true);
    expect(SUT.hasPII("Order number: 12345")).toBe(false);
    expect(SUT.hasPII(undefined)).toBe(false);
  });

  it("hasSubstantialImages: true for large image, false for small or undefined", () => {
    expect(SUT.hasSubstantialImages(undefined)).toBe(false);
    expect(SUT.hasSubstantialImages([{ width: 100, height: 100, channels: 3 }])).toBe(false);
    expect(SUT.hasSubstantialImages([{ width: 1024, height: 512, channels: 3 }])).toBe(true);
  });

  it("withTimeout: resolves if underlying promise resolves in time", async () => {
    const p = new Promise<string>(res => setTimeout(() => res("ok"), 15));
    await expect(SUT.withTimeout(p, 50)).resolves.toBe("ok");
  });

  it("withTimeout: rejects if underlying promise is too slow", async () => {
    const p = new Promise<string>(res => setTimeout(() => res("late"), 50));
    await expect(SUT.withTimeout(p, 10)).rejects.toThrow(/timeout after 10ms/);
  });
});

describe("Validation", () => {
  it("validateItinerary: returns ok for a sane single-leg itinerary", () => {
    const it = {
      legs: [
        {
          from: "SFO",
          to: "JFK",
          departISO: "2025-12-01T09:00:00Z",
          arriveISO: "2025-12-01T17:30:00Z",
          flightNo: "UA1234",
        },
      ],
      confidence: 0.9,
      source: "test",
    };
    const res = SUT.validateItinerary(it);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("validateItinerary: flags multiple issues for a bad itinerary", () => {
    const it = {
      legs: [
        {
          from: "SF", // invalid IATA (only 2 letters)
          to: "JFK",
          departISO: "2025-12-01T10:00:00Z",
          arriveISO: "2025-12-01T09:00:00Z", // arrival <= departure
          flightNo: "UA1", // suspicious (only 1 digit)
        },
      ],
      confidence: 0.5,
      source: "test",
    };
    const res = SUT.validateItinerary(it);
    expect(res.ok).toBe(false);
    expect(res.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/invalid from IATA/),
        expect.stringMatching(/arrival not after departure/),
        expect.stringMatching(/suspicious flight number/),
      ])
    );

    const empty = { legs: [], confidence: 0.1, source: "test" };
    const resEmpty = SUT.validateItinerary(empty as unknown as Parameters<typeof SUT.validateItinerary>[0]);
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.issues).toContain("no legs");
  });
});

describe("Feature extraction", () => {
  it("extractFeatures: aggregates text, detects images/lang/PII, and carries SLA", () => {
    const req = {
      id: "fx-1",
      mime: "text/html" as const,
      senderDomain: "airline.com",
      html: `Hello ${"é".repeat(30)}`, // ensure high non-ASCII ratio
      text: "My temporary card is 4111 1111 1111 1111",
      images: [{ width: 1024, height: 512, channels: 3, ocrText: "Some OCR text" }],
      userSla: "strict" as const,
      slaMs: 1234,
      maxBudget: 10,
    };

    const features = SUT.extractFeatures(req);
    expect(features.domain).toBe(req.senderDomain);
    expect(features.mime).toBe(req.mime);
    expect(features.hasImages).toBe(true);
    expect(features.language).toBe("other");
    expect(features.containsPII).toBe(true);
    expect(features.slaMs).toBe(req.slaMs);

    // Token estimation should match the estimator over the concatenated blob
    const expectedTokens = SUT.estimateTokens([req.text, req.html, ...(req.images?.map(i => i.ocrText) ?? [])].filter(Boolean).join("\n"));
    expect(features.tokens).toBe(expectedTokens);
  });
});

describe("Scoring policy", () => {
  it("scoreCandidate: prefers template for known domain HTML over others", () => {
    const req = {
      id: "sc-1",
      mime: "text/html" as const,
      senderDomain: "airline.com",
      html: "dummy",
      userSla: "standard" as const,
      slaMs: 2500,
      maxBudget: 10,
    };
    const f = SUT.extractFeatures(req);

    // Construct candidates to compare relative scores (run is unused here).
    const template = { name: "template-v1", cost: 1, supports: () => true, run: async () => Promise.reject(new Error("unreached")) };
    const small = { name: "small-llm", cost: 2, supports: () => true, run: async () => Promise.reject(new Error("unreached")) };
    const ocr = { name: "ocr+llm", cost: 6, supports: () => true, run: async () => Promise.reject(new Error("unreached")) };

    const sTemplate = SUT.scoreCandidate(f, template);
    const sSmall = SUT.scoreCandidate(f, small);
    const sOcr = SUT.scoreCandidate(f, ocr);

    expect(sTemplate).toBeGreaterThan(sSmall);
    expect(sTemplate).toBeGreaterThan(sOcr);
  });

  it("scoreCandidate: applies SLA penalty to heavy candidates under strict SLA", () => {
    // features with strict-ish SLA
    const fStrict = SUT.extractFeatures({
      id: "sc-2a",
      mime: "text/plain",
      userSla: "strict",
      slaMs: 1400,
      maxBudget: 10,
      text: "hi",
    } as const);

    // features with more relaxed SLA
    const fRelaxed = SUT.extractFeatures({
      id: "sc-2b",
      mime: "text/plain",
      userSla: "standard",
      slaMs: 3000,
      maxBudget: 10,
      text: "hi",
    } as const);

    const heavy = { name: "ocr+llm", cost: 6, supports: () => true, run: async () => Promise.reject(new Error("unreached")) };

    const sStrict = SUT.scoreCandidate(fStrict, heavy);
    const sRelaxed = SUT.scoreCandidate(fRelaxed, heavy);

    // Heavy candidate should be penalized by 25 under strict SLA
    expect(sRelaxed - sStrict).toBe(25);
  });

  it("difficultyScore: aggregates signals (images, long text, non-ASCII, PII)", () => {
    const longText = "word ".repeat(500); // should push tokens > 600
    const req = {
      id: "sc-3",
      mime: "text/plain" as const,
      userSla: "standard" as const,
      slaMs: 2000,
      maxBudget: 10,
      text: longText + " " + "é".repeat(50) + " 4111 1111 1111 1111", // non-ASCII + PII
      images: [{ width: 1024, height: 1024, channels: 3, ocrText: "OCR blob" }],
    };
    const f = SUT.extractFeatures(req);
    const d = SUT.difficultyScore(f);
    // Expected to be maximum additive (40 images + 30 heavy + 20 other + 10 PII) = 100
    expect(d).toBe(100);
  });
});

describe("Router end-to-end routing", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes known airline HTML to template-v1 (canary v2 considered but not chosen), passing validation", async () => {
    // Force template-v2 support for canary visibility and determinism
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0); // always < canaryShare

    const router = new SUT.Router(1, "test-policy");
    const req = {
      id: "req-html-1",
      mime: "text/html" as const,
      senderDomain: "airline.com",
      html: "FROM:SFO;TO:JFK;DEPART:2025-12-01T09:00:00Z;ARRIVE:2025-12-01T17:30:00Z;FLIGHT:UA1234",
      userSla: "standard" as const,
      slaMs: 2500,
      maxBudget: 3,
    };

    const result = await router.route(req);
    expect(result.source).toBe("template-v1");
    const v = SUT.validateItinerary(result);
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);

    // Verify telemetry: chosen is v1; considered includes template-v2 (due to canary)
    const telemetry = logSpy.mock.calls
      .map(args => args[0])
      .filter(arg => typeof arg === "string")
      .map(str => {
        try {
          return JSON.parse(String(str));
        } catch {
          return null;
        }
      })
      .filter((t): t is Record<string, unknown> => !!t && t.requestId === req.id);

    expect(telemetry.length).toBe(1);
    expect(telemetry[0]?.chosen).toBe("template-v1");
    const consideredNames = (telemetry[0]?.considered as Array<{ name: string; score: number; cost: number }>).map(c => c.name);
    expect(consideredNames).toEqual(expect.arrayContaining(["template-v1", "template-v2"]));

    randSpy.mockRestore();
  });

  it("routes short plain text to small-llm and produces a valid itinerary", async () => {
    const router = new SUT.Router(0, "test-policy");
    const req = {
      id: "req-text-1",
      mime: "text/plain" as const,
      senderDomain: "randommail.com",
      text: "Your flight UA4321 from LAX to BOS departs 2025-11-10 08:05 and arrives 2025-11-10 16:45.",
      userSla: "strict" as const,
      slaMs: 1200,
      maxBudget: 2,
    };

    const res = await router.route(req);
    expect(res.source).toBe("small-llm");
    const v = SUT.validateItinerary(res);
    expect(v.ok).toBe(true);
    expect(res.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("escalates from template to OCR+LLM on validation failure when images are present", async () => {
    const router = new SUT.Router(0, "test-policy");
    const req = {
      id: "req-escalate-ocr",
      mime: "text/html" as const,
      senderDomain: "airline.com",
      // HTML that does NOT match the template parser, forcing low confidence + no legs
      html: "This is an unstructured itinerary that template cannot parse.",
      // Provide a substantial image to make OCR+LLM supported and capable of extracting fields
      images: [
        {
          width: 1080,
          height: 1920,
          channels: 3,
          ocrText: "Vuelo IB2210 FROM MAD TO JFK DEPART 2025-10-02T10:00Z ARRIVE 2025-10-02T18:30Z",
        },
      ],
      userSla: "standard" as const,
      slaMs: 3000,
      maxBudget: 8,
    };

    const res = await router.route(req);
    // Expect escalation to OCR path which should produce a valid itinerary
    expect(res.source).toBe("ocr+llm");
    const v = SUT.validateItinerary(res);
    expect(v.ok).toBe(true);

    // Telemetry should record the escalation target
    const telemetry = logSpy.mock.calls
      .map(args => args[0])
      .filter(arg => typeof arg === "string")
      .map(str => {
        try {
          return JSON.parse(String(str));
        } catch {
          return null;
        }
      })
      .filter((t): t is Record<string, unknown> => !!t && t.requestId === req.id)
      .at(-1) as any;

    expect(telemetry.escalated).toBe("ocr+llm");
  });

  it("on primary timeout, escalates to fallback when OCR+LLM is not supported", async () => {
    const router = new SUT.Router(0, "test-policy");
    const req = {
      id: "req-timeout-fallback",
      mime: "text/html" as const,
      senderDomain: "airline.com",
      html: "FROM:SFO;TO:JFK;DEPART:2025-12-01T09:00:00Z;ARRIVE:2025-12-01T17:30:00Z;FLIGHT:UA1234",
      userSla: "strict" as const,
      // SLA shorter than the template parser latency (50ms) to trigger timeout
      slaMs: 10,
      maxBudget: 10,
    };

    const res = await router.route(req);
    // With no images and small token count, OCR+LLM is unsupported; fallback is used
    expect(res.source).toBe("fallback-form");

    const telemetry = logSpy.mock.calls
      .map(args => args[0])
      .filter(arg => typeof arg === "string")
      .map(str => {
        try {
          return JSON.parse(String(str));
        } catch {
          return null;
        }
      })
      .filter((t): t is Record<string, unknown> => !!t && t.requestId === req.id)
      .at(-1) as any;

    expect(telemetry.escalated).toBe("fallback-form");
  });

  it("honors budget: falls back when best supported candidate exceeds maxBudget", async () => {
    const router = new SUT.Router(0, "test-policy");
    const req = {
      id: "req-budget-fallback",
      mime: "text/plain" as const,
      text: "Your flight UA4321 from LAX to BOS departs 2025-11-10 08:05 and arrives 2025-11-10 16:45.",
      userSla: "standard" as const,
      slaMs: 2500,
      // small-llm cost is 2, set budget lower to force fallback
      maxBudget: 1,
    };

    const res = await router.route(req);
    expect(res.source).toBe("fallback-form");
  });
});