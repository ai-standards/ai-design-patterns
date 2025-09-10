# Routing Itineraries, Not Just Requests

## Company & Problem
SkyLoom is a travel concierge that auto-builds itineraries from whatever travelers forward: airline emails, PDF tickets, screenshots, and chat messages. Volume spiked after a consumer launch, and the single “do‑everything” LLM became the bottleneck. P95 latency crossed 12 seconds, and monthly model spend doubled in a quarter.

The inputs had a long tail. Most airline confirmations followed consistent templates; others were cropped images from messaging apps, mixed languages, or multi-leg trips with inconsistent time zones. The one-size model handled everything but paid the same price for easy and hard cases, and it occasionally hallucinated airport codes when OCR struggled. The team needed faster, cheaper parsing for the common cases without sacrificing accuracy on the messy ones.

## Applying the Pattern
Adaptive Model Routing fit the shape of the problem: choose a deterministic parser for known airline templates, a lightweight model for simple free-form text, and escalate to an OCR + tool-augmented LLM only when the content looked complex or risky. The router would consider features like sender domain, MIME type, language, token length, and PII flags, alongside per-request budgets and SLA tier.

This approach also enabled safer rollouts. New parsers for additional airlines could receive a trickle of traffic first. When confidence dropped or parsing failed validation, the router would fall back to a stronger candidate without blocking the user.

## Implementation Plan
- Feature extraction: MIME type, sender domain, language, token count, image density, PII/credit-card patterns, user SLA.
- Candidates:
  - Template parser for known carriers (deterministic).
  - Small LLM for short, plain-text confirmations.
  - OCR + tool-augmented LLM for images/complex itineraries.
  - Fallback: manual form with pre-filled guesses.
- Policy: rules plus a tiny difficulty classifier to predict “needs escalation.”
- Verification: schema validation (dates, IATA codes, time-zone sanity), confidence scoring.
- Observability: route decisions, alternatives considered, validation failures, cost/latency per route.
- Governance: versioned policies, canarying new parsers, rollback switch.

## Implementation Steps
Feature extraction ran first and stayed cheap: regexes for IATA codes, a domain whitelist for major airlines, a fast language detector, and a simple image heuristic (width × height × channels).

Routing combined transparent rules with a small scorer. Known-domain HTML with expected fields routed to the template parser. Images or long multilingual text triggered OCR + LLM, unless the user was on a strict-latency tier, in which case the small model attempted a first pass and escalated on low confidence.

TypeScript snippet — candidate selection with budget-aware scoring:
```ts
type Features = { domain?: string; mime: string; tokens: number; hasImages: boolean; slaMs: number };
type Candidate = { name: string; cost: number; supports: (f: Features) => boolean; run: (r: any) => Promise<any> };

const score = (f: Features, c: Candidate) =>
  (f.domain?.endsWith("airline.com") && c.name === "template") ? 100 :
  (f.hasImages && c.name === "ocr+llm") ? 80 :
  (f.tokens < 400 && c.name === "small-llm") ? 60 : 10;

function pick(cands: Candidate[], f: Features, budget: number) {
  return cands
    .filter(c => c.supports(f))
    .map(c => ({ c, s: score(f, c) - c.cost }))
    .sort((a, b) => b.s - a.s)
    .find(x => x.c.cost <= budget)?.c;
}
```

TypeScript snippet — execution with validation and escalation:
```ts
async function route(req: any, budget: number, cands: Candidate[]) {
  const f = extractFeatures(req);                         // cheap, synchronous
  let c = pick(cands, f, budget) ?? fallbackCandidate;
  let out = await withTimeout(c.run(req), f.slaMs);

  if (!validateItinerary(out) || out.confidence < 0.8) {  // schema + sanity checks
    c = cands.find(x => x.name === "ocr+llm") ?? c;       // escalate to strongest
    out = await withTimeout(c.run(req), f.slaMs * 2);
  }
  return out ?? fallbackForm(req);
}
```

A crucial addition was telemetry: for each request, the system logged the chosen route, candidates considered, features, validation results, and final confidence. This made policy tweaks debuggable and enabled canary rollouts for new airline templates.

## Outcome & Takeaways
After rollout, 68% of traffic used the template parser, 22% the small model, and 10% escalated to OCR + LLM. Model spend dropped 54% while P95 latency fell to 3.1 seconds. Accuracy improved: validation-driven escalation cut wrong airport codes by 83%. Canarying new templates reduced integration risk; mis-parses stayed below 0.5% with instant rollback available.

Key lessons:
- Start with legible heuristics; add learning only where it clarifies decisions.
- Always validate outputs and make escalation cheap—confidence beats guesswork.
- Treat routing as a product surface: log decisions, version policies, and plan rollbacks.