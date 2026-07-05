import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDvar,
  createInventory,
  createMcpHttpProxy,
  createServerInventory,
  inventoryToLockfile
} from "../src/index.js";
import type { DvarPolicy } from "../src/types.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function upstreamServer(): Promise<{
  url: string;
  calls: () => number;
  lastHeaders: () => Record<string, string | string[] | undefined> | undefined;
}> {
  let count = 0;
  let headers: Record<string, string | string[] | undefined> | undefined;
  const server = createServer(async (request, response) => {
    count += 1;
    headers = request.headers;
    let source = "";
    for await (const chunk of request) source += chunk.toString();
    const message = JSON.parse(source) as { id?: unknown };
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "deleted" }] }
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No upstream address");
  closers.push(() => new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))));
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls: () => count,
    lastHeaders: () => headers
  };
}

function policy(mode: DvarPolicy["mode"]): DvarPolicy {
  return {
    schemaVersion: "1",
    mode,
    defaultEffect: "allow",
    integrity: {
      requireLockfile: true,
      onUnknownServer: "deny",
      onUnknownTool: "deny",
      onDescriptionChange: "deny",
      onSchemaChange: "deny",
      onCapabilityExpansion: "deny"
    },
    rules: [{
      id: "deny-delete-production",
      priority: 1000,
      effect: "deny",
      when: {
        environment: "production",
        "tool.capabilities": { containsAny: ["data.delete"] }
      }
    }]
  };
}

async function setup(
  mode: DvarPolicy["mode"],
  observedInputSchema: Record<string, unknown> = {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"]
  }
): Promise<{
  proxyUrl: string;
  upstream: Awaited<ReturnType<typeof upstreamServer>>;
}> {
  const upstream = await upstreamServer();
  const lockedServerInventory = createServerInventory({
    id: "mock",
    endpoint: upstream.url,
    tools: [{
      name: "customers.delete",
      description: "Delete customer",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
    }]
  });
  const observedServerInventory = createServerInventory({
    id: "mock",
    endpoint: upstream.url,
    tools: [{
      name: "customers.delete",
      description: "Delete customer",
      inputSchema: observedInputSchema
    }]
  });
  const inventory = createInventory([observedServerInventory]);
  const runtime = await createDvar({
    policy: policy(mode),
    lockfile: inventoryToLockfile(createInventory([lockedServerInventory]))
  });
  const proxy = createMcpHttpProxy({
    upstream: upstream.url,
    runtime,
    serverId: "mock",
    inventory
  });
  const address = await proxy.listen({ port: 0 });
  closers.push(() => proxy.close());
  return { proxyUrl: `http://127.0.0.1:${address.port}/mcp`, upstream };
}

const requestBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "customers.delete", arguments: { id: "customer-1" } }
};

describe("MCP Streamable HTTP proxy", () => {
  it("denies a tool call before it reaches upstream", async () => {
    const { proxyUrl, upstream } = await setup("enforce");
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dvar-principal-id": "user-1",
        "x-dvar-agent-id": "support-agent",
        "x-dvar-environment": "production"
      },
      body: JSON.stringify(requestBody)
    });
    const body = await response.json() as { error?: { code?: number; data?: { dvar?: { reasonCode?: string } } } };
    expect(response.status).toBe(200);
    expect(body.error?.code).toBe(-32001);
    expect(body.error?.data?.dvar?.reasonCode).toBe("policy.explicit_deny");
    expect(upstream.calls()).toBe(0);
  });

  it("blocks a preflight-observed schema change before it reaches upstream", async () => {
    const { proxyUrl, upstream } = await setup("enforce", {
      type: "object",
      properties: { id: { type: "string" }, force: { type: "boolean" } },
      required: ["id"]
    });
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dvar-principal-id": "user-1",
        "x-dvar-agent-id": "support-agent",
        "x-dvar-environment": "development"
      },
      body: JSON.stringify(requestBody)
    });
    const body = await response.json() as { error?: { data?: { dvar?: { reasonCode?: string } } } };
    expect(body.error?.data?.dvar?.reasonCode).toBe("tool.schema_changed");
    expect(upstream.calls()).toBe(0);
  });

  it("allows monitor-mode calls, forwards trace context, and does not relay authorization by default", async () => {
    const { proxyUrl, upstream } = await setup("monitor");
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer caller-token",
        "content-type": "application/json",
        traceparent,
        "x-dvar-principal-id": "user-1",
        "x-dvar-agent-id": "support-agent",
        "x-dvar-environment": "production"
      },
      body: JSON.stringify(requestBody)
    });
    const body = await response.json() as { result?: unknown };
    expect(body.result).toBeDefined();
    expect(upstream.calls()).toBe(1);
    expect(upstream.lastHeaders()?.traceparent).toBe(traceparent);
    expect(upstream.lastHeaders()?.authorization).toBeUndefined();
  });
});
