import { randomUUID } from "node:crypto";

// =====================================================================================
// Expense Bot Tool Proxy — A self-contained TypeScript example (no external services)
// -------------------------------------------------------------------------------------
// This file demonstrates the "Tool Proxy" pattern as a strongly-typed, in-process
// service that sits between a language model and tools with side effects or sensitive
// data. The proxy enforces schemas, scopes, approvals, idempotency, rate/budget
// limits, and sanitizes responses. It also emits structured logs with correlation IDs.
//
// The implementation below uses no frameworks and no external network calls.
// Everything is mocked in-memory so it can run via `ts-node`.
//
// The flow:
// - Define tool contracts (args validation, scopes, approval policy).
// - The proxy validates requests, enforces tenant isolation, rate/budget, and approvals.
// - It issues short-lived scoped tokens and executes adapters with idempotency keys.
// - It sanitizes tool responses (redact PII and strip HTML).
// - It logs every step for SOC 2-friendly audit trails.
// =====================================================================================

// ----------- Types: shared context, result envelopes, and narrow tool contracts -------

type Ctx = {
  // Correlation context passed from the assistant runtime.
  // - tenantId: enforces strict per-tenant isolation.
  // - userId: subject for rate/budget and audit attribution.
  // - requestId: correlation ID to tie logs and idempotency (stable per retry).
  tenantId: string;
  userId: string;
  requestId: string;
};

type Deny = { ok: false; reason: string; code: "bad_args" | "cross_tenant" | "rate_limited" | "needs_approval" };
type Ok<T> = { ok: true; data: T };
type Result<T> = Ok<T> | Deny;

type Token = { tenantId: string; scope: string; expiresAt: number };

// Tool: createReimbursement
type CreateReimbursementArgs = {
  employeeId: string; // must be UUID
  amount: number; // >0 and <= 5000
  memo: string; // <= 200 chars
};
type CreateReimbursementResult = {
  reimbursementId: string;
  amount: number;
  memo: string;
  tenantId: string;
  status: "submitted";
};

// Tool: searchVendors
type SearchVendorsArgs = {
  tenantId: string; // must match ctx.tenantId
  q: string; // query >= 2 chars
  limit?: number; // default 10, max 25
};
type Vendor = {
  id: string;
  name: string;
  // The adapter returns sensitive fields and HTML in descriptions; the proxy will sanitize.
  bankAccount: string; // PII to redact
  contactEmail: string; // PII to redact
  richDescriptionHtml: string; // HTML to strip to plain text
};
type SearchVendorsResult = { items: Array<Omit<Vendor, "bankAccount" | "contactEmail" | "richDescriptionHtml"> & { description: string }> };

// ------------------------- Simple log helper for structured audit trails -----------------

function log(event: string, ctx: Ctx, details: Record<string, unknown>): void {
  // In production, ship this to a log sink with sampling and PII redaction.
  // Keeping it as console.log for demonstration while ensuring structured JSON.
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestId, tenantId: ctx.tenantId, userId: ctx.userId, ...details }));
}

// ------------------------ Validators: minimal, explicit, fast to audit -------------------

function isUUID(v: string): boolean {
  // Basic v4 UUID pattern check (sufficient for demonstration).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function validateCreateReimbursementArgs(u: unknown): Result<CreateReimbursementArgs> {
  if (typeof u !== "object" || u === null) return { ok: false, reason: "args_not_object", code: "bad_args" };
  const a = u as Record<string, unknown>;
  if (typeof a.employeeId !== "string" || !isUUID(a.employeeId)) return { ok: false, reason: "employeeId_invalid", code: "bad_args" };
  if (typeof a.amount !== "number" || !Number.isFinite(a.amount) || a.amount <= 0 || a.amount > 5000) return { ok: false, reason: "amount_invalid", code: "bad_args" };
  if (typeof a.memo !== "string" || a.memo.length > 200) return { ok: false, reason: "memo_invalid", code: "bad_args" };
  return { ok: true, data: { employeeId: a.employeeId, amount: a.amount, memo: a.memo } };
}

