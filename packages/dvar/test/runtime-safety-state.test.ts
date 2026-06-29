import { describe, expect, it, vi } from "vitest";
import {
  DvarDeniedError,
  InMemoryRuntimeStore,
  createDvar
} from "../src/index.js";
import type { DvarAction, DvarPolicy } from "../src/types.js";

function policy(runtime: NonNullable<DvarPolicy["runtime"]>): DvarPolicy {
  return {
    schemaVersion: "1",
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
    task: { id: "task-1" },
    environment: "production",
    server: { id: "billing" },
    tool: { name: "billing.charge" },
    arguments: { amount: 10 },
    ...overrides
  };
}

describe("runtime safety state machines", () => {
  it("detects repeated and alternating action loops", async () => {
    const repeated = await createDvar({
      policy: policy({
        loopDetection: {
          maxRepeatedAction: 2,
          maxOscillations: 10,
          historySize: 16,
          scope: ["task"]
        }
      })
    });
    await repeated.authorize(action({ id: "repeat-1" }));
    await repeated.authorize(action({ id: "repeat-2" }));
    await expect(repeated.authorize(action({ id: "repeat-3" })))
      .resolves.toMatchObject({ reasonCode: "runtime.loop_detected" });

    const alternating = await createDvar({
      policy: policy({
        loopDetection: {
          maxRepeatedAction: 20,
          maxOscillations: 1,
          historySize: 8,
          scope: ["task"]
        }
      })
    });
    const first = action({ tool: { name: "a" } });
    const second = action({ tool: { name: "b" } });
    await alternating.authorize(first);
    await alternating.authorize(second);
    await alternating.authorize({ ...first, id: "a-2" });
    await expect(alternating.authorize({ ...second, id: "b-2" }))
      .resolves.toMatchObject({ reasonCode: "runtime.oscillation_detected" });
  });

  it("opens, probes, and closes a circuit breaker", async () => {
    let now = 1_000;
    const runtime = await createDvar({
      policy: policy({
        circuitBreakers: [{
          id: "billing",
          failureThreshold: 2,
          recoverySeconds: 10
        }]
      }),
      runtimeSafety: {
        clock: () => now,
        store: new InMemoryRuntimeStore()
      }
    });
    const first = action();
    await runtime.authorize(first);
    await runtime.recordOutcome(first, { success: false });
    const second = action();
    await runtime.authorize(second);
    await runtime.recordOutcome(second, { success: false });
    await expect(runtime.authorize(action())).resolves.toMatchObject({
      reasonCode: "runtime.circuit_open"
    });
    now += 11_000;
    const probe = action();
    await expect(runtime.authorize(probe)).resolves.toMatchObject({ effect: "allow" });
    await runtime.recordOutcome(probe, { success: true });
    await expect(runtime.authorize(action())).resolves.toMatchObject({ effect: "allow" });
  });

  it("records protected-tool failures before blocking execution", async () => {
    const execute = vi.fn(async () => {
      throw new Error("upstream failed");
    });
    const runtime = await createDvar({
      policy: policy({
        circuitBreakers: [{
          id: "local",
          failureThreshold: 1,
          recoverySeconds: 60
        }]
      })
    });
    const protectedTool = runtime.protectTool({
      name: "billing.charge",
      execute
    });
    const context = {
      principal: { id: "user-1", type: "user" as const },
      agent: { id: "agent-1" },
      environment: "production"
    };
    await expect(protectedTool({}, context)).rejects.toThrow("upstream failed");
    await expect(protectedTool({}, context)).rejects.toBeInstanceOf(DvarDeniedError);
    expect(execute).toHaveBeenCalledOnce();
  });
});
