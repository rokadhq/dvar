import { describe, expect, it } from "vitest";
import { createDvar } from "../src/index.js";
import type { DvarAction, DvarPolicy, DvarRuntimeStore } from "../src/index.js";

function action(): DvarAction {
  return {
    id: crypto.randomUUID(),
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    task: { id: "task-1" },
    environment: "production",
    server: { id: "billing" },
    tool: { name: "billing.charge" },
    arguments: {}
  };
}

function failingStore(): DvarRuntimeStore {
  const unavailable = async (): Promise<never> => {
    throw new Error("shared store unavailable");
  };
  return {
    kind: "failing",
    distributed: true,
    consumeCounter: unavailable,
    appendSequence: unavailable,
    circuitBefore: unavailable,
    circuitAfter: unavailable,
    diagnostics: async () => ({
      kind: "failing",
      distributed: true,
      healthy: false,
      checkedAt: new Date().toISOString()
    })
  };
}

function policy(
  mode: DvarPolicy["mode"],
  onRuntimeStoreError?: "allow" | "deny"
): DvarPolicy {
  return {
    schemaVersion: "1",
    mode,
    defaultEffect: "allow",
    runtime: {
      maxToolCallsPerTask: 1,
      ...(onRuntimeStoreError !== undefined ? { onRuntimeStoreError } : {})
    }
  };
}

describe("runtime store failure behavior", () => {
  it("fails closed by default", async () => {
    const runtime = await createDvar({
      policy: policy("enforce"),
      runtimeSafety: { store: failingStore() }
    });
    await expect(runtime.authorize(action())).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "runtime.store_unavailable"
    });
  });

  it("allows explicit fail-open only outside strict mode", async () => {
    const open = await createDvar({
      policy: policy("enforce", "allow"),
      runtimeSafety: { store: failingStore() }
    });
    await expect(open.authorize(action())).resolves.toMatchObject({
      effect: "allow",
      reasonCode: "runtime.store_error_fail_open"
    });

    const strict = await createDvar({
      policy: policy("strict", "allow"),
      runtimeSafety: { store: failingStore() }
    });
    await expect(strict.authorize(action())).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "runtime.store_unavailable"
    });
  });
});