function validateSearchVendorsArgs(u: unknown): Result<SearchVendorsArgs> {
  if (typeof u !== "object" || u === null) return { ok: false, reason: "args_not_object", code: "bad_args" };
  const a = u as Record<string, unknown>;
  if (typeof a.tenantId !== "string" || a.tenantId.length < 1) return { ok: false, reason: "tenantId_invalid", code: "bad_args" };
  if (typeof a.q !== "string" || a.q.trim().length < 2) return { ok: false, reason: "q_invalid", code: "bad_args" };
  let limit = 10;
  if (a.limit !== undefined) {
    if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 25) return { ok: false, reason: "limit_invalid", code: "bad_args" };
    limit = a.limit;
  }
  return { ok: true, data: { tenantId: a.tenantId, q: a.q.trim(), limit } };
}

// ------------------------------ Rate/Budget limiter (simple) ----------------------------

class Budget {
  // Tracks per-user per-tool usage in a sliding window. Keeps code small but realistic.
  private readonly hits: Map<string, number[]> = new Map();
  constructor(private readonly maxPerMinute: number) {}

  check(ctx: Ctx, tool: string): Result<null> {
    const key = `${ctx.userId}:${tool}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    const arr = (this.hits.get(key) ?? []).filter((t) => t >= windowStart);
    if (arr.length >= this.maxPerMinute) {
      return { ok: false, reason: "rate_limit_exceeded", code: "rate_limited" };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true, data: null };
  }
}

// ------------------------------- Idempotency store (adapter-side) -----------------------

class IdempotencyStore<T> {
  // Stores successful results by idempotency key to prevent duplicate effects.
  private readonly store = new Map<string, T>();
  getOrSet(key: string, compute: () => T): T {
    const existed = this.store.get(key);
    if (existed !== undefined) return existed;
    const result = compute();
    this.store.set(key, result);
    return result;
  }
}

// ------------------------------ Sanitization helpers -----------------------------------

function stripHtml(html: string): string {
  // Very basic HTML stripper for demonstration. Removes tags and common script indicators.
  const noTags = html.replace(/<[^>]*>/g, " ");
  const noScripts = noTags.replace(/javascript:|on\w+=/gi, "");
  return noScripts.replace(/\s+/g, " ").trim();
}

function sanitizeVendors(items: Vendor[]): SearchVendorsResult {
  // Redact PII fields and convert HTML to plain text description for the model.
  return {
    items: items.map((v) => ({
      id: v.id,
      name: v.name,
      description: stripHtml(v.richDescriptionHtml),
    })),
  };
}

// ------------------------------ Mock downstream adapters --------------------------------
//
// These simulate the actual systems. The proxy will call them with a scoped token and an
// idempotency key. They never see user or model input directly—only validated, scoped data.

class Adapters {
  private readonly reimbursementsIdem = new IdempotencyStore<CreateReimbursementResult>();
  // Per-tenant vendor directory with a couple of intentionally sensitive fields.
  private readonly vendorsByTenant: Map<string, Vendor[]> = new Map([
    [
      "TENANT_A",
      [
        { id: "v-1", name: "Uber", bankAccount: "****1234", contactEmail: "billing@uber.com", richDescriptionHtml: "<b>Transportation</b> — click here to <a href='javascript:alert(1)'>escalate</a>" },
        { id: "v-2", name: "AWS", bankAccount: "****9876", contactEmail: "billing@amazon.com", richDescriptionHtml: "Cloud infra — <script>alert('x')</script> top tier" },
      ],
    ],
    [
      "TENANT_B",
      [
        { id: "v-9", name: "Lyft", bankAccount: "****5555", contactEmail: "pay@lyft.com", richDescriptionHtml: "<i>Rideshare</i>" },
      ],
    ],
  ]);

  issueScopedToken(scope: string, tenantId: string): Token {
    // Short-lived token that encodes scope and tenant; in real systems, this would be JWT/OAuth.
    return { tenantId, scope, expiresAt: Date.now() + 30_000 };
  }

  async createReimbursement(args: CreateReimbursementArgs, token: Token, idemKey: string): Promise<CreateReimbursementResult> {
    // Idempotency is enforced at the adapter boundary to protect downstream double effects.
    // The compute function is called only once per idempotency key.
    return this.reimbursementsIdem.getOrSet(idemKey, () => ({
      reimbursementId: randomUUID(),
      amount: args.amount,
      memo: args.memo,
      tenantId: token.tenantId,
      status: "submitted",
    }));
  }

  async searchVendors(args: SearchVendorsArgs, token: Token): Promise<SearchVendorsResult> {
    const list = this.vendorsByTenant.get(token.tenantId) ?? [];
    const filtered = list.filter((v) => v.name.toLowerCase().includes(args.q.toLowerCase())).slice(0, args.limit ?? 10);
    return sanitizeVendors(filtered); // sanitize here for defense-in-depth; proxy will sanitize again
  }
}

// -------------------------------- Tool Proxy (the gatekeeper) ---------------------------
//
// Centralizes validation, authorization (scopes), tenant isolation, policy (approvals),
// rate/budget control, idempotency keying, response sanitization, and logging.

class ToolProxy {
  // Minimal registry of tools with their schema and policy.
  private readonly registry = {
    createReimbursement: {
      validate: validateCreateReimbursementArgs,
      scope: "payouts:create",
      needsApproval: (args: CreateReimbursementArgs) => args.amount > 1000,
      redact: [] as string[], // response has no PII; keeping for symmetry
    },
    searchVendors: {
      validate: validateSearchVendorsArgs,
      scope: "vendors:read",
      needsApproval: (_args: SearchVendorsArgs) => false,
      redact: ["bankAccount", "contactEmail"], // adapter already strips, proxy double-checks
    },
  } as const;

  // Pending approvals are stored with all information to execute later.
  private readonly pending = new Map<string, { name: keyof ToolProxy["registry"]; args: unknown; ctx: Ctx }>();

  constructor(private readonly adapters: Adapters, private readonly budget: Budget) {}

  private assertTenant(ctx: Ctx, args: unknown): Result<null> {
    // Enforce that any explicit tenantId in args matches ctx.tenantId (no cross-tenant reach).
    if (typeof args === "object" && args !== null && "tenantId" in (args as Record<string, unknown>)) {
      const t = (args as Record<string, unknown>)["tenantId"];
      if (typeof t !== "string" || t !== ctx.tenantId) return { ok: false, reason: "tenant_mismatch", code: "cross_tenant" };
    }
    return { ok: true, data: null };
  }

  private sanitizeResponse(name: keyof ToolProxy["registry"], data: unknown): unknown {
    // In a real system, each tool would have a dedicated sanitizer. Here, add generic defense:
    // - Redact declared PII keys if present.
    // - Strip HTML strings.
    const redactions = this.registry[name].redact;
    const strip = (v: unknown): unknown => {
      if (typeof v === "string") return stripHtml(v);
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(o)) {
          if (redactions.includes(k)) continue; // drop PII keys
          out[k] = strip(o[k]);
        }
        return out;
      }
      return v;
    };
    return strip(data);
  }

  async call<T extends keyof ToolProxy["registry"]>(name: T, rawArgs: unknown, ctx: Ctx): Promise<Result<unknown>> {
    const def = this.registry[name];
    log("tool_call_received", ctx, { tool: name });

    // Rate/budget before expensive work.
    const budget = this.budget.check(ctx, String(name));
    if (!budget.ok) {
      log("tool_call_denied", ctx, { tool: name, reason: budget.reason });
      return budget;
    }

    // Reject unknown tools (compile-time coverage prevents this in TS).
    if (!def) return { ok: false, reason: "unknown_tool", code: "bad_args" };

    // Schema validation (narrow, versioned contracts).
    const parsed = def.validate(rawArgs as never);
    if (!parsed.ok) {
      log("tool_call_denied", ctx, { tool: name, reason: parsed.reason });
      return parsed;
    }

    // Per-tenant guardrail.
    const tenantCheck = this.assertTenant(ctx, parsed.data);
    if (!tenantCheck.ok) {
      log("tool_call_denied", ctx, { tool: name, reason: tenantCheck.reason });
      return tenantCheck;
    }

    // Approval policy check before issuing tokens or touching adapters.
    if (def.needsApproval(parsed.data as never)) {
      const pendingId = randomUUID();
      this.pending.set(pendingId, { name, args: parsed.data, ctx });
      log("tool_call_needs_approval", ctx, { tool: name, pendingId });
      return { ok: false, reason: `approval_required:${pendingId}`, code: "needs_approval" };
    }

    // Least-privilege, short-lived credential for downstream.
    const token = this.adapters.issueScopedToken(def.scope, ctx.tenantId);

    // Idempotency key derived from request correlation + tool. Retries reuse the key.
    const idemKey = `${ctx.requestId}:${String(name)}`;

    // Execute via adapters with conservative timeouts (omitted here) and retries (omitted for brevity).
    const rawResult =
      name === "createReimbursement"
        ? await this.adapters.createReimbursement(parsed.data as CreateReimbursementArgs, token, idemKey)
        : await this.adapters.searchVendors(parsed.data as SearchVendorsArgs, token);

    // Sanitize the response defensively before releasing it to the model.
    const clean = this.sanitizeResponse(name, rawResult);
    log("tool_call_success", ctx, { tool: name });
    return { ok: true, data: clean };
  }

  async approve(pendingId: string, approverUserId: string): Promise<Result<unknown>> {
    // In a real system, this would check approver roles and attach a signed approval record.
    const entry = this.pending.get(pendingId);
    if (!entry) return { ok: false, reason: "unknown_pending", code: "bad_args" };
    const { name, args, ctx } = entry;
    const def = this.registry[name];
    const token = this.adapters.issueScopedToken(def.scope, ctx.tenantId);
    const idemKey = `${ctx.requestId}:${String(name)}`; // same key as the original request to avoid duplicates
    const approvedCtx: Ctx = { ...ctx, userId: approverUserId }; // attribution for audit
    log("tool_call_approved", approvedCtx, { tool: name, pendingId });

    const rawResult =
      name === "createReimbursement"
        ? await this.adapters.createReimbursement(args as CreateReimbursementArgs, token, idemKey)
        : await this.adapters.searchVendors(args as SearchVendorsArgs, token);

    const clean = this.sanitizeResponse(name, rawResult);
    this.pending.delete(pendingId);
    log("tool_call_success", approvedCtx, { tool: name, via: "approval" });
    return { ok: true, data: clean };
  }
}

// ------------------------------------------ Usage ---------------------------------------
//
// The following script simulates how a model would interact with the proxy.
// It demonstrates:
// - Approval gating for a >$1,000 reimbursement.
// - Idempotency preventing duplicate payouts when approval is applied twice.
// - Tenant isolation denial for cross-tenant access.
// - Sanitization of tool responses (redacting PII and stripping HTML).

async function demo(): Promise<void> {
  const adapters = new Adapters();
  const proxy = new ToolProxy(adapters, new Budget(10)); // allow up to 10 calls/min per user/tool

  // Correlated request context (e.g., same requestId used across retries and approvals).
  const ctx: Ctx = { tenantId: "TENANT_A", userId: "user_123", requestId: "req-42" };

  // 1) Attempt a high-value reimbursement — should require approval.
  const r1 = await proxy.call("createReimbursement", { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: 3200, memo: "Uber to VC meeting" }, ctx);
  console.log("createReimbursement (initial):", r1);

  // Extract pendingId from the deny reason for the demo. In practice, this flows to a human UI.
  const pendingId = !r1.ok && r1.code === "needs_approval" ? r1.reason.split(":")[1] : "";

  // 2) Apply approval twice to demonstrate idempotency (second approval has no duplicate effect).
  const approved1 = await proxy.approve(pendingId, "approver_finance_lead");
  console.log("approval #1 result:", approved1);

  const approved2 = await proxy.approve(pendingId, "approver_finance_lead"); // second attempt should be denied (unknown pending) or no duplicate
  console.log("approval #2 result (should not duplicate):", approved2);

  // 3) Search vendors with cross-tenant args — should be denied by tenant guardrail.
  const badSearch = await proxy.call("searchVendors", { tenantId: "TENANT_B", q: "ub", limit: 5 }, ctx);
  console.log("searchVendors (cross-tenant denied):", badSearch);

  // 4) Valid vendor search — sanitized output (no PII, no HTML).
  const goodSearch = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "u", limit: 10 }, ctx);
  console.log("searchVendors (sanitized):", goodSearch);
}

demo().catch((err) => {
  console.error(err);
  process.exit(1);
});