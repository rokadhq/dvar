import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryApprovalUseStore,
  createDvar,
  createHmacApprovalSigner,
  createMcpHttpProxy
} from "../src/index.js";
import type {
  DvarApprovalRequest,
  DvarPolicy
} from "../src/types.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

const policy: DvarPolicy = {
  schemaVersion: "1",
  version: "0.3-mcp-test",
  mode: "enforce",
  defaultEffect: "allow",
  rules: [{
    id: "approve-refund",
    effect: "require_approval",
    when: { "tool.name": "billing.refund" },
    approval: {
      provider: "test",
      scope: "once",
      expiresInSeconds: 300,
      maxUses: 1
    }
  }]
};

async function createUpstream(): Promise<{
  endpoint: string;
  calls: () => number;
  approvalHeader: () => string | undefined;
}> {
  let calls = 0;
  let approvalHeader: string | undefined;
  const server = createServer(async (request, response) => {
    calls += 1;
    const raw = request.headers["x-dvar-approval-grant"];
    approvalHeader = Array.isArray(raw) ? raw[0] : raw;
    let source = "";
    for await (const chunk of request) source += chunk.toString();
    const message = JSON.parse(source) as { id?: unknown };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "refunded" }] }
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("No upstream address");
  }
  closers.push(() => new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  }));
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    calls: () => calls,
    approvalHeader: () => approvalHeader
  };
}

const body = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "billing.refund",
    arguments: { paymentId: "pay-1", amount: 5000 }
  }
};

const headers = {
  "content-type": "application/json",
  "x-dvar-principal-id": "user-1",
  "x-dvar-agent-id": "finance-agent",
  "x-dvar-environment": "production"
};

describe("approval-aware MCP proxy", () => {
  it("pauses, accepts a delayed grant, and strips it upstream", async () => {
    const upstream = await createUpstream();
    const signer = createHmacApprovalSigner({
      secret: "0123456789abcdef0123456789abcdef",
      issuer: "test"
    });
    let captured: DvarApprovalRequest | undefined;
    const runtime = await createDvar({
      policy,
      approval: {
        signer,
        useStore: new InMemoryApprovalUseStore(),
        provider: {
          name: "test",
          request: async (request) => {
            captured = request;
            return { status: "pending", requestId: request.id };
          }
        }
      }
    });
    const proxy = createMcpHttpProxy({
      upstream: upstream.endpoint,
      serverId: "billing",
      runtime
    });
    const address = await proxy.listen({ port: 0 });
    closers.push(() => proxy.close());
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;

    const paused = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }).then((response) => response.json()) as {
      error?: { code?: number; data?: { dvar?: { reasonCode?: string } } };
    };
    expect(paused.error?.code).toBe(-32002);
    expect(paused.error?.data?.dvar?.reasonCode).toBe("approval.required");
    expect(captured).toBeDefined();
    expect(upstream.calls()).toBe(0);

    const grant = await signer.issue(captured!, {
      approver: { id: "reviewer-1", type: "user" }
    });
    const resumed = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "x-dvar-approval-grant": grant.token },
      body: JSON.stringify(body)
    }).then((response) => response.json()) as { result?: unknown };

    expect(resumed.result).toBeDefined();
    expect(upstream.calls()).toBe(1);
    expect(upstream.approvalHeader()).toBeUndefined();
  });

  it("automatically resumes an immediately approved provider result", async () => {
    const upstream = await createUpstream();
    const signer = createHmacApprovalSigner({
      secret: "0123456789abcdef0123456789abcdef",
      issuer: "test"
    });
    const runtime = await createDvar({
      policy,
      approval: {
        signer,
        useStore: new InMemoryApprovalUseStore(),
        provider: {
          name: "test",
          request: async (request) => ({
            status: "approved",
            requestId: request.id,
            grant: (await signer.issue(request, {
              approver: { id: "reviewer-1" }
            })).token
          })
        }
      }
    });
    const proxy = createMcpHttpProxy({
      upstream: upstream.endpoint,
      serverId: "billing",
      runtime
    });
    const address = await proxy.listen({ port: 0 });
    closers.push(() => proxy.close());

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }).then((result) => result.json()) as { result?: unknown };
    expect(response.result).toBeDefined();
    expect(upstream.calls()).toBe(1);
  });
});
