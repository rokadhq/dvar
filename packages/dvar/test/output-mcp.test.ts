import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDvar, createMcpHttpProxy } from "../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

describe("MCP output guard", () => {
  it("redacts upstream JSON-RPC tool output before returning it", async () => {
    const upstream = createServer(async (request, response) => {
      let source = "";
      for await (const chunk of request) source += chunk.toString();
      const message = JSON.parse(source) as { id?: unknown };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "token=abcdefghijklmnop" }] }
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
    if (upstreamAddress === null || typeof upstreamAddress === "string") throw new Error("No upstream address");

    const runtime = await createDvar({
      policy: { schemaVersion: "1", mode: "enforce", defaultEffect: "allow" }
    });
    const proxy = createMcpHttpProxy({
      upstream: `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      serverId: "test",
      runtime,
      outputGuard: { policy: {} }
    });
    const address = await proxy.listen({ port: 0 });
    closers.push(() => proxy.close());

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dvar-principal-id": "user-1",
        "x-dvar-agent-id": "agent-1",
        "x-dvar-environment": "test"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read.secret", arguments: {} }
      })
    });
    const body = await response.text();
    expect(body).toContain("[REDACTED]");
    expect(body).not.toContain("abcdefghijklmnop");
  });
});
