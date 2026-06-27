import { describe, expect, it } from "vitest";
import { sha256 } from "../src/canonical.js";
import { evaluatePolicy } from "../src/policy/engine.js";
import type { DvarAction, DvarPolicy } from "../src/types.js";

function action(overrides: Partial<DvarAction> = {}): DvarAction {
  return {
    id: "action-1",
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    tenant: { id: "tenant-a" },
    environment: "production",
    server: { id: "local", transport: "function" },
    tool: { name: "records.update", capabilities: ["data.update"] },
    arguments: { amount: 5000 },
    resources: [{ type: "record", id: "r-1", tenantId: "tenant-a" }],
    ...overrides
  };
}

function policy(overrides: Partial<DvarPolicy> = {}): DvarPolicy {
  return {
    schemaVersion: "1",
    version: "test",
    mode: "enforce",
    defaultEffect: "deny",
    identity: { require: ["principal.id", "agent.id", "environment"] },
    rules: [],
    ...overrides
  };
}

describe("evaluatePolicy", () => {
  it("lets explicit denies override matching allows regardless of priority", () => {
    const input = policy({
      rules: [
        { id: "high-priority-allow", priority: 1000, effect: "allow", when: { "tool.name": "records.update" } },
        { id: "deny-production", priority: 1, effect: "deny", when: { environment: "production" } }
      ]
    });

    const decision = evaluatePolicy(input, sha256(input), action());
    expect(decision.effect).toBe("deny");
    expect(decision.ruleId).toBe("deny-production");
    expect(decision.reasonCode).toBe("policy.explicit_deny");
  });

  it("lets approval requirements override ordinary allows", () => {
    const input = policy({
      rules: [
        { id: "allow-updates", priority: 100, effect: "allow", when: { "tool.name": "records.update" } },
        {
          id: "approve-large-update",
          priority: 10,
          effect: "require_approval",
          when: { "arguments.amount": { greaterThan: 1000 } },
          approval: { provider: "webhook", expiresInSeconds: 300 }
        }
      ]
    });

    const decision = evaluatePolicy(input, sha256(input), action());
    expect(decision.effect).toBe("require_approval");
    expect(decision.ruleId).toBe("approve-large-update");
  });

  it("uses priority and stable rule id ordering within one effect", () => {
    const input = policy({
      rules: [
        { id: "z-rule", priority: 100, effect: "allow" },
        { id: "a-rule", priority: 100, effect: "allow" }
      ]
    });
    const decision = evaluatePolicy(input, sha256(input), action());
    expect(decision.ruleId).toBe("a-rule");
  });

  it("evaluates context equality constraints", () => {
    const input = policy({
      rules: [{
        id: "same-tenant",
        effect: "allow",
        when: { "tool.name": "records.update" },
        constraints: { "resources.0.tenantId": { equalsContext: "tenant.id" } }
      }]
    });
    const decision = evaluatePolicy(input, sha256(input), action());
    expect(decision.effect).toBe("allow");
    expect(decision.ruleId).toBe("same-tenant");
  });

  it("keeps the enforcement result visible in monitor mode while allowing execution", () => {
    const input = policy({ mode: "monitor", rules: [] });
    const decision = evaluatePolicy(input, sha256(input), action());
    expect(decision.effect).toBe("allow");
    expect(decision.observedEffect).toBe("would_deny");
    expect(decision.ruleId).toBe("policy.default");
  });

  it("denies missing required context with a distinct reason", () => {
    const input = policy();
    const malformed = action({ principal: { id: "", type: "user" } });
    const decision = evaluatePolicy(input, sha256(input), malformed);
    expect(decision.effect).toBe("deny");
    expect(decision.ruleId).toBe("system.required_context");
    expect(decision.reasonCode).toBe("identity.missing");
  });
});
