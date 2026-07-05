import { describe, expect, it } from "vitest";
import {
  DvarDeniedError,
  createDvar,
  protectVercelAISDKTool,
  protectVercelAISDKTools,
  runAdapterConformanceSuite,
  type DvarPolicy,
  type DvarToolContext,
  type VercelAISDKToolLike,
  type VercelAISDKNeedsApproval
} from "../src/index.js";

const context: DvarToolContext = {
  principal: { id: "user-1", type: "user" },
  agent: { id: "agent-1" },
  environment: "test",
  session: { id: "session-1" }
};

function policy(defaultEffect: "allow" | "deny" = "allow"): DvarPolicy {
  return {
    schemaVersion: "1",
    mode: "enforce",
    defaultEffect,
    rules: [{
      id: "deny-delete",
      effect: "deny",
      when: { "tool.name": "deleteFile" }
    }, {
      id: "approve-payment",
      effect: "require_approval",
      when: { "tool.name": "chargeCard" },
      approval: {
        provider: "manual",
        scope: "session",
        bind: ["principal.id", "environment", "tool.name", "session.id"]
      }
    }]
  };
}

function approvalFunction<TInput>(
  value: VercelAISDKNeedsApproval<TInput, unknown> | undefined
): (input: TInput) => Promise<boolean> {
  if (typeof value !== "function") throw new Error("Expected needsApproval function");
  return (input) => Promise.resolve(value(input));
}

describe("Vercel AI SDK adapter", () => {
  it("wraps an AI SDK-style tool execute function through Dvar", async () => {
    const runtime = await createDvar({ policy: policy() });
    const tools = protectVercelAISDKTools({
      weather: {
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"]
        },
        strict: true,
        execute: async (input: { location: string }) => ({ location: input.location, temperature: 27 })
      } satisfies VercelAISDKToolLike<{ location: string }, { location: string; temperature: number }>
    }, {
      runtime,
      context,
      capabilities: ["read"]
    });
    const weather = tools.weather;
    if (weather === undefined) throw new Error("weather tool missing");

    await expect(weather.execute?.({ location: "Bhubaneswar" })).resolves.toEqual({
      location: "Bhubaneswar",
      temperature: 27
    });
    expect(weather.strict).toBe(true);
    expect(weather.description).toBe("Get weather");
  });

  it("denies protected AI SDK-style tools when Dvar denies the action", async () => {
    const runtime = await createDvar({ policy: policy() });
    const tool = protectVercelAISDKTool("deleteFile", {
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async () => ({ deleted: true })
    }, {
      runtime,
      context
    });

    await expect(tool.execute?.({ path: "/tmp/a" })).rejects.toBeInstanceOf(DvarDeniedError);
  });

  it("composes Vercel needsApproval with Dvar approval decisions", async () => {
    const runtime = await createDvar({ policy: policy() });
    const decisions: string[] = [];
    const tool = protectVercelAISDKTool("chargeCard", {
      inputSchema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
      needsApproval: async (input: { amount: number }) => input.amount > 10_000,
      execute: async () => ({ charged: true })
    }, {
      runtime,
      context,
      onDecision: ({ decision }) => { decisions.push(decision.effect); }
    });

    await expect(approvalFunction<{ amount: number }>(tool.needsApproval)({ amount: 100 })).resolves.toBe(true);
    expect(decisions).toEqual(["require_approval"]);
  });

  it("keeps original static needsApproval requirements", async () => {
    const runtime = await createDvar({ policy: policy() });
    const tool = protectVercelAISDKTool("readFile", {
      needsApproval: true,
      execute: async () => ({ ok: true })
    }, {
      runtime,
      context
    });

    await expect(approvalFunction<Record<string, never>>(tool.needsApproval)({})).resolves.toBe(true);
  });

  it("uses adapter conformance cases for framework wrappers", async () => {
    const runtime = await createDvar({ policy: policy() });
    const tool = protectVercelAISDKTool("weather", {
      execute: async (input: { location: string }) => ({ location: input.location })
    }, {
      runtime,
      context
    });

    const summary = await runAdapterConformanceSuite([{
      name: "executes protected adapter tool",
      run: async () => {
        const result = await tool.execute?.({ location: "Ranchi" });
        expect(result).toEqual({ location: "Ranchi" });
      }
    }, {
      name: "reports failing conformance case",
      run: () => {
        throw new Error("intentional");
      }
    }]);

    expect(summary.passed).toBe(false);
    expect(summary.results).toEqual([
      { name: "executes protected adapter tool", status: "passed" },
      { name: "reports failing conformance case", status: "failed", error: "intentional" }
    ]);
  });
});
