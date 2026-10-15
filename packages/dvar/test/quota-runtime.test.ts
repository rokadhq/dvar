import { describe, expect, it } from "vitest";
import { createDvar, createInMemoryQuotaReservationStore } from "../src/index.js";
import type { DvarAction } from "../src/index.js";

const action = (id: string, tenant = "one", amount = 1): DvarAction => ({
  id, principal: { id: "user", type: "user" }, agent: { id: "agent" },
  tenant: { id: tenant }, session: { id: "same-session" }, task: { id: "same-task" },
  environment: "test", server: { id: "billing" }, tool: { name: "charge" },
  arguments: { amount }, usage: { monetaryValue: amount, currency: "INR" }
});

describe("atomic quota runtime integration", () => {
  it("does not charge task/session budgets when a later monetary budget rejects", async () => {
    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "enforce", defaultEffect: "allow", runtime: {
        maxToolCallsPerTask: 2, maxToolCallsPerSession: 2,
        quotas: [{ id: "amount", metric: "monetary", limit: 10, windowSeconds: 60, scope: ["tenant"], currency: "INR" }]
      } },
      runtimeSafety: { quotaReservations: createInMemoryQuotaReservationStore({ namespace: "test" }) }
    });
    expect((await runtime.authorize(action("bad", "one", 20))).reasonCode).toBe("quota.exceeded");
    expect((await runtime.authorize(action("first"))).effect).toBe("allow");
    expect((await runtime.authorize(action("second"))).effect).toBe("allow");
    expect((await runtime.authorize(action("third"))).reasonCode).toBe("quota.exceeded");
  });

  it("replays and mismatched bindings cannot authorize another execution", async () => {
    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "strict", defaultEffect: "allow", runtime: { maxToolCallsPerTask: 5 } },
      runtimeSafety: { quotaReservations: createInMemoryQuotaReservationStore({ namespace: "test" }) }
    });
    expect((await runtime.authorize(action("same"))).effect).toBe("allow");
    expect(await runtime.authorize(action("same"))).toMatchObject({ effect: "deny", reasonCode: "runtime.reservation_replayed" });
    expect(await runtime.authorize(action("same", "one", 2))).toMatchObject({ effect: "deny", reasonCode: "runtime.reservation_conflict" });
  });

  it("isolates same-named task and session identifiers across tenants", async () => {
    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "enforce", defaultEffect: "allow", runtime: { maxToolCallsPerTask: 1, maxToolCallsPerSession: 1 } },
      runtimeSafety: { quotaReservations: createInMemoryQuotaReservationStore({ namespace: "test" }) }
    });
    expect((await runtime.authorize(action("a", "one"))).effect).toBe("allow");
    expect((await runtime.authorize(action("b", "two"))).effect).toBe("allow");
    expect((await runtime.authorize(action("c", "one"))).effect).toBe("deny");
  });

  it("does not reserve on evaluate previews or missing accounting context", async () => {
    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "enforce", defaultEffect: "allow", runtime: {
        maxToolCallsPerTask: 1,
        quotas: [{ id: "cost", metric: "cost", limit: 5, windowSeconds: 60 }]
      } }, runtimeSafety: { quotaReservations: createInMemoryQuotaReservationStore({ namespace: "test" }) }
    });
    expect((await runtime.evaluate(action("preview"))).effect).toBe("allow");
    expect((await runtime.authorize(action("missing"))).reasonCode).toBe("runtime.usage_missing");
    const valid = { ...action("valid"), usage: { cost: 1 } };
    expect((await runtime.authorize(valid)).effect).toBe("allow");
  });

  it("rejects local quota state when distributed enforcement is declared", async () => {
    await expect(createDvar({
      policy: { schemaVersion: "1", mode: "enforce", defaultEffect: "allow", runtime: { maxToolCallsPerTask: 1 } },
      runtimeSafety: { deploymentInstances: 2, quotaReservations: createInMemoryQuotaReservationStore({ namespace: "test" }) }
    })).rejects.toThrow("shared reservation store");
  });

  it("does not fall back to sequential counters when the selected store fails", async () => {
    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "strict", defaultEffect: "allow", runtime: { maxToolCallsPerTask: 1, onRuntimeStoreError: "allow" } },
      runtimeSafety: { quotaReservations: { kind: "failed", distributed: true, reserve() { throw new Error("unavailable"); } } }
    });
    expect(await runtime.authorize(action("id"))).toMatchObject({ effect: "deny", reasonCode: "runtime.store_unavailable" });
  });
});
