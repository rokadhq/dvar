import { describe, expect, it } from "vitest";
import { DvarConfigurationError, runPolicyTests, validatePolicy } from "../src/index.js";
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
});
