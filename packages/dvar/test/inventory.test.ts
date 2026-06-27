import { describe, expect, it } from "vitest";
import {
  createInventory,
  createServerInventory,
  diffInventory,
  inferToolCapabilities,
  inventoryToLockfile
} from "../src/index.js";
import type { DvarMcpToolDefinition } from "../src/types.js";

function tool(overrides: Partial<DvarMcpToolDefinition> = {}): DvarMcpToolDefinition {
  return {
    name: "customers.search",
    description: "Search customer records",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    ...overrides
  };
}

describe("MCP inventory", () => {
  it("infers portable capabilities from tool definitions and untrusted hints", () => {
    expect(inferToolCapabilities(tool())).toContain("data.search");
    expect(inferToolCapabilities(tool({
      name: "billing.refund_payment",
      description: "Refund a settled payment",
      annotations: { destructiveHint: true }
    }))).toEqual(expect.arrayContaining(["finance.refund", "data.delete"]));
  });

  it("canonicalizes tool order and produces a stable manifest", () => {
    const first = createServerInventory({
      id: "crm",
      endpoint: "https://mcp.example.test/mcp",
      tools: [tool({ name: "z.list" }), tool({ name: "a.list" })]
    });
    const second = createServerInventory({
      id: "crm",
      endpoint: "https://mcp.example.test/mcp",
      tools: [tool({ name: "a.list" }), tool({ name: "z.list" })]
    });
    expect(first.tools.map((item) => item.name)).toEqual(["a.list", "z.list"]);
    expect(first.integrity.manifestSha256).toBe(second.integrity.manifestSha256);
  });

  it("classifies schema widening, capability expansion, and newly added tools", () => {
    const lockedServer = createServerInventory({
      id: "crm",
      endpoint: "https://mcp.example.test/mcp",
      tools: [tool()]
    });
    const observedServer = createServerInventory({
      id: "crm",
      endpoint: "https://mcp.example.test/mcp",
      tools: [
        tool({
          inputSchema: {
            type: "object",
            additionalProperties: true,
            properties: {
              query: { type: "string" },
              includeDeleted: { type: "boolean" }
            }
          }
        }),
        tool({ name: "customers.delete", description: "Delete a customer" })
      ],
      classifications: {
        "customers.search": ["data.search", "data.export"]
      }
    });
    const diff = diffInventory(
      inventoryToLockfile(createInventory([lockedServer], "2026-06-27T00:00:00.000Z")),
      createInventory([observedServer], "2026-06-27T00:01:00.000Z")
    );
    expect(diff.clean).toBe(false);
    expect(diff.highestRisk).toBe("critical");
    expect(diff.changes.map((change) => change.type)).toEqual(expect.arrayContaining([
      "tool.input_schema_widened",
      "tool.capability_expanded",
      "tool.added"
    ]));
  });

  it("detects endpoint changes as critical", () => {
    const locked = createInventory([createServerInventory({
      id: "crm",
      endpoint: "https://one.example.test/mcp",
      tools: [tool()]
    })]);
    const observed = createInventory([createServerInventory({
      id: "crm",
      endpoint: "https://two.example.test/mcp",
      tools: [tool()]
    })]);
    const diff = diffInventory(inventoryToLockfile(locked), observed);
    expect(diff.changes[0]).toMatchObject({ type: "server.endpoint_changed", risk: "critical" });
  });
});
