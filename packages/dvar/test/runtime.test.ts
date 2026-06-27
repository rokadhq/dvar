import { describe, expect, it, vi } from "vitest";
import {
  DvarApprovalRequiredError,
  DvarDeniedError,
  createDvar
} from "../src/index.js";
import type { DvarPolicy, DvarToolContext } from "../src/types.js";

const context: DvarToolContext = {
  principal: { id: "user-1", type: "user" },
  agent: { id: "agent-1" },
  environment: "production",
  tenant: { id: "tenant-a" }
};

function basePolicy(mode: DvarPolicy["mode"]): DvarPolicy {
  return {
    schemaVersion: "1",
    mode,
    defaultEffect: "deny",
    identity: { require: ["principal.id", "agent.id", "environment"] },
    rules: []
  };
}

describe("createDvar runtime", () => {
  it("blocks a denied tool before its executor runs", async () => {
    const runtime = await createDvar({ policy: basePolicy("enforce") });
    const execute = vi.fn(() => "executed");
    const protectedTool = runtime.protectTool({
      name: "records.delete",
      capabilities: ["data.delete"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" } }
      },
      execute
    });

    await expect(protectedTool({ id: "record-1" }, context)).rejects.toBeInstanceOf(DvarDeniedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an approval-specific error and does not execute", async () => {
    const policy: DvarPolicy = {
      ...basePolicy("enforce"),
      rules: [{
        id: "approval",
        effect: "require_approval",
        approval: { provider: "webhook", expiresInSeconds: 300 }
      }]
    };
    const runtime = await createDvar({ policy });
    const execute = vi.fn(() => "executed");
    const protectedTool = runtime.protectTool({ name: "billing.refund", execute });

    await expect(protectedTool({}, context)).rejects.toBeInstanceOf(DvarApprovalRequiredError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports an invalid schema in monitor mode but still executes", async () => {
    const events: unknown[] = [];
    const runtime = await createDvar({
      policy: basePolicy("monitor"),
      eventSink: (event) => { events.push(event); }
    });
    const execute = vi.fn(() => "executed");
    const protectedTool = runtime.protectTool({
      name: "records.read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" } }
      },
      execute
    });

    await expect(protectedTool({ id: 42 }, context)).resolves.toBe("executed");
    expect(execute).toHaveBeenCalledOnce();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "dvar.action.allowed",
        observedEffect: "would_deny",
        reasonCode: "argument.schema_invalid"
      })
    ]));
  });

  it("does not include raw tool arguments in default audit events", async () => {
    const events: Array<Record<string, unknown>> = [];
    const policy: DvarPolicy = {
      ...basePolicy("enforce"),
      defaultEffect: "allow"
    };
    const runtime = await createDvar({
      policy,
      eventSink: (event) => { events.push(event as unknown as Record<string, unknown>); }
    });
    const protectedTool = runtime.protectTool({
      name: "secrets.lookup",
      execute: () => "ok"
    });

    await protectedTool({ token: "do-not-log" }, context);
    expect(JSON.stringify(events)).not.toContain("do-not-log");
    expect(events.every((event) => !("arguments" in event))).toBe(true);
  });

  it("applies explicit onEvaluationError behavior without executing the tool", async () => {
    const events: Array<Record<string, unknown>> = [];
    const policy: DvarPolicy = {
      ...basePolicy("enforce"),
      runtime: { onEvaluationError: "deny" },
      defaultEffect: "allow"
    };
    const runtime = await createDvar({
      policy,
      eventSink: (event) => { events.push(event as unknown as Record<string, unknown>); }
    });
    const execute = vi.fn(() => "executed");
    const protectedTool = runtime.protectTool<{ self?: unknown }, string>({
      name: "records.read",
      execute
    });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(protectedTool(circular, context)).rejects.toMatchObject({
      decision: expect.objectContaining({
        ruleId: "system.evaluation_error",
        reasonCode: "runtime.internal_error",
        effect: "deny"
      })
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "dvar.runtime.internal_error" })
    ]));
  });

});
