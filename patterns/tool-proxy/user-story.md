# Expense Bot, Not Expense Bomb

## Company & Problem
LedgerLeaf builds expense-management software for venture-backed startups. A chat assistant helps finance teams: “Reimburse Jamie for the Uber,” “Close out vendor credits,” “Pull last month’s top merchants.” Early adopters loved it—until a Friday afternoon incident.

The model approved a $3,200 reimbursement twice. It also tried to fetch “top vendors” but reached across tenants because an index mis-specified the company filter. None of this was malicious; the prompts were messy, tool outputs included HTML with “click here to escalate,” and the model merged that into its next step. Finance leadership demanded three things the next Monday: no side effects without policy, per-tenant guarantees, and audit trails that survive an SOC 2 audit.

## Applying the Pattern
The team applied the Tool Proxy pattern to put a gatekeeper between the model and everything with a side effect or sensitive data. The proxy became the only way to invoke payments, ledger updates, document export, and vendor search. It enforced schemas, per-tenant scopes, idempotency, rate and budget limits, and human approvals above thresholds. It also sanitized tool outputs so the model could not be steered by injected instructions.

Crucially, the proxy kept tool contracts stable across model versions. The assistant remained free to plan actions, but every call was validated, authorized, executed with least-privilege credentials, and logged with correlation IDs.

## Implementation Plan
- Inventory tools that mutate state or access sensitive rows.
- Define narrow, versioned tool contracts with JSON-ish schemas.
- Build a small proxy service (Node + Fastify) that:
  - Validates args, enforces tenant scoping, and applies policy.
  - Issues short-lived, scoped tokens to downstream APIs.
  - Adds idempotency keys, timeouts, retries, and rate limits.
  - Sanitizes responses (redact PII, strip executable content).
  - Emits structured logs and metrics.
- Add an approval step for payouts above configured limits.
- Swap the model’s direct tool calls to route through the proxy.
- Create mocks and contract tests to keep prompts stable.

## Implementation Steps
First, the team narrowed tools. For reimbursements: amount capped, memo length limited, and an approval gate for anything over $1,000. Vendor search gained a mandatory tenant filter and a max page size.

A tiny registry declared each tool’s schema and policy. Using zod kept parsing strict without writing validators by hand:

```ts
import { z } from "zod";

const tools = {
  createReimbursement: {
    args: z.object({
      employeeId: z.string().uuid(),
      amount: z.number().positive().max(5000),
      memo: z.string().max(200)
    }),
    scope: "payouts:create",
    needsApproval: (ctx: Ctx, a: any) => a.amount > 1000
  },
  searchVendors: {
    args: z.object({ tenantId: z.string(), q: z.string().min(2), limit: z.number().max(25).default(10) }),
    scope: "vendors:read"
  }
} as const;
```

Next came the proxy’s call path. It rejected unknown tools, enforced tenant isolation, budget, and rate limits, and executed through adapters with timeouts and idempotency keys. Responses were sanitized before returning to the model.

```ts
async function callTool<T extends keyof typeof tools>(name: T, rawArgs: unknown, ctx: Ctx) {
  const def = tools[name];
  const parsed = def.args.safeParse(rawArgs);
  if (!parsed.success) return deny("bad_args");

  assertTenant(ctx, parsed.data);               // no cross-tenant access
  await budget.check(ctx.userId, name);         // dollars and QPS
  if (def.needsApproval?.(ctx, parsed.data)) return askHuman(name, parsed.data, ctx);

  const token = await issueScopedToken(def.scope, ctx.tenantId);
  const idem = `${ctx.requestId}:${name}`;
  const res = await fetch(apiURL(name), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idem },
    body: JSON.stringify(parsed.data),
    signal: AbortSignal.timeout(4000)
  });

  const data = await res.json();
  return sanitize(data, { redact: ["ssn", "accountNumber"], stripHtml: true });
}
```

Finally, the assistant’s tool-calling layer was pointed at the proxy, not the raw services. Contract tests fed in adversarial prompts and poisoned tool outputs to verify denials, redactions, and approvals.

## Outcome & Takeaways
Within two weeks, duplicate payouts dropped to zero thanks to idempotency and approval gates. A cross-tenant vendor query was blocked by the tenant assertion and logged with a clear deny reason. Latency rose by 18–35 ms on average, which finance teams did not notice, but auditability improved dramatically: every call had args (redacted), outcome, cost, and a correlation ID.

Key lessons:
- Keep tools narrow; add new ones rather than widening arguments.
- Treat both model proposals and tool results as untrusted.
- Bake in idempotency and human approvals where money moves.
- A stable proxy contract made model swaps and testing uneventful.

The assistant kept its flexibility, but the company gained safety, compliance, and predictable behavior where it mattered most—moving money.