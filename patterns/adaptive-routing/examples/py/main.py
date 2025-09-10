"""
Adaptive Model Routing example for itinerary parsing in Python.

This single file demonstrates:
- Feature extraction that is cheap and deterministic
- Candidate selection using a budget-aware scorer and clear rules
- Execution with validation, confidence thresholds, and escalation
- Telemetry for debuggability and safe canarying of new parsers
- Self-contained mocks: no network calls, runnable with Python 3.10+

requirements.txt:
  (none; uses only Python standard library)
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Callable, Awaitable, List, Optional, Literal, Dict, Any


# -------------------------------
# Types and data models
# -------------------------------

SLA = Literal["strict", "standard"]
Mime = Literal["text/html", "text/plain", "image/*"]


@dataclass
class ImageInfo:
    width: int
    height: int
    channels: int
    ocr_text: Optional[str] = None


@dataclass
class InboundRequest:
    id: str
    mime: Mime
    sender_domain: Optional[str] = None
    html: Optional[str] = None
    text: Optional[str] = None
    images: Optional[List[ImageInfo]] = None
    user_sla: SLA = "standard"
    sla_ms: int = 2500
    max_budget: float = 3.0


@dataclass
class Features:
    domain: Optional[str]
    mime: Mime
    tokens: int
    has_images: bool
    language: Literal["en", "other"]
    contains_pii: bool
    sla_ms: int


@dataclass
class Leg:
    from_: str
    to: str
    departISO: str
    arriveISO: str
    flightNo: str


@dataclass
class Itinerary:
    legs: List[Leg]
    confidence: float  # 0—1
    source: str        # which candidate produced this output


@dataclass
class Candidate:
    name: str
    cost: float
    supports: Callable[[Features], bool]
    run: Callable[[InboundRequest], Awaitable[Itinerary]]


@dataclass
class Telemetry:
    requestId: str
    features: Features
    considered: List[Dict[str, Any]]
    chosen: str
    escalated: Optional[str] = None
    validationIssues: List[str] = field(default_factory=list)
    finalConfidence: float = 0.0
    policyVersion: str = "v1.0.0"


# -------------------------------
# Utilities (pure, cheap helpers)
# -------------------------------

def estimate_tokens(s: Optional[str]) -> int:
    """Estimate token count by rough word count; cheap and stable, good enough for routing decisions."""
    if not s:
        return 0
    words = [w for w in re.split(r"\s+", s.strip()) if w]
    return max(1, int(len(words) * 1.3))


def detect_language(s: Optional[str]) -> Literal["en", "other"]:
    """Extremely simple language heuristic: treat ASCII-heavy as 'en', else 'other'."""
    if not s:
        return "en"
    non_ascii = len(re.findall(r"[^\x00-\x7F]", s))
    ratio = non_ascii / max(1, len(s))
    return "other" if ratio > 0.1 else "en"


def has_pii(s: Optional[str]) -> bool:
    """Basic PII heuristic: checks for credit card-ish sequences; helps trigger escalation."""
    if not s:
        return False
    return bool(re.search(r"\b(?:\d[ -]*?){13,19}\b", s))


def has_substantial_images(images: Optional[List[ImageInfo]]) -> bool:
    """Cheap image density heuristic to detect 'real' images; used to push OCR paths."""
    if not images:
        return False
    return any(img.width * img.height * img.channels >= 512 * 512 * 3 for img in images)


async def with_timeout(coro: Awaitable[Any], ms: int) -> Any:
    """Timeout wrapper to enforce per-request SLA; cancels slow paths quickly."""
    seconds = ms / 1000.0
    return await asyncio.wait_for(coro, timeout=seconds)


def parse_datetime_isoish(s: str) -> Optional[str]:
    """Parse flexible date-time strings into ISO 8601 with Z. Returns None if parsing fails."""
    s = s.strip()
    if not s:
        return None
    # Normalize 'Z' to +00:00 for fromisoformat
    normalized = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        dt = None

    if dt is None:
        # Try common fallbacks without timezone; assume UTC
        patterns = [
            "%Y-%m-%d %H:%M",
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
        ]
        for fmt in patterns:
            try:
                dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                continue

    if dt is None:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


# -------------------------------
# Validation and verification
# -------------------------------

def validate_itinerary(itin: Itinerary) -> Dict[str, Any]:
    """Validate itinerary schema + sanity checks (IATA codes and chronological sanity)."""
    issues: List[str] = []
    iata = re.compile(r"^[A-Z]{3}$")
    flight_no = re.compile(r"^[A-Z]{2}\d{2,4}$")

    if len(itin.legs) == 0:
        issues.append("no legs")

    for idx, leg in enumerate(itin.legs):
        if not iata.match(leg.from_):
            issues.append(f"leg {idx}: invalid from IATA")
        if not iata.match(leg.to):
            issues.append(f"leg {idx}: invalid to IATA")

        d_str = leg.departISO
        a_str = leg.arriveISO
        d_iso = parse_datetime_isoish(d_str)
        a_iso = parse_datetime_isoish(a_str)

        if d_iso is None or a_iso is None:
            issues.append(f"leg {idx}: invalid dates")
        else:
            d_dt = datetime.fromisoformat(d_iso.replace("Z", "+00:00"))
            a_dt = datetime.fromisoformat(a_iso.replace("Z", "+00:00"))
            if a_dt <= d_dt:
                issues.append(f"leg {idx}: arrival not after departure")

        if not flight_no.match(leg.flightNo):
            issues.append(f"leg {idx}: suspicious flight number")

    return {"ok": len(issues) == 0, "issues": issues}


# -------------------------------
# Feature extraction
# -------------------------------

def extract_features(req: InboundRequest) -> Features:
    """Keep this cheap: only string ops and light regex. Avoid parsing HTML fully here."""
    parts: List[str] = []
    if req.text:
        parts.append(req.text)
    if req.html:
        parts.append(req.html)
    if req.images:
        parts.extend([img.ocr_text or "" for img in req.images])

    text_blob = "\n".join(p for p in parts if p)

    return Features(
        domain=req.sender_domain,
        mime=req.mime,
        tokens=estimate_tokens(text_blob),
        has_images=has_substantial_images(req.images),
        language=detect_language(text_blob),
        contains_pii=has_pii(text_blob),
        sla_ms=req.sla_ms,
    )


# -------------------------------
# Candidate implementations (mocked)
# -------------------------------

KNOWN_AIRLINES = {"universal-airline.com", "airline.com", "skyexpress.com"}


async def run_template_v1(req: InboundRequest) -> Itinerary:
    # Simulate speed: deterministic parsers are quick
    await asyncio.sleep(0.05)
    html = req.html or ""
    m = re.search(
        r"FROM:(?P<from>[A-Z]{3});TO:(?P<to>[A-Z]{3});DEPART:(?P<d>[^;]+);ARRIVE:(?P<a>[^;]+);FLIGHT:(?P<fn>[A-Z]{2}\d{2,4})",
        html,
    )
    if not m:
        return Itinerary(legs=[], confidence=0.2, source="template-v1")

    groups = m.groupdict()
    depart_iso = parse_datetime_isoish(groups["d"]) or groups["d"]
    arrive_iso = parse_datetime_isoish(groups["a"]) or groups["a"]
    return Itinerary(
        legs=[
            Leg(
                from_=groups["from"],
                to=groups["to"],
                departISO=depart_iso,
                arriveISO=arrive_iso,
                flightNo=groups["fn"],
            )
        ],
        confidence=0.95,
        source="template-v1",
    )


def make_template_v2(canary_share: float) -> Candidate:
    async def run(req: InboundRequest) -> Itinerary:
        await asyncio.sleep(0.045)  # slightly faster
        html = req.html or ""
        # v2 is a tad more flexible with separators (comma or semicolon)
        m = re.search(
            r"FROM:(?P<from>[A-Z]{3})[,;]TO:(?P<to>[A-Z]{3})[,;]DEPART:(?P<d>[^,;]+)[,;]ARRIVE:(?P<a>[^,;]+)[,;]FLIGHT:(?P<fn>[A-Z]{2}\d{2,4})",
            html,
        )
        if not m:
            return Itinerary(legs=[], confidence=0.25, source="template-v2")
        groups = m.groupdict()
        depart_iso = parse_datetime_isoish(groups["d"]) or groups["d"]
        arrive_iso = parse_datetime_isoish(groups["a"]) or groups["a"]
        return Itinerary(
            legs=[
                Leg(
                    from_=groups["from"],
                    to=groups["to"],
                    departISO=depart_iso,
                    arriveISO=arrive_iso,
                    flightNo=groups["fn"],
                )
            ],
            confidence=0.96,
            source="template-v2",
        )

    def supports(f: Features) -> bool:
        return f.mime == "text/html" and f.domain is not None and f.domain in KNOWN_AIRLINES and (random.random() < canary_share)

    return Candidate(
        name="template-v2",
        cost=1.0,
        supports=supports,
        run=run,
    )


template_v1 = Candidate(
    name="template-v1",
    cost=1.0,
    supports=lambda f: f.mime == "text/html" and f.domain is not None and f.domain in KNOWN_AIRLINES,
    run=run_template_v1,
)


async def run_small_llm(req: InboundRequest) -> Itinerary:
    await asyncio.sleep(0.18)  # small model latency
    text = req.text or ""
    m = re.search(
        r"(?P<fn>[A-Z]{2}\d{2,4}).*?\bfrom\b\s+(?P<from>[A-Z]{3}).*?\bto\b\s+(?P<to>[A-Z]{3}).*?\bdepart(?:s|ing)?\b\s+(?P<d>[\dT:\-Z:+ ]+).*?\barrive(?:s|ing)?\b\s+(?P<a>[\dT:\-Z:+ ]+)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return Itinerary(legs=[], confidence=0.4, source="small-llm")

    groups = m.groupdict()
    depart_iso = parse_datetime_isoish(groups["d"]) or groups["d"]
    arrive_iso = parse_datetime_isoish(groups["a"]) or groups["a"]
    return Itinerary(
        legs=[
            Leg(
                from_=groups["from"].upper(),
                to=groups["to"].upper(),
                departISO=depart_iso,
                arriveISO=arrive_iso,
                flightNo=groups["fn"].upper(),
            )
        ],
        confidence=0.85,
        source="small-llm",
    )


small_llm = Candidate(
    name="small-llm",
    cost=2.0,
    supports=lambda f: f.mime == "text/plain" and f.tokens < 400 and not f.has_images,
    run=run_small_llm,
)


async def run_ocr_plus_llm(req: InboundRequest) -> Itinerary:
    await asyncio.sleep(0.6)  # heavy path latency
    parts: List[str] = []
    if req.images:
        parts.extend([img.ocr_text or "" for img in req.images])
    if req.text:
        parts.append(req.text)
    if req.html:
        parts.append(req.html)
    blob = "\n".join(parts)

    codes = list({c for c in re.findall(r"\b[A-Z]{3}\b", blob) if c not in {"FROM", "TO", "DEPART", "ARRIVE", "FLIGHT"}})
    time_matches = re.findall(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?", blob)
    times = [t for t in (parse_datetime_isoish(tm) for tm in time_matches) if t is not None]
    flights = re.findall(r"[A-Z]{2}\d{2,4}", blob)

    if len(codes) >= 2 and len(times) >= 2 and len(flights) >= 1:
        return Itinerary(
            legs=[
                Leg(
                    from_=codes[0],
                    to=codes[1],
                    departISO=times[0],
                    arriveISO=times[1],
                    flightNo=flights[0],
                )
            ],
            confidence=0.8,
            source="ocr+llm",
        )

    return Itinerary(legs=[], confidence=0.5, source="ocr+llm")


ocr_plus_llm = Candidate(
    name="ocr+llm",
    cost=6.0,
    supports=lambda f: f.has_images or f.tokens >= 400 or f.language == "other",
    run=run_ocr_plus_llm,
)


async def run_fallback_form(req: InboundRequest) -> Itinerary:
    await asyncio.sleep(0.02)
    return Itinerary(legs=[], confidence=0.1, source="fallback-form")


fallback_form = Candidate(
    name="fallback-form",
    cost=0.5,
    supports=lambda f: True,
    run=run_fallback_form,
)


# -------------------------------
# Scoring policy and router
# -------------------------------

def score_candidate(f: Features, c: Candidate) -> int:
    """
    Budget-aware score:
    - Rewards deterministic template when domain is known
    - Prefers OCR+LLM for images or heavy/multilingual text
    - Uses small-LLM for short/plain confirmations
    - Penalizes higher-cost candidates
    - Applies SLA nudges: strict SLA reduces heavy path desirability
    """
    if f.domain and f.domain in KNOWN_AIRLINES and c.name.startswith("template"):
        base = 100
    elif f.has_images and c.name == "ocr+llm":
        base = 80
    elif f.tokens < 400 and c.name == "small-llm":
        base = 60
    else:
        base = 20

    sla_penalty = 25 if (f.sla_ms <= 1500 and c.cost >= 6) else 0
    return int(base - c.cost * 5 - sla_penalty)


def difficulty_score(f: Features) -> int:
    """Simple difficulty signal to bias escalation early when content looks risky."""
    d = 0
    if f.has_images:
        d += 40
    if f.tokens > 600:
        d += 30
    if f.language == "other":
        d += 20
    if f.contains_pii:
        d += 10
    return d  # 0—100


class Router:
    def __init__(self, canary_share: float, version: str = "v1.0.0") -> None:
        # Governance: versioned policy, optional canary for template-v2
        cands: List[Candidate] = [template_v1, small_llm, ocr_plus_llm, fallback_form]
        if canary_share > 0:
            cands.append(make_template_v2(canary_share))
        self.candidates = cands
        self.policy_version = version

    async def route(self, req: InboundRequest) -> Itinerary:
        f = extract_features(req)

        # Build list of supported candidates and compute score minus cost (budget-aware ranking).
        supported: List[Candidate] = [c for c in self.candidates if c.supports(f)]
        considered_scored = sorted(
            [{"c": c, "s": score_candidate(f, c)} for c in supported],
            key=lambda x: x["s"],
            reverse=True,
        )

        # Pick the top candidate within budget; otherwise fallback.
        pick: Candidate = next((x["c"] for x in considered_scored if x["c"].cost <= req.max_budget), fallback_form)

        # If predicted difficulty is high and SLA is strict, try a quick small-LLM first to bound latency.
        should_probe = (
            difficulty_score(f) >= 50 and
            f.sla_ms <= 1500 and
            any(c.name == "small-llm" for c in supported)
        )

        telemetry = Telemetry(
            requestId=req.id,
            features=f,
            considered=[{"name": x["c"].name, "score": x["s"], "cost": x["c"].cost} for x in considered_scored],
            chosen="small-llm(probe)" if should_probe else pick.name,
            policyVersion=self.policy_version,
        )

        # Execute primary path (or probe), enforce timeout.
        primary = small_llm if should_probe else pick
        try:
            result: Itinerary = await with_timeout(primary.run(req), f.sla_ms)
        except Exception:
            # On timeout or error, escalate immediately to strongest candidate within budget.
            strong = next((c for c in supported if c.name == "ocr+llm" and c.cost <= req.max_budget), fallback_form)
            telemetry.escalated = strong.name
            result = await with_timeout(strong.run(req), min(f.sla_ms * 2, 4000))
            v = validate_itinerary(result)
            telemetry.validationIssues = v["issues"]
            telemetry.finalConfidence = result.confidence
            print(json.dumps(asdict(telemetry)))
            if v["ok"] and result.confidence >= 0.7:
                return result
            # Final fallback
            return await fallback_form.run(req)

        # Validate and potentially escalate on low confidence or invalid schema.
        v1 = validate_itinerary(result)
        telemetry.validationIssues = v1["issues"]
        telemetry.finalConfidence = result.confidence

        if (not v1["ok"]) or (result.confidence < 0.8):
            # Escalation policy: go to OCR+LLM if available within budget; else fallback.
            escalate = next((c for c in supported if c.name == "ocr+llm" and c.cost <= req.max_budget), fallback_form)
            telemetry.escalated = escalate.name
            next_result = await with_timeout(escalate.run(req), min(f.sla_ms * 2, 4000))
            v2 = validate_itinerary(next_result)
            telemetry.validationIssues = v2["issues"]
            telemetry.finalConfidence = next_result.confidence
            print(json.dumps(asdict(telemetry)))
            if v2["ok"] and next_result.confidence >= 0.7:
                return next_result
            return await fallback_form.run(req)

        print(json.dumps(asdict(telemetry)))
        return result


# -------------------------------
# Usage examples (self-contained)
# -------------------------------

async def main() -> None:
    # Instantiate router with a 10% canary for template-v2
    router = Router(0.1, "policy-2025-09-10")

    # 1) Known airline HTML: should hit template parser with high confidence and low latency
    req_html = InboundRequest(
        id="req-1",
        mime="text/html",
        sender_domain="airline.com",
        html="FROM:SFO;TO:JFK;DEPART:2025-12-01T09:00:00Z;ARRIVE:2025-12-01T17:30:00Z;FLIGHT:UA1234",
        user_sla="standard",
        sla_ms=2500,
        max_budget=3,
    )
    res1 = await router.route(req_html)
    print("Result 1:", json.dumps(asdict(res1)))

    # 2) Short plain text confirmation: use small LLM; should pass validation
    req_text = InboundRequest(
        id="req-2",
        mime="text/plain",
        sender_domain="randommail.com",
        text="Your flight UA4321 from LAX to BOS departs 2025-11-10 08:05 and arrives 2025-11-10 16:45.",
        user_sla="strict",
        sla_ms=1200,
        max_budget=2,
    )
    res2 = await router.route(req_text)
    print("Result 2:", json.dumps(asdict(res2)))

    # 3) Image-heavy, multilingual + OCR: routes to OCR+LLM; strict SLA may probe small-LLM first
    req_image = InboundRequest(
        id="req-3",
        mime="image/*",
        sender_domain="messenger.cdn",
        images=[ImageInfo(width=1080, height=1920, channels=3, ocr_text="Vuelo IB2210 FROM MAD TO JFK DEPART 2025-10-02T10:00Z ARRIVE 2025-10-02T18:30Z")],
        user_sla="strict",
        sla_ms=1400,
        max_budget=8,
    )
    res3 = await router.route(req_image)
    print("Result 3:", json.dumps(asdict(res3)))


if __name__ == "__main__":
    asyncio.run(main())