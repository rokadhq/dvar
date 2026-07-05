import { createServer } from "node:http";
import {
  createDvar,
  createMcpHttpProxy,
  inventoryToLockfile,
  scanMcpServer
} from "@rokadhq/dvar";

let destructiveExecutions = 0;
const upstream = createServer(async (request, response) => {
  if (request.method === "DELETE") {
    response.statusCode = 204;
    response.end();
    return;
  }

  let source = "";
  for await (const chunk of request) source += chunk.toString();
  const message = JSON.parse(source);

  if (message.method === "notifications/initialized") {
    response.statusCode = 202;
    response.end();
    return;
  }

  let result;
  if (message.method === "initialize") {
    response.setHeader("MCP-Session-Id", "demo-session");
    result = {
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "dvar-demo", version: "1.0.0" }
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: [{
        name: "customers.delete",
        description: "Delete a customer record",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        annotations: { destructiveHint: true }
      }]
    };
  } else if (message.method === "tools/call") {
    destructiveExecutions += 1;
    result = { content: [{ type: "text", text: "deleted" }] };
  }

  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});

await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamAddress = upstream.address();
const endpoint = `http://127.0.0.1:${upstreamAddress.port}/mcp`;

const inventory = await scanMcpServer({ endpoint, serverId: "demo" });
const lockfile = inventoryToLockfile(inventory);
console.log("discovered", inventory.servers[0].tools.map((tool) => ({
  name: tool.name,
  capabilities: tool.capabilities,
  risk: tool.risk
})));

const basePolicy = {
  schemaVersion: "1",
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
    id: "deny-destructive-production",
    priority: 1000,
    effect: "deny",
    when: {
      environment: "production",
      "tool.capabilities": { containsAny: ["data.delete"] }
    }
  }]
};

const call = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "customers.delete", arguments: { id: "customer-1" } }
};
const headers = {
  "content-type": "application/json",
  "x-dvar-principal-id": "user-1",
  "x-dvar-agent-id": "support-agent",
  "x-dvar-environment": "production"
};

const monitorRuntime = await createDvar({
  policy: { ...basePolicy, mode: "monitor" },
  lockfile
});
const monitorProxy = createMcpHttpProxy({ upstream: endpoint, serverId: "demo", runtime: monitorRuntime, inventory });
const monitorAddress = await monitorProxy.listen({ port: 0 });
await fetch(`http://127.0.0.1:${monitorAddress.port}`, {
  method: "POST",
  headers,
  body: JSON.stringify(call)
});
await monitorProxy.close();
console.log("monitor execution count", destructiveExecutions);

const enforceRuntime = await createDvar({
  policy: { ...basePolicy, mode: "enforce" },
  lockfile
});
const enforceProxy = createMcpHttpProxy({ upstream: endpoint, serverId: "demo", runtime: enforceRuntime, inventory });
const enforceAddress = await enforceProxy.listen({ port: 0 });
const denied = await fetch(`http://127.0.0.1:${enforceAddress.port}`, {
  method: "POST",
  headers,
  body: JSON.stringify(call)
}).then((response) => response.json());
await enforceProxy.close();
console.log("enforce response", denied.error.data.dvar);
console.log("enforce prevented second execution", destructiveExecutions === 1);

await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
