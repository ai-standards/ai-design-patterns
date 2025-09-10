"""
Expense Bot Tool Proxy — A self-contained Python example (no external services)

This script demonstrates the "Tool Proxy" pattern as a strongly-typed, in-process
service that sits between a language model and tools with side effects or sensitive
data. The proxy enforces schemas, scopes, approvals, idempotency, rate/budget limits,
and sanitizes responses. It also emits structured logs with correlation IDs.

Run:
  python tool_proxy.py

No external dependencies are required.

If a requirements.txt is needed for packaging, it would contain:
  # requirements.txt
  # (no external dependencies)
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Generic, List, Literal, Mapping, MutableMapping, Optional, Tuple, TypeVar, Union


# ------------------------------------ Types --------------------------------------------

@dataclass(frozen=True)
class Ctx:
    # Correlation context passed from the assistant runtime.
    # - tenant_id: enforces strict per-tenant isolation.
    # - user_id: subject for rate/budget and audit attribution.
    # - request_id: correlation ID to tie logs and idempotency (stable per retry).
    tenant_id: str
    user_id: str
    request_id: str


ErrorCode = Literal["bad_args", "cross_tenant", "rate_limited", "needs_approval"]


T = TypeVar("T")


@dataclass(frozen=True)
class Ok(Generic[T]):
    ok: Literal[True]
    data: T


@dataclass(frozen=True)
class Deny:
    ok: Literal[False]
    reason: str
    code: ErrorCode


Result = Union[Ok[T], Deny]


@dataclass(frozen=True)
class Token:
    tenant_id: str
    scope: str
    expires_at: int  # epoch millis


# Tool: createReimbursement
@dataclass(frozen=True)
class CreateReimbursementArgs:
    employee_id: str  # must be UUID v4
    amount: float  # >0 and <= 5000
    memo: str  # <= 200 chars


@dataclass(frozen=True)
class CreateReimbursementResult:
    reimbursement_id: str
    amount: float
    memo: str
    tenant_id: str
    status: Literal["submitted"]


# Tool: searchVendors
@dataclass(frozen=True)
class SearchVendorsArgs:
    tenant_id: str  # must match ctx.tenant_id
    q: str  # query >= 2 chars
    limit: int  # default 10, max 25


@dataclass(frozen=True)
class Vendor:
    id: str
    name: str
    bank_account: str  # PII to redact
    contact_email: str  # PII to redact
    rich_description_html: str  # HTML to strip to plain text


@dataclass(frozen=True)
class SearchVendorItem:
    id: str
    name: str
    description: str


@dataclass(frozen=True)
class SearchVendorsResult:
    items: List[SearchVendorItem]


# ------------------------- Simple log helper for structured audit trails ----------------


def log(event: str, ctx: Ctx, details: Mapping[str, Any]) -> None:
    # In production, ship this to a log sink with sampling and PII redaction.
    # Keeping it as print for demonstration while ensuring structured JSON.
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "requestId": ctx.request_id,
        "tenantId": ctx.tenant_id,
        "userId": ctx.user_id,
    }
    payload.update(details)
    print(json.dumps(payload, ensure_ascii=False))


# ------------------------------ Validators: minimal, explicit ---------------------------


_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_uuid_v4(v: str) -> bool:
    return bool(_UUID_V4_RE.match(v))


def validate_create_reimbursement_args(u: Any) -> Result[CreateReimbursementArgs]:
    if not isinstance(u, dict):
        return Deny(ok=False, reason="args_not_object", code="bad_args")
    employee_id = u.get("employeeId")
    amount = u.get("amount")
    memo = u.get("memo")
    if not isinstance(employee_id, str) or not is_uuid_v4(employee_id):
        return Deny(ok=False, reason="employeeId_invalid", code="bad_args")
    if not isinstance(amount, (int, float)) or not (amount > 0 and amount <= 5000) or not float(amount) == amount:
        # float(amount) == amount ensures finite and numeric; ints cast to float also pass
        if isinstance(amount, float) and (amount != amount or amount in (float("inf"), float("-inf"))):
            return Deny(ok=False, reason="amount_invalid", code="bad_args")
        return Deny(ok=False, reason="amount_invalid", code="bad_args")
    if not isinstance(memo, str) or len(memo) > 200:
        return Deny(ok=False, reason="memo_invalid", code="bad_args")
    return Ok(ok=True, data=CreateReimbursementArgs(employee_id=employee_id, amount=float(amount), memo=memo))


def validate_search_vendors_args(u: Any) -> Result[SearchVendorsArgs]:
    if not isinstance(u, dict):
        return Deny(ok=False, reason="args_not_object", code="bad_args")
    tenant_id = u.get("tenantId")
    q = u.get("q")
    limit = u.get("limit", 10)
    if not isinstance(tenant_id, str) or len(tenant_id) < 1:
        return Deny(ok=False, reason="tenantId_invalid", code="bad_args")
    if not isinstance(q, str) or len(q.strip()) < 2:
        return Deny(ok=False, reason="q_invalid", code="bad_args")
    if limit is None:
        limit = 10
    if not isinstance(limit, int) or limit < 1 or limit > 25:
        return Deny(ok=False, reason="limit_invalid", code="bad_args")
    return Ok(ok=True, data=SearchVendorsArgs(tenant_id=tenant_id, q=q.strip(), limit=limit))


# ------------------------------ Rate/Budget limiter (simple) ----------------------------


class Budget:
    """
    Tracks per-user per-tool usage in a sliding one-minute window.
    """

    def __init__(self, max_per_minute: int) -> None:
        self._max = max_per_minute
        self._hits: Dict[str, List[float]] = {}

    def check(self, ctx: Ctx, tool: str) -> Result[None]:
        key = f"{ctx.user_id}:{tool}"
        now = time.time()
        window_start = now - 60.0
        arr = [t for t in self._hits.get(key, []) if t >= window_start]
        if len(arr) >= self._max:
            return Deny(ok=False, reason="rate_limit_exceeded", code="rate_limited")
        arr.append(now)
        self._hits[key] = arr
        return Ok(ok=True, data=None)


# ------------------------------- Idempotency store (adapter-side) -----------------------


U = TypeVar("U")


class IdempotencyStore(Generic[U]):
    """
    Stores successful results by idempotency key to prevent duplicate effects.
    """

    def __init__(self) -> None:
        self._store: Dict[str, U] = {}

    def get_or_set(self, key: str, compute: Callable[[], U]) -> U:
        if key in self._store:
            return self._store[key]
        result = compute()
        self._store[key] = result
        return result


# ------------------------------ Sanitization helpers -----------------------------------


_HTML_TAG_RE = re.compile(r"<[^>]*>")
_SCRIPT_PATTERNS_RE = re.compile(r"javascript:|on\w+=", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")


def strip_html(html: str) -> str:
    # Very basic HTML stripper for demonstration. Removes tags and common script indicators.
    no_tags = _HTML_TAG_RE.sub(" ", html)
    no_scripts = _SCRIPT_PATTERNS_RE.sub("", no_tags)
    return _WHITESPACE_RE.sub(" ", no_scripts).strip()


def sanitize_vendors(items: List[Vendor]) -> SearchVendorsResult:
    # Redact PII fields and convert HTML to plain text description for the model.
    return SearchVendorsResult(
        items=[
            SearchVendorItem(
                id=v.id,
                name=v.name,
                description=strip_html(v.rich_description_html),
            )
            for v in items
        ]
    )


# ------------------------------ Mock downstream adapters --------------------------------


class Adapters:
    """
    Simulates the actual systems. The proxy will call them with a scoped token and an
    idempotency key. They never see user or model input directly—only validated, scoped data.
    """

    def __init__(self) -> None:
        self._reimbursements_idem: IdempotencyStore[CreateReimbursementResult] = IdempotencyStore()
        # Per-tenant vendor directory with a couple of intentionally sensitive fields.
        self._vendors_by_tenant: Dict[str, List[Vendor]] = {
            "TENANT_A": [
                Vendor(
                    id="v-1",
                    name="Uber",
                    bank_account="****1234",
                    contact_email="billing@uber.com",
                    rich_description_html="<b>Transportation</b> — click here to <a href='javascript:alert(1)'>escalate</a>",
                ),
                Vendor(
                    id="v-2",
                    name="AWS",
                    bank_account="****9876",
                    contact_email="billing@amazon.com",
                    rich_description_html="Cloud infra — <script>alert('x')</script> top tier",
                ),
            ],
            "TENANT_B": [
                Vendor(
                    id="v-9",
                    name="Lyft",
                    bank_account="****5555",
                    contact_email="pay@lyft.com",
                    rich_description_html="<i>Rideshare</i>",
                )
            ],
        }

    def issue_scoped_token(self, scope: str, tenant_id: str) -> Token:
        # Short-lived token that encodes scope and tenant; in real systems, this would be JWT/OAuth.
        return Token(tenant_id=tenant_id, scope=scope, expires_at=int(time.time() * 1000) + 30_000)

    async def create_reimbursement(self, args: CreateReimbursementArgs, token: Token, idem_key: str) -> CreateReimbursementResult:
        # Idempotency is enforced at the adapter boundary to protect downstream double effects.
        # The compute function is called only once per idempotency key.
        def compute() -> CreateReimbursementResult:
            return CreateReimbursementResult(
                reimbursement_id=str(uuid.uuid4()),
                amount=args.amount,
                memo=args.memo,
                tenant_id=token.tenant_id,
                status="submitted",
            )

        return self._reimbursements_idem.get_or_set(idem_key, compute)

    async def search_vendors(self, args: SearchVendorsArgs, token: Token) -> SearchVendorsResult:
        list_ = self._vendors_by_tenant.get(token.tenant_id, [])
        filtered = [v for v in list_ if args.q.lower() in v.name.lower()][: args.limit]
        return sanitize_vendors(filtered)  # sanitize here for defense-in-depth; proxy will sanitize again


# -------------------------------- Tool Proxy (the gatekeeper) ---------------------------


ValidateFn = Callable[[Any], Result[Any]]
NeedsApprovalFn = Callable[[Any], bool]


@dataclass(frozen=True)
class ToolDef:
    validate: ValidateFn
    scope: str
    needs_approval: NeedsApprovalFn
    redact: Tuple[str, ...]  # keys to drop from response if present


class ToolProxy:
    """
    Centralizes validation, authorization (scopes), tenant isolation, policy (approvals),
    rate/budget control, idempotency keying, response sanitization, and logging.
    """

    def __init__(self, adapters: Adapters, budget: Budget) -> None:
        self._adapters = adapters
        self._budget = budget

        # Minimal registry of tools with their schema and policy.
        self._registry: Dict[str, ToolDef] = {
            "createReimbursement": ToolDef(
                validate=validate_create_reimbursement_args,
                scope="payouts:create",
                needs_approval=lambda a: isinstance(a, CreateReimbursementArgs) and a.amount > 1000,
                redact=tuple(),
            ),
            "searchVendors": ToolDef(
                validate=validate_search_vendors_args,
                scope="vendors:read",
                needs_approval=lambda _a: False,
                redact=("bankAccount", "contactEmail"),
            ),
        }

        # Pending approvals are stored with all information to execute later.
        self._pending: Dict[str, Dict[str, Any]] = {}

    def _assert_tenant(self, ctx: Ctx, args: Any) -> Result[None]:
        # Enforce that any explicit tenantId in args matches ctx.tenant_id (no cross-tenant reach).
        if isinstance(args, dict) and "tenantId" in args:
            t = args.get("tenantId")
            if not isinstance(t, str) or t != ctx.tenant_id:
                return Deny(ok=False, reason="tenant_mismatch", code="cross_tenant")
        # For validated dataclasses, check attribute as well.
        if hasattr(args, "tenant_id"):
            t2 = getattr(args, "tenant_id")
            if not isinstance(t2, str) or t2 != ctx.tenant_id:
                return Deny(ok=False, reason="tenant_mismatch", code="cross_tenant")
        return Ok(ok=True, data=None)

    def _sanitize_response(self, name: str, data: Any) -> Any:
        # In a real system, each tool would have a dedicated sanitizer. Here, add generic defense:
        # - Redact declared PII keys if present.
        # - Strip HTML strings.
        tool = self._registry[name]
        redactions = set(tool.redact)

        def strip(v: Any) -> Any:
            if isinstance(v, str):
                return strip_html(v)
            if isinstance(v, list):
                return [strip(x) for x in v]
            if isinstance(v, dict):
                out: Dict[str, Any] = {}
                for k, val in v.items():
                    if k in redactions:
                        continue
                    out[k] = strip(val)
                return out
            if hasattr(v, "__dict__") and not isinstance(v, (int, float, bool)):
                # Convert dataclass-like objects into dict defensively
                o = {k: getattr(v, k) for k in dir(v) if not k.startswith("_") and not callable(getattr(v, k, None))}
                return strip(o)
            return v

        return strip(data)

    async def call(self, name: str, raw_args: Any, ctx: Ctx) -> Result[Any]:
        def_ = self._registry.get(name)
        log("tool_call_received", ctx, {"tool": name})

        # Rate/budget before expensive work.
        budget = self._budget.check(ctx, name)
        if isinstance(budget, Deny):
            log("tool_call_denied", ctx, {"tool": name, "reason": budget.reason})
            return budget

        # Reject unknown tools.
        if def_ is None:
            return Deny(ok=False, reason="unknown_tool", code="bad_args")

        # Schema validation (narrow, versioned contracts).
        parsed = def_.validate(raw_args)
        if isinstance(parsed, Deny):
            log("tool_call_denied", ctx, {"tool": name, "reason": parsed.reason})
            return parsed

        # Per-tenant guardrail.
        tenant_check = self._assert_tenant(ctx, raw_args if isinstance(raw_args, dict) else parsed.data)
        if isinstance(tenant_check, Deny):
            log("tool_call_denied", ctx, {"tool": name, "reason": tenant_check.reason})
            return tenant_check

        # Approval policy check before issuing tokens or touching adapters.
        if def_.needs_approval(parsed.data):
            pending_id = str(uuid.uuid4())
            # Store raw args for exact replay; also store parsed data for robustness if desired.
            self._pending[pending_id] = {"name": name, "args": parsed.data, "raw": raw_args, "ctx": ctx}
            log("tool_call_needs_approval", ctx, {"tool": name, "pendingId": pending_id})
            return Deny(ok=False, reason=f"approval_required:{pending_id}", code="needs_approval")

        # Least-privilege, short-lived credential for downstream.
        token = self._adapters.issue_scoped_token(def_.scope, ctx.tenant_id)

        # Idempotency key derived from request correlation + tool. Retries reuse the key.
        idem_key = f"{ctx.request_id}:{name}"

        # Execute via adapters with conservative timeouts (omitted here) and retries (omitted for brevity).
        if name == "createReimbursement":
            assert isinstance(parsed.data, CreateReimbursementArgs)
            raw_result = await self._adapters.create_reimbursement(parsed.data, token, idem_key)
        elif name == "searchVendors":
            assert isinstance(parsed.data, SearchVendorsArgs)
            raw_result = await self._adapters.search_vendors(parsed.data, token)
        else:
            return Deny(ok=False, reason="unknown_tool", code="bad_args")

        # Sanitize the response defensively before releasing it to the model.
        clean = self._sanitize_response(name, raw_result)
        log("tool_call_success", ctx, {"tool": name})
        return Ok(ok=True, data=clean)

    async def approve(self, pending_id: str, approver_user_id: str) -> Result[Any]:
        # In a real system, this would check approver roles and attach a signed approval record.
        entry = self._pending.get(pending_id)
        if not entry:
            return Deny(ok=False, reason="unknown_pending", code="bad_args")
        name: str = entry["name"]
        args = entry["args"]
        ctx: Ctx = entry["ctx"]
        def_ = self._registry[name]
        token = self._adapters.issue_scoped_token(def_.scope, ctx.tenant_id)
        idem_key = f"{ctx.request_id}:{name}"  # same key as the original request to avoid duplicates
        approved_ctx = Ctx(tenant_id=ctx.tenant_id, user_id=approver_user_id, request_id=ctx.request_id)
        log("tool_call_approved", approved_ctx, {"tool": name, "pendingId": pending_id})

        if name == "createReimbursement":
            assert isinstance(args, CreateReimbursementArgs)
            raw_result = await self._adapters.create_reimbursement(args, token, idem_key)
        elif name == "searchVendors":
            assert isinstance(args, SearchVendorsArgs)
            raw_result = await self._adapters.search_vendors(args, token)
        else:
            return Deny(ok=False, reason="unknown_tool", code="bad_args")

        clean = self._sanitize_response(name, raw_result)
        self._pending.pop(pending_id, None)
        log("tool_call_success", approved_ctx, {"tool": name, "via": "approval"})
        return Ok(ok=True, data=clean)


# ------------------------------------------ Usage ---------------------------------------


async def demo() -> None:
    adapters = Adapters()
    proxy = ToolProxy(adapters, Budget(10))  # allow up to 10 calls/min per user/tool

    # Correlated request context (e.g., same request_id used across retries and approvals).
    ctx = Ctx(tenant_id="TENANT_A", user_id="user_123", request_id="req-42")

    # 1) Attempt a high-value reimbursement — should require approval.
    r1 = await proxy.call(
        "createReimbursement",
        {
            "employeeId": "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44",
            "amount": 3200,
            "memo": "Uber to VC meeting",
        },
        ctx,
    )
    print("createReimbursement (initial):", r1)

    # Extract pendingId from the deny reason for the demo. In practice, this flows to a human UI.
    pending_id = ""
    if isinstance(r1, Deny) and r1.code == "needs_approval":
        parts = r1.reason.split(":", 1)
        if len(parts) == 2:
            pending_id = parts[1]

    # 2) Apply approval twice to demonstrate idempotency (second approval has no duplicate effect).
    approved1 = await proxy.approve(pending_id, "approver_finance_lead")
    print("approval #1 result:", approved1)

    approved2 = await proxy.approve(pending_id, "approver_finance_lead")  # second attempt should be denied (unknown pending) or no duplicate
    print("approval #2 result (should not duplicate):", approved2)

    # 3) Search vendors with cross-tenant args — should be denied by tenant guardrail.
    bad_search = await proxy.call("searchVendors", {"tenantId": "TENANT_B", "q": "ub", "limit": 5}, ctx)
    print("searchVendors (cross-tenant denied):", bad_search)

    # 4) Valid vendor search — sanitized output (no PII, no HTML).
    good_search = await proxy.call("searchVendors", {"tenantId": "TENANT_A", "q": "ub", "limit": 10}, ctx)
    print("searchVendors (sanitized):", good_search)


if __name__ == "__main__":
    asyncio.run(demo())