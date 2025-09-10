/**
 * Adaptive Model Routing example for itinerary parsing in TypeScript.
 * 
 * This single file demonstrates:
 * - Feature extraction that is cheap and deterministic
 * - Candidate selection using a budget-aware scorer and clear rules
 * - Execution with validation, confidence thresholds, and escalation
 * - Telemetry for debuggability and safe canarying of new parsers
 * - Self-contained mocks: no network calls, runnable via ts-node
 * 
 * The approach routes easy cases to fast, cheap parsers and escalates to heavier
 * candidates only when signals suggest complexity or validation fails.
 */

type SLA = "strict" | "standard";

// Input request shape (simplified to keep the example focused and runnable)
interface InboundRequest {
  id: string;
  mime: "text/html" | "text/plain" | "image/*";
  senderDomain?: string;
  html?: string;
  text?: string;
  images?: Array<{ width: number; height: number; channels: number; ocrText?: string }>;
  userSla: SLA;
  slaMs: number;
  maxBudget: number; // abstract budget units representing cost allowance for this request
}

// Derived features used by the router; intentionally cheap to compute
interface Features {
  domain?: string;
  mime: InboundRequest["mime"];
  tokens: number;
  hasImages: boolean;
  language: "en" | "other";
  containsPII: boolean;
  slaMs: number;
}

// The target schema the system aims to produce
interface Itinerary {
  legs: Array<{ from: string; to: string; departISO: string; arriveISO: string; flightNo: string }>;
  confidence: number; // 0—1
  source: string;     // which candidate produced this output
}

// Candidate interface capturing capabilities, cost, and execution
interface Candidate {
  name: string;
  cost: number; // abstract cost units; higher ~ more expensive/slow
  supports: (f: Features) => boolean;
  run: (req: InboundRequest) => Promise<Itinerary>;
}

// Telemetry for observability and governance
interface Telemetry {
  requestId: string;
  features: Features;
  considered: Array<{ name: string; score: number; cost: number }>;
  chosen: string;
  escalated?: string;
  validationIssues: string[];
  finalConfidence: number;
  policyVersion: string;
}

// -------------------------------
// Utilities (pure, cheap helpers)
// -------------------------------

// Estimate tokens by rough word count; cheap and stable, good enough for routing decisions.
function estimateTokens(s: string | undefined): number {
  if (!s) return 0;
  const words = s.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, Math.floor(words.length * 1.3)); // simple multiplier to approximate tokenization
}

// Extremely simple language heuristic: treat ASCII-heavy as "en", else "other".
function detectLanguage(s: string | undefined): "en" | "other" {
  if (!s) return "en";
  const nonAscii = (s.match(/[^\x00-\x7F]/g) ?? []).length;
  const ratio = nonAscii / s.length;
  return ratio > 0.1 ? "other" : "en";
}

// Basic PII heuristic: checks for credit card-ish sequences; helps trigger escalation
function hasPII(s: string | undefined): boolean {
  if (!s) return false;
  return /\b(?:\d[ -]*?){13,19}\b/.test(s); // very loose match for 13-19 digits with separators
}

// Cheap image density heuristic to detect "real" images; used to push OCR paths
function hasSubstantialImages(images: InboundRequest["images"]): boolean {
  return !!images?.some(img => img.width * img.height * img.channels >= 512 * 512 * 3);
}

// Timeout wrapper to enforce per-request SLA; cancels slow paths quickly.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// -------------------------------
// Validation and verification
// -------------------------------

// Validate itinerary schema + sanity checks (IATA codes and chronological sanity).
function validateItinerary(it: Itinerary): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const iata = /^[A-Z]{3}$/;
  if (it.legs.length === 0) issues.push("no legs");
  it.legs.forEach((leg, idx) => {
    if (!iata.test(leg.from)) issues.push(`leg ${idx}: invalid from IATA`);
    if (!iata.test(leg.to)) issues.push(`leg ${idx}: invalid to IATA`);
    const depart = Date.parse(leg.departISO);
    const arrive = Date.parse(leg.arriveISO);
    if (Number.isNaN(depart) || Number.isNaN(arrive)) issues.push(`leg ${idx}: invalid dates`);
    if (!Number.isNaN(depart) && !Number.isNaN(arrive) && arrive <= depart) {
      issues.push(`leg ${idx}: arrival not after departure`);
    }
    if (!/^[A-Z]{2}\d{2,4}$/.test(leg.flightNo)) issues.push(`leg ${idx}: suspicious flight number`);
  });
  return { ok: issues.length === 0, issues };
}

// -------------------------------
// Feature extraction
// -------------------------------

function extractFeatures(req: InboundRequest): Features {
  // Keep this cheap: only string ops and light regex. Avoid parsing HTML fully here.
  const textBlob = [req.text, req.html, ...(req.images?.map(i => i.ocrText) ?? [])].filter(Boolean).join("\n");
  return {
    domain: req.senderDomain,
    mime: req.mime,
    tokens: estimateTokens(textBlob),
    hasImages: hasSubstantialImages(req.images),
    language: detectLanguage(textBlob),
    containsPII: hasPII(textBlob),
    slaMs: req.slaMs,
  };
}

// -------------------------------
// Candidate implementations (mocked)
// -------------------------------

const KNOWN_AIRLINES = new Set(["universal-airline.com", "airline.com", "skyexpress.com"]);

// 1) Deterministic template parser (v1): fast, cheap, high precision for known HTML formats.
const templateV1: Candidate = {
  name: "template-v1",
  cost: 1,
  supports: f => f.mime === "text/html" && !!f.domain && KNOWN_AIRLINES.has(f.domain),
  run: async (req) => {
    // Simulate speed: deterministic parsers are quick
    await new Promise(res => setTimeout(res, 50));
    // Mock HTML extraction with a rigid tag-like pattern:
    const html = req.html ?? "";
    const m = html.match(/FROM:(?<from>[A-Z]{3});TO:(?<to>[A-Z]{3});DEPART:(?<d>[^;]+);ARRIVE:(?<a>[^;]+);FLIGHT:(?<fn>[A-Z]{2}\d{2,4})/);
    if (!m?.groups) {
      // Return low confidence output instead of throwing; validation will trigger escalation.
      return {
        legs: [],
        confidence: 0.2,
        source: "template-v1"
      };
    }
    return {
      legs: [{ from: m.groups.from, to: m.groups.to, departISO: m.groups.d, arriveISO: m.groups.a, flightNo: m.groups.fn }],
      confidence: 0.95,
      source: "template-v1"
    };
  }
};

// 2) Deterministic template parser (v2 canary): identical interface, slight behavior change.
// Supports only a fraction of traffic when domain is known (canary control is inside supports).
function makeTemplateV2(canaryShare: number): Candidate {
  return {
    name: "template-v2",
    cost: 1,
    supports: f => f.mime === "text/html" && !!f.domain && KNOWN_AIRLINES.has(f.domain) && Math.random() < canaryShare,
    run: async (req) => {
      await new Promise(res => setTimeout(res, 45)); // slightly faster
      const html = req.html ?? "";
      // v2 is a tad more flexible with separators (comma or semicolon)
      const m = html.match(/FROM:(?<from>[A-Z]{3})[,;]TO:(?<to>[A-Z]{3})[,;]DEPART:(?<d>[^,;]+)[,;]ARRIVE:(?<a>[^,;]+)[,;]FLIGHT:(?<fn>[A-Z]{2}\d{2,4})/);
      if (!m?.groups) {
        return { legs: [], confidence: 0.25, source: "template-v2" };
      }
      return {
        legs: [{ from: m.groups.from, to: m.groups.to, departISO: m.groups.d, arriveISO: m.groups.a, flightNo: m.groups.fn }],
        confidence: 0.96,
        source: "template-v2"
      };
    }
  };
}

// 3) Small LLM for short, plain text confirmations; cheap, handles easy free-form.
const smallLLM: Candidate = {
  name: "small-llm",
  cost: 2,
  supports: f => f.mime === "text/plain" && f.tokens < 400 && !f.hasImages,
  run: async (req) => {
    await new Promise(res => setTimeout(res, 180)); // small model latency
    const text = req.text ?? "";
    // Robust-ish regex that tolerates mild variations:
    const m = text.match(/(?<fn>[A-Z]{2}\d{2,4}).*?\bfrom\b\s+(?<from>[A-Z]{3}).*?\bto\b\s+(?<to>[A-Z]{3}).*?\bdepart(?:s|ing)?\b\s+(?<d>[\dT:\-Z:+ ]+).*?\barrive(?:s|ing)?\b\s+(?<a>[\dT:\-Z:+ ]+)/i);
    if (!m?.groups) {
      return {
        legs: [],
        confidence: 0.4,
        source: "small-llm"
      };
    }
    return {
      legs: [{ from: m.groups.from.toUpperCase(), to: m.groups.to.toUpperCase(), departISO: new Date(m.groups.d).toISOString(), arriveISO: new Date(m.groups.a).toISOString(), flightNo: m.groups.fn.toUpperCase() }],
      confidence: 0.85,
      source: "small-llm"
    };
  }
};

// 4) OCR + tool-augmented LLM; heavy, handles images and tricky multilingual text.
const ocrPlusLLM: Candidate = {
  name: "ocr+llm",
  cost: 6,
  supports: f => f.hasImages || f.tokens >= 400 || f.language === "other",
  run: async (req) => {
    await new Promise(res => setTimeout(res, 600)); // heavy path latency
    // Combine OCR text from images with any text or HTML fallback
    const blob = [
      ...(req.images?.map(i => i.ocrText ?? "") ?? []),
      req.text ?? "",
      req.html ?? ""
    ].join("\n");
    // Extract candidates for IATA codes and timestamps; pick the first plausible pair.
    const codes = Array.from(new Set((blob.match(/\b[A-Z]{3}\b/g) ?? []).filter(c => c !== "FROM" && c !== "TO")));
    const times = (blob.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?/g) ?? []).map(t => new Date(t).toISOString());
    const flights = blob.match(/[A-Z]{2}\d{2,4}/g) ?? [];
    if (codes.length >= 2 && times.length >= 2 && flights.length >= 1) {
      return {
        legs: [{ from: codes[0], to: codes[1], departISO: times[0], arriveISO: times[1], flightNo: flights[0] }],
        confidence: 0.8,
        source: "ocr+llm"
      };
    }
    return {
      legs: [],
      confidence: 0.5,
      source: "ocr+llm"
    };
  }
};

// 5) Fallback: manual form with pre-filled guesses; always available, very low cost.
const fallbackForm: Candidate = {
  name: "fallback-form",
  cost: 0.5,
  supports: () => true,
  run: async (req) => {
    await new Promise(res => setTimeout(res, 20));
    // Pre-fill with placeholders; in a real system, this would return a UI payload.
    return {
      legs: [],
      confidence: 0.1,
      source: "fallback-form"
    };
  }
};

// -------------------------------
// Scoring policy and router
// -------------------------------

/**
 * Budget-aware score:
 * - Rewards deterministic template when domain is known
 * - Prefers OCR+LLM for images or heavy/multilingual text
 * - Uses small-LLM for short/plain confirmations
 * - Penalizes higher-cost candidates
 * - Applies SLA nudges: strict SLA reduces heavy path desirability
 */
function scoreCandidate(f: Features, c: Candidate): number {
  const base =
    (f.domain && KNOWN_AIRLINES.has(f.domain) && c.name.startsWith("template")) ? 100 :
    (f.hasImages && c.name === "ocr+llm") ? 80 :
    (f.tokens < 400 && c.name === "small-llm") ? 60 : 20;

  const slaPenalty = (f.slaMs <= 1500 && c.cost >= 6) ? 25 : 0; // discourage heavy path under strict SLA
  return base - c.cost * 5 - slaPenalty;
}

// Simple difficulty signal to bias escalation early when content looks risky.
function difficultyScore(f: Features): number {
  let d = 0;
  if (f.hasImages) d += 40;
  if (f.tokens > 600) d += 30;
  if (f.language === "other") d += 20;
  if (f.containsPII) d += 10;
  return d; // 0—100
}

class Router {
  private readonly candidates: Candidate[];
  private readonly policyVersion: string;

  constructor(canaryShare: number, version = "v1.0.0") {
    // Governance: versioned policy, optional canary for template-v2
    const cands: Candidate[] = [templateV1, smallLLM, ocrPlusLLM, fallbackForm];
    if (canaryShare > 0) cands.push(makeTemplateV2(canaryShare));
    this.candidates = cands;
    this.policyVersion = version;
  }

