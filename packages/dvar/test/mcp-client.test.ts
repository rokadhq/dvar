import { describe, expect, it, vi } from "vitest";
import {
  parseMcpResponseMessages,
  scanMcpServer,
  validateMcpEndpoint
} from "../src/index.js";

describe("MCP Streamable HTTP scanner", () => {
  it("initializes, binds the session, paginates tools/list, and closes the session", async () => {
    const calls: Array<{ method: string; headers: Headers; body?: unknown }> = [];
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      calls.push({ method, headers, ...(body !== undefined ? { body } : {}) });
      if (method === "DELETE") return new Response(null, { status: 204 });
      const rpcMethod = body?.method;
      if (rpcMethod === "initialize") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "mock", version: "1.0.0" }
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "session-1" }
        });
      }
      if (rpcMethod === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpcMethod === "tools/list" && (body?.params as Record<string, unknown>)?.cursor === undefined) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id,
          result: {
            tools: [{ name: "customers.search", description: "Search customers", inputSchema: { type: "object" } }],
            nextCursor: "page-2"
          }
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body?.id,
        result: {
          tools: [{ name: "customers.delete", description: "Delete customer", inputSchema: { type: "object" } }]
        }
      }), { headers: { "content-type": "application/json" } });
    });

    const inventory = await scanMcpServer({
      endpoint: "http://127.0.0.1:4319/mcp",
      serverId: "mock",
      fetch: fetchFn as typeof fetch
    });

    expect(inventory.servers[0]).toMatchObject({
      id: "mock",
      protocolVersion: "2025-11-25",
      serverInfo: { name: "mock" }
    });
    expect(inventory.servers[0]?.tools.map((tool) => tool.name)).toEqual([
      "customers.delete",
      "customers.search"
    ]);
    const toolRequests = calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.method === "tools/list");
    expect(toolRequests).toHaveLength(2);
    expect(toolRequests[0]?.headers.get("mcp-session-id")).toBe("session-1");
    expect(toolRequests[0]?.headers.get("mcp-protocol-version")).toBe("2025-11-25");
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("parses JSON-RPC messages from SSE responses", async () => {
    const response = new Response(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
      { headers: { "content-type": "text/event-stream" } }
    );
    await expect(parseMcpResponseMessages(response)).resolves.toEqual([
      { jsonrpc: "2.0", id: 1, result: { tools: [] } }
    ]);
  });

  it("rejects embedded credentials and non-local plaintext endpoints", () => {
    expect(() => validateMcpEndpoint("https://user:secret@example.test/mcp")).toThrow(/embedded credentials/u);
    expect(() => validateMcpEndpoint("http://example.test/mcp")).toThrow(/Plain HTTP/u);
    expect(validateMcpEndpoint("http://localhost:3000/mcp").hostname).toBe("localhost");
  });
});
