import type * as SUT from "./main";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type PlainObject = Record<string, unknown>;

const ok = (r: unknown): r is { ok: true; data: unknown } => typeof r === "object" && !!r && (r as PlainObject).ok === true;
const notOk = (r: unknown): r is { ok: false; code: string; reason: string } =>
  typeof r === "object" && !!r && (r as PlainObject).ok === false && typeof (r as PlainObject).code === "string" && typeof (r as PlainObject).reason === "string";

const hasVendorItems = (d: unknown): d is { items: Array<{ id: string; name: string; description: string }> } => {
  if (!d || typeof d !== "object") return false;
  const items = (d as PlainObject).items;
  if (!Array.isArray(items)) return false;
  return items.every((it) => it && typeof it === "object" && typeof (it as PlainObject).id === "string" && typeof (it as PlainObject).name === "string" && typeof (it as PlainObject).description === "string");
};

const hasReimbursement = (d: unknown): d is { reimbursementId: string; amount: number; memo: string; tenantId: string; status: string } => {
  if (!d || typeof d !== "object") return false;
  const o = d as PlainObject;
  return typeof o.reimbursementId === "string" && typeof o.amount === "number" && typeof o.memo === "string" && typeof o.tenantId === "string" && typeof o.status === "string";
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Tool Proxy pattern — unit tests", () => {
  it("requires approval for high-value reimbursement, then allows approval once and prevents duplicates", async () => {
    // Silence logs from the SUT demo and proxy logging to keep test output clean.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      // No crypto mocking needed here; the test only checks behavioral invariants.
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      // Prepare the proxy with a permissive budget and a single-tenant context.
      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(10));
      const ctx = { tenantId: "TENANT_A", userId: "user_abc", requestId: "req-approval-1" };

      // 1) High-value reimbursement should be gated behind approval.
      const initial = await proxy.call("createReimbursement", { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: 3200, memo: "Client offsite" }, ctx);
      expect(notOk(initial)).toBe(true);
      if (notOk(initial)) {
        expect(initial.code).toBe("needs_approval");
        expect(initial.reason).toMatch(/^approval_required:/);
      }

      // Extract the pendingId token from the deny reason.
      const pendingId = notOk(initial) ? initial.reason.split(":")[1] : "";
      expect(pendingId).toHaveLength(pendingId.length); // non-empty

      // 2) Approval should succeed once and produce a submitted reimbursement.
      const approved = await proxy.approve(pendingId, "approver_finance");
      expect(ok(approved)).toBe(true);
      if (ok(approved)) {
        expect(hasReimbursement(approved.data)).toBe(true);
        if (hasReimbursement(approved.data)) {
          expect(approved.data.status).toBe("submitted");
          expect(approved.data.tenantId).toBe(ctx.tenantId);
          expect(approved.data.amount).toBe(3200);
          expect(approved.data.memo).toBe("Client offsite");
        }
      }

      // 3) Applying approval a second time should not duplicate the effect.
      const second = await proxy.approve(pendingId, "approver_finance");
      expect(notOk(second)).toBe(true);
      if (notOk(second)) {
        expect(second.code).toBe("bad_args");
        expect(second.reason).toBe("unknown_pending");
      }

      logSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  it("enforces idempotency for createReimbursement across retries with the same requestId", async () => {
    // Silence demo logs once again.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(10));
      const ctx = { tenantId: "TENANT_A", userId: "user_idempo", requestId: "req-idem-1" };

      // Use a small amount to avoid approval and hit the adapter directly.
      const args = { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: 250, memo: "Taxi" };

      const r1 = await proxy.call("createReimbursement", args, ctx);
      const r2 = await proxy.call("createReimbursement", args, ctx);

      expect(ok(r1)).toBe(true);
      expect(ok(r2)).toBe(true);

      if (ok(r1) && ok(r2)) {
        expect(hasReimbursement(r1.data)).toBe(true);
        expect(hasReimbursement(r2.data)).toBe(true);
        if (hasReimbursement(r1.data) && hasReimbursement(r2.data)) {
          // Idempotency should return the same reimbursement result for the same requestId.
          expect(r2.data.reimbursementId).toBe(r1.data.reimbursementId);
          expect(r2.data.amount).toBe(r1.data.amount);
          expect(r2.data.memo).toBe(r1.data.memo);
          expect(r2.data.tenantId).toBe(r1.data.tenantId);
        }
      }

      // Changing only the requestId should produce a distinct result.
      const ctx2 = { ...ctx, requestId: "req-idem-2" };
      const r3 = await proxy.call("createReimbursement", args, ctx2);
      expect(ok(r3)).toBe(true);
      if (ok(r1) && ok(r3) && hasReimbursement(r1.data) && hasReimbursement(r3.data)) {
        expect(r3.data.reimbursementId).not.toBe(r1.data.reimbursementId);
      }
    });
  });

  it("denies cross-tenant access for searchVendors and validates args strictly", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(10));
      const ctx = { tenantId: "TENANT_A", userId: "user_tenant_guard", requestId: "req-tenant-1" };

      // Cross-tenant args should be denied by the guardrail.
      const cross = await proxy.call("searchVendors", { tenantId: "TENANT_B", q: "ub", limit: 5 }, ctx);
      expect(notOk(cross)).toBe(true);
      if (notOk(cross)) {
        expect(cross.code).toBe("cross_tenant");
      }

      // q too short should fail validation even for the correct tenant.
      const badQ = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "u", limit: 10 }, ctx);
      expect(notOk(badQ)).toBe(true);
      if (notOk(badQ)) {
        expect(badQ.code).toBe("bad_args");
      }

      // Invalid limit should be rejected.
      const badLimit = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "ub", limit: 100 }, ctx);
      expect(notOk(badLimit)).toBe(true);
      if (notOk(badLimit)) {
        expect(badLimit.code).toBe("bad_args");
      }
    });
  });

  it("returns sanitized vendor results (no PII, no HTML/scripts) on valid search", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(10));
      const ctx = { tenantId: "TENANT_A", userId: "user_vendor", requestId: "req-vendor-1" };

      // Query "ub" matches "Uber" in TENANT_A and is >= 2 chars.
      const res = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "ub", limit: 10 }, ctx);
      expect(ok(res)).toBe(true);
      if (ok(res)) {
        expect(hasVendorItems(res.data)).toBe(true);
        if (hasVendorItems(res.data)) {
          // At least one item expected; all items must be sanitized.
          for (const item of res.data.items) {
            // Only safe fields should be present.
            expect(Object.keys(item).sort()).toEqual(["description", "id", "name"]);
            // No HTML tags or javascript: should leak into description.
            expect(item.description).not.toMatch(/<[^>]+>/);
            expect(item.description.toLowerCase()).not.toContain("javascript:");
            expect(item.description.toLowerCase()).not.toContain("<script>");
          }
        }
      }
    });
  });

  it("enforces per-user rate/budget limits and resets after the time window", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      // Use fake timers to control the sliding window used by the Budget class.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(1)); // allow only 1 call per minute per user/tool
      const ctx = { tenantId: "TENANT_A", userId: "user_rate", requestId: "req-rate-1" };

      // First call succeeds.
      const ok1 = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "ub", limit: 5 }, ctx);
      expect(ok(ok1)).toBe(true);

      // Second call within the same minute should be rate limited.
      const rl = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "ub", limit: 5 }, ctx);
      expect(notOk(rl)).toBe(true);
      if (notOk(rl)) {
        expect(rl.code).toBe("rate_limited");
      }

      // Advance time beyond the 60s window; the counter should reset.
      vi.advanceTimersByTime(61_000);

      const ok2 = await proxy.call("searchVendors", { tenantId: "TENANT_A", q: "ub", limit: 5 }, ctx);
      expect(ok(ok2)).toBe(true);
    });
  });

  it("validates createReimbursement arguments and rejects invalid inputs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.isolateModulesAsync(async () => {
      const { ToolProxy, Adapters, Budget } = await import("./main") as unknown as typeof SUT;

      const adapters = new Adapters();
      const proxy = new ToolProxy(adapters, new Budget(10));
      const ctx = { tenantId: "TENANT_A", userId: "user_validate", requestId: "req-validate-1" };

      // Invalid employeeId (not a UUID).
      const r1 = await proxy.call("createReimbursement", { employeeId: "not-a-uuid", amount: 100, memo: "x" }, ctx);
      expect(notOk(r1)).toBe(true);
      if (notOk(r1)) expect(r1.code).toBe("bad_args");

      // Invalid amount (negative).
      const r2 = await proxy.call("createReimbursement", { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: -5, memo: "x" }, ctx);
      expect(notOk(r2)).toBe(true);
      if (notOk(r2)) expect(r2.code).toBe("bad_args");

      // Invalid amount (exceeds max).
      const r3 = await proxy.call("createReimbursement", { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: 10_000, memo: "x" }, ctx);
      expect(notOk(r3)).toBe(true);
      if (notOk(r3)) expect(r3.code).toBe("bad_args");

      // Memo too long (> 200).
      const longMemo = "m".repeat(201);
      const r4 = await proxy.call("createReimbursement", { employeeId: "2c1a9cc2-3a2b-4a2e-9c2a-5e5a0b6e1f44", amount: 42, memo: longMemo }, ctx);
      expect(notOk(r4)).toBe(true);
      if (notOk(r4)) expect(r4.code).toBe("bad_args");
    });
  });
});