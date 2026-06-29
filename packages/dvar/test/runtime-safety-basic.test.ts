import { describe, expect, it } from "vitest";
import {
  DvarConfigurationError,
  InMemoryRuntimeStore,
  createDvar
} from "../src/index.js";
import type { DvarAction, DvarPolicy } from "../src/types.js";

function policy(runtime: NonNullable<DvarPolicy["runtime"]>): DvarPolicy {
  return {
    schemaVersion: "1",
    version: "0.4-test",
    mode: "enforce",
    defaultEffect: "allow",
    runtime
  };
}

function action(overrides: Partial<DvarAction> = {}): DvarAction {
  return {
    id: crypto.randomUUID(),
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    tenant: { id: "tenant-1" },
    session: { id: "session-1" },
    task: { id: "task-1" },
    environment: "production",
    server: { id: "billing" },
    tool: { name: "billing.charge" },
    arguments: { amount: 10 },
    ...overrides
  };
}

describe("runtime safety limits", () => {
  it("keeps evaluate pure while authorize consumes quota", async () => {
    const runtime = await createDvar({ policy: policy({ maxToolCallsPerTask: 1 }) });
    await expect(runtime.evaluate(action())).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.evaluate(action())).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.authorize(action())).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.authorize(action())).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "quota.exceeded"
    });
  });

  it("enforces depth, retries, and monetary totals", async () => {
    const runtime = await createDvar({
      policy: policy({
        maxDepth: 2,
        maxRetries: 1,
        quotas: [{
          id: "hourly-inr",
          metric: "monetary",
          limit: 100,
          windowSeconds: 3600,
          currency: "INR",
          scope: ["tenant"]
        }]
      })
    });
    await expect(runtime.authorize(action({ trace: { depth: 3 } })))
      .resolves.toMatchObject({ reasonCode: "runtime.depth_exceeded" });
    await expect(runtime.authorize(action({ usage: { retry: 2 } })))
      .resolves.toMatchObject({ reasonCode: "runtime.retry_exceeded" });
    await runtime.authorize(action({ usage: { monetaryValue: 60, currency: "INR" } }));
    await expect(runtime.authorize(action({
      usage: { monetaryValue: 50, currency: "INR" }
    }))).resolves.toMatchObject({ reasonCode: "quota.exceeded" });
  });

  it("requires a shared store for multi-instance enforcement", async () => {
    await expect(createDvar({
      policy: policy({ maxToolCallsPerTask: 1 }),
      runtimeSafety: { deploymentInstances: 2 }
    })).rejects.toBeInstanceOf(DvarConfigurationError);
  });

  it("reports process-local diagnostics", async () => {
    const runtime = await createDvar({
      policy: policy({ maxToolCallsPerTask: 2 }),
      runtimeSafety: { store: new InMemoryRuntimeStore() }
    });
    await expect(runtime.diagnostics()).resolves.toMatchObject({
      enabled: true,
      store: { kind: "memory", distributed: false, healthy: true }
    });
  });
});