  async route(req: InboundRequest): Promise<Itinerary> {
    const f = extractFeatures(req);

    // Build list of supported candidates and compute score minus cost (budget-aware ranking).
    const supported = this.candidates.filter(c => c.supports(f));
    const considered = supported
      .map(c => ({ c, s: scoreCandidate(f, c) }))
      .sort((a, b) => b.s - a.s);

    // Pick the top candidate within budget; otherwise fallback.
    const pick = considered.find(x => x.c.cost <= req.maxBudget)?.c ?? fallbackForm;

    // If predicted difficulty is high and SLA is strict, try a quick small-LLM first to bound latency.
    const shouldProbe =
      difficultyScore(f) >= 50 &&
      f.slaMs <= 1500 &&
      supported.some(c => c.name === "small-llm");

    const telemetry: Telemetry = {
      requestId: req.id,
      features: f,
      considered: considered.map(x => ({ name: x.c.name, score: x.s, cost: x.c.cost })),
      chosen: shouldProbe ? "small-llm(probe)" : pick.name,
      validationIssues: [],
      finalConfidence: 0,
      policyVersion: this.policyVersion
    };

    // Execute primary path (or probe), enforce timeout.
    let primary = shouldProbe ? smallLLM : pick;
    let result: Itinerary;
    try {
      result = await withTimeout(primary.run(req), f.slaMs);
    } catch {
      // On timeout or error, escalate immediately to strongest candidate within budget.
      const strong = supported.find(c => c.name === "ocr+llm" && c.cost <= req.maxBudget) ?? fallbackForm;
      telemetry.escalated = strong.name;
      result = await withTimeout(strong.run(req), Math.min(f.slaMs * 2, 4000));
      const v = validateItinerary(result);
      telemetry.validationIssues = v.issues;
      telemetry.finalConfidence = result.confidence;
      console.log(JSON.stringify(telemetry));
      return v.ok && result.confidence >= 0.7 ? result : fallbackForm.run(req);
    }

    // Validate and potentially escalate on low confidence or invalid schema.
    const v1 = validateItinerary(result);
    telemetry.validationIssues = v1.issues;
    telemetry.finalConfidence = result.confidence;

    if (!v1.ok || result.confidence < 0.8) {
      // Escalation policy: go to OCR+LLM if available within budget; else fallback.
      const escalate = supported.find(c => c.name === "ocr+llm" && c.cost <= req.maxBudget) ?? fallbackForm;
      telemetry.escalated = escalate.name;
      const next = await withTimeout(escalate.run(req), Math.min(f.slaMs * 2, 4000));
      const v2 = validateItinerary(next);
      telemetry.validationIssues = v2.issues;
      telemetry.finalConfidence = next.confidence;
      console.log(JSON.stringify(telemetry));
      return v2.ok && next.confidence >= 0.7 ? next : fallbackForm.run(req);
    }

    console.log(JSON.stringify(telemetry));
    return result;
  }
}

// -------------------------------
// Usage examples (self-contained)
// -------------------------------

(async () => {
  // Instantiate router with a 10% canary for template-v2
  const router = new Router(0.1, "policy-2025-09-10");

  // 1) Known airline HTML: should hit template parser with high confidence and low latency
  const reqHtml: InboundRequest = {
    id: "req-1",
    mime: "text/html",
    senderDomain: "airline.com",
    html: "FROM:SFO;TO:JFK;DEPART:2025-12-01T09:00:00Z;ARRIVE:2025-12-01T17:30:00Z;FLIGHT:UA1234",
    userSla: "standard",
    slaMs: 2500,
    maxBudget: 3
  };
  console.log("Result 1:", await router.route(reqHtml));

  // 2) Short plain text confirmation: use small LLM; should pass validation
  const reqText: InboundRequest = {
    id: "req-2",
    mime: "text/plain",
    senderDomain: "randommail.com",
    text: "Your flight UA4321 from LAX to BOS departs 2025-11-10 08:05 and arrives 2025-11-10 16:45.",
    userSla: "strict",
    slaMs: 1200,
    maxBudget: 2
  };
  console.log("Result 2:", await router.route(reqText));

  // 3) Image-heavy, multilingual + OCR: routes to OCR+LLM; strict SLA may probe small-LLM first
  const reqImage: InboundRequest = {
    id: "req-3",
    mime: "image/*",
    senderDomain: "messenger.cdn",
    images: [{ width: 1080, height: 1920, channels: 3, ocrText: "Vuelo IB2210 FROM MAD TO JFK DEPART 2025-10-02T10:00Z ARRIVE 2025-10-02T18:30Z" }],
    userSla: "strict",
    slaMs: 1400,
    maxBudget: 8
  };
  console.log("Result 3:", await router.route(reqImage));
})();