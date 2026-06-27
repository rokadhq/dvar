import { describe, expect, it } from "vitest";
import {
  createDvar,
  createInventory,
  createServerInventory,
  inventoryToLockfile,
  validatePolicy
} from "../src/index.js";
import type { DvarAction, DvarPolicy } from "../src/types.js";

const server = createServerInventory({
  id: "crm",
  endpoint: "https://mcp.example.test/mcp",
  tools: [{
    name: "customers.search",
    description: "Search customers",
    inputSchema: { type: "object", properties: { query: { type: "string" } } }
  }]
});
const lockfile = inventoryToLockfile(createInventory([server]));
const lockedTool = server.tools[0]!;

function action(overrides: Partial<DvarAction> = {}): DvarAction {
  return {
    id: "action-1",
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    environment: "production",
    server: { id: "crm", transport: "streamable-http", endpoint: "https://mcp.example.test/mcp" },
    tool: {
      name: "customers.search",
      capabilities: lockedTool.capabilities,
      schemaHash: lockedTool.inputSchemaSha256,
      descriptionHash: lockedTool.descriptionSha256,
      annotationsHash: lockedTool.annotationsSha256
    },
    arguments: { query: "alice" },
    ...overrides
  };
}

function policy(mode: DvarPolicy["mode"] = "enforce"): DvarPolicy {
  return {
    schemaVersion: "1",
    mode,
    defaultEffect: "allow",
    integrity: {
      requireLockfile: true,
      onUnknownServer: "deny",
      onUnknownTool: "require_approval",
      onDescriptionChange: "require_approval",
      onSchemaChange: "deny",
      onCapabilityExpansion: "deny"
    }
  };
}

describe("lockfile integrity enforcement", () => {
  it("accepts integrity policy in schema version 1", () => {
    expect(validatePolicy(policy()).integrity?.onUnknownTool).toBe("require_approval");
  });

  it("denies when policy requires a lockfile and none is loaded", async () => {
    const runtime = await createDvar({ policy: policy() });
    const decision = await runtime.evaluate(action());
    expect(decision).toMatchObject({
      effect: "deny",
      reasonCode: "tool.lockfile_missing",
      ruleId: "system.lockfile_required"
    });
  });

  it("requires approval for an unknown tool", async () => {
    const runtime = await createDvar({ policy: policy(), lockfile });
    const decision = await runtime.evaluate(action({ tool: { name: "customers.export", capabilities: ["data.export"] } }));
    expect(decision).toMatchObject({ effect: "require_approval", reasonCode: "tool.unlocked" });
  });

  it("denies schema changes before ordinary allow policy", async () => {
    const runtime = await createDvar({ policy: policy(), lockfile });
    const decision = await runtime.evaluate(action({
      tool: { ...action().tool, schemaHash: "changed" }
    }));
    expect(decision).toMatchObject({ effect: "deny", reasonCode: "tool.schema_changed" });
  });

  it("preserves the integrity effect in monitor mode", async () => {
    const runtime = await createDvar({ policy: policy("monitor"), lockfile });
    const decision = await runtime.evaluate(action({ tool: { name: "new.tool", capabilities: [] } }));
    expect(decision).toMatchObject({ effect: "allow", observedEffect: "would_require_approval" });
  });

  it("denies unknown servers and changed endpoints", async () => {
    const runtime = await createDvar({ policy: policy(), lockfile });
    await expect(runtime.evaluate(action({
      server: { id: "unknown", transport: "streamable-http", endpoint: "https://unknown.example.test/mcp" }
    }))).resolves.toMatchObject({ effect: "deny", reasonCode: "tool.unknown_server" });
    await expect(runtime.evaluate(action({
      server: { id: "crm", transport: "streamable-http", endpoint: "https://other.example.test/mcp" }
    }))).resolves.toMatchObject({ effect: "deny", reasonCode: "destination.changed" });
  });

  it("applies description, annotation, and capability expansion policies", async () => {
    const runtime = await createDvar({ policy: policy(), lockfile });
    await expect(runtime.evaluate(action({
      tool: { ...action().tool, descriptionHash: "changed" }
    }))).resolves.toMatchObject({ effect: "require_approval", reasonCode: "tool.description_changed" });
    await expect(runtime.evaluate(action({
      tool: { ...action().tool, annotationsHash: "changed" }
    }))).resolves.toMatchObject({ effect: "require_approval", reasonCode: "tool.annotations_changed" });
    await expect(runtime.evaluate(action({
      tool: { ...action().tool, capabilities: [...lockedTool.capabilities, "data.export"] }
    }))).resolves.toMatchObject({ effect: "deny", reasonCode: "tool.capability_expanded" });
  });

  it("allows an action that exactly matches the reviewed lockfile", async () => {
    const runtime = await createDvar({ policy: policy(), lockfile });
    await expect(runtime.evaluate(action())).resolves.toMatchObject({ effect: "allow" });
    expect(runtime.lockedTool("crm", "customers.search")?.name).toBe("customers.search");
  });

  it("defaults integrity failures to deny in strict mode", async () => {
    const strictPolicy: DvarPolicy = {
      schemaVersion: "1",
      mode: "strict",
      defaultEffect: "allow",
      integrity: { requireLockfile: true }
    };
    const runtime = await createDvar({ policy: strictPolicy, lockfile });
    await expect(runtime.evaluate(action({
      tool: { name: "unreviewed.tool", capabilities: [] }
    }))).resolves.toMatchObject({ effect: "deny", reasonCode: "tool.unlocked" });
  });
});
