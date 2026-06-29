import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryApprovalUseStore,
  createDvar,
  createHmacApprovalSigner,
  createMcpHttpProxy
} from "../src/index.js";
import type {
  DvarAction,
  DvarPolicy,
  DvarRuntimeStore
} from "../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

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
      checkedAt: new Date().toISOString(),
      message: "shared store unavailable"
    })
  };
}

describe("runtime safety integration", () => {
  it("fails closed on store errors unless enforce mode explicitly fails open", async () => {
    const base: DvarPolicy = {
      schemaVersion: "1",
      mode: "enforce",
      defaultEffect: "allow",
      runtime: { maxToolCallsPerTask: 1 }
    };
    const closed = await createDvar({
      policy: base,
      runtimeSafety: { store: failingStore() }
    });
    await expect(closed.authorize(action())).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "runtime.store_unavailable"
    });

    const open = await createDvar({
      policy: {
        ...base,
        runtime: {
          maxToolCallsPerTask: 1,
          onRuntimeStoreError: "allow"
        }
      },
      runtimeSafety: { store: failingStore() }
    });
    await expect(open.authorize(action())).resolves.toMatchObject({
      effect: "allow",
      reasonCode: "runtime.store_error_fail_open"
    });

    const strict = await createDvar({
      policy: {
        ...base,
        mode: "strict",
        runtime: {
          maxToolCallsPerTask: 1,
          onRuntimeStoreError: "allow"
        }
      },
      runtimeSafety: { store: failingStore() }
    });
    await expect(strict.authorize(action())).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "runtime.store_unavailable"
    });
  });

  it("emits bounded runtime-denial audit metadata", async () => {
    const events: Array<Record<string, unknown>> = [];
    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "allow",
        runtime: { maxToolCallsPerTask: 1 }
      },
      eventSink: (event) => { events.push(event); }
    });
    await runtime.authorize(action());
    await runtime.authorize(action());
    expect(events).toContainEqual(expect.objectContaining({
      type: "dvar.action.denied",
      reasonCode: "quota.exceeded",
      runtimeControl: "calls_per_task",
      runtimeStore: "memory",
      runtimeDistributed: false,
      runtimeCurrent: 1,
      runtimeLimit: 1
    }));
  });

  it("binds approval grants to reviewed runtime usage", async () => {
    const signer = createHmacApprovalSigner({
      issuer: "test",
      secret: "0123456789abcdef0123456789abcdef"
    });
    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "deny",
        rules: [{
          id: "approve-charge",
          effect: "require_approval",
          when: { "tool.name": "billing.charge" },
          approval: { provider: "manual", scope: "once" }
        }]
      },
      approval: {
        signer,
        useStore: new InMemoryApprovalUseStore()
      }
    });
    const reviewed = action({
      usage: { monetaryValue: 10, currency: "INR" }
    });
    const request = (await runtime.evaluate(reviewed)).approvalRequest!;
    const grant = await signer.issue(request, {
      approver: { id: "reviewer-1" }
    });
    await expect(runtime.resume({
      ...reviewed,
      id: crypto.randomUUID(),
      usage: { monetaryValue: 20, currency: "INR" }
    }, grant.token)).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "approval.binding_mismatch"
    });
  });

  it("enforces session quotas at the MCP boundary before forwarding", async () => {
    let upstreamCalls = 0;
    const upstream = createServer(async (request, response) => {
      upstreamCalls += 1;
      let source = "";
      for await (const chunk of request) source += chunk.toString();
      const message = JSON.parse(source) as { id?: unknown };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "ok" }] }
      }));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolve);
    });
    closers.push(() => new Promise((resolve, reject) => {
      upstream.close((error) => error === undefined ? resolve() : reject(error));
    }));
    const upstreamAddress = upstream.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("No upstream address");
    }

    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "allow",
        runtime: { maxToolCallsPerSession: 1 }
      }
    });
    const proxy = createMcpHttpProxy({
      upstream: `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      serverId: "billing",
      runtime
    });
    const address = await proxy.listen({ port: 0 });
    closers.push(() => proxy.close());
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;
    const headers = {
      "content-type": "application/json",
      "x-dvar-principal-id": "user-1",
      "x-dvar-agent-id": "agent-1",
      "x-dvar-environment": "production",
      "x-dvar-session-id": "session-1"
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "billing.charge", arguments: { amount: 10 } }
    });

    const first = await fetch(endpoint, { method: "POST", headers, body })
      .then((response) => response.json()) as { result?: unknown };
    expect(first.result).toBeDefined();

    const second = await fetch(endpoint, { method: "POST", headers, body })
      .then((response) => response.json()) as {
        error?: { data?: { dvar?: { reasonCode?: string } } };
      };
    expect(second.error?.data?.dvar?.reasonCode).toBe("quota.exceeded");
    expect(upstreamCalls).toBe(1);
  });
});
