import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDvar, createMcpHttpProxy } from "../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

describe("MCP runtime quotas", () => {
  it("denies the second session call before upstream forwarding", async () => {
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
