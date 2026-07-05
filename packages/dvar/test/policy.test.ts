import { describe, expect, it } from "vitest";
import { DvarConfigurationError, runPolicyTests, validatePolicy } from "../src/index.js";
import { createInventory, createServerInventory, inventoryToLockfile } from "../src/inventory.js";
import type { DvarPolicy } from "../src/types.js";

describe("policy validation and tests", () => {
  it("rejects duplicate rule ids", () => {
    expect(() => validatePolicy({
      schemaVersion: "1",
      mode: "enforce",
      defaultEffect: "deny",
      rules: [
        { id: "duplicate", effect: "allow" },
        { id: "duplicate", effect: "deny" }
      ]
    })).toThrow(DvarConfigurationError);
  });

  it("rejects approval rules without an approval contract", () => {
    expect(() => validatePolicy({
      schemaVersion: "1",
      mode: "enforce",
      defaultEffect: "deny",
      rules: [{ id: "approval", effect: "require_approval" }]
    })).toThrow(/semantic validation/u);
  });

  it("runs embedded tests in enforce mode even when onboarding policy is monitor", async () => {
    const policy: DvarPolicy = {
      schemaVersion: "1",
      mode: "monitor",
      defaultEffect: "deny",
      rules: [{ id: "allow-read", effect: "allow", when: { "tool.name": "records.read" } }],
      tests: [
        {
          name: "allow read",
          action: { "tool.name": "records.read" },
          expect: { effect: "allow", ruleId: "allow-read" }
        },
        {
          name: "deny write",
          action: { "tool.name": "records.write" },
          expect: { effect: "deny", ruleId: "policy.default" }
        }
      ]
    };

    const results = await runPolicyTests(policy);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it("accepts an explicit lockfile for integrity-aware policy tests", async () => {
    const server = createServerInventory({
      id: "test-server",
      endpoint: "https://mcp.example.test/mcp",
      tools: [{
        name: "records.read",
        description: "Read records",
        inputSchema: { type: "object" }
      }]
    });
    const lockfile = inventoryToLockfile(createInventory([server]));
    const tool = lockfile.servers[0]?.tools[0];
    expect(tool).toBeDefined();
    const policy: DvarPolicy = {
      schemaVersion: "1",
      mode: "monitor",
      defaultEffect: "deny",
      integrity: { requireLockfile: true, onUnknownTool: "deny", onSchemaChange: "deny" },
      rules: [{ id: "allow-read", effect: "allow", when: { "tool.name": "records.read" } }],
      tests: [{
        name: "locked read",
        action: {
          "server.id": "test-server",
          "server.endpoint": "https://mcp.example.test/mcp",
          "tool.name": "records.read",
          "tool.schemaHash": tool?.inputSchemaSha256
        },
        expect: { effect: "allow", ruleId: "allow-read" }
      }]
    };

    const results = await runPolicyTests(policy, { lockfile });
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
  });
});
