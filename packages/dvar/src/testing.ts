import { randomUUID } from "node:crypto";
import { expandDottedObject } from "./object-path.js";
import { createDvar } from "./runtime.js";
import type { DvarAction, DvarLockfile, DvarPolicy, DvarPolicyTestResult } from "./types.js";

function fixtureAction(input: Record<string, unknown>): DvarAction {
  const expanded = expandDottedObject(input);
  return {
    id: typeof expanded.id === "string" ? expanded.id : randomUUID(),
    principal: (expanded.principal as DvarAction["principal"] | undefined) ?? { id: "test-principal", type: "user" },
    agent: (expanded.agent as DvarAction["agent"] | undefined) ?? { id: "test-agent" },
    environment: typeof expanded.environment === "string" ? expanded.environment : "test",
    server: (expanded.server as DvarAction["server"] | undefined) ?? { id: "test-server", transport: "function" },
    tool: (expanded.tool as DvarAction["tool"] | undefined) ?? { name: "test.tool", capabilities: [] },
    arguments: expanded.arguments ?? {},
    ...(expanded.tenant !== undefined ? { tenant: expanded.tenant as NonNullable<DvarAction["tenant"]> } : {}),
    ...(expanded.session !== undefined ? { session: expanded.session as NonNullable<DvarAction["session"]> } : {}),
    ...(expanded.task !== undefined ? { task: expanded.task as NonNullable<DvarAction["task"]> } : {}),
    ...(expanded.resources !== undefined ? { resources: expanded.resources as NonNullable<DvarAction["resources"]> } : {}),
    ...(expanded.destination !== undefined ? { destination: expanded.destination as NonNullable<DvarAction["destination"]> } : {}),
    ...(expanded.trace !== undefined ? { trace: expanded.trace as NonNullable<DvarAction["trace"]> } : {}),
    ...(expanded.metadata !== undefined ? { metadata: expanded.metadata as NonNullable<DvarAction["metadata"]> } : {})
  };
}

export interface DvarPolicyTestOptions {
  lockfile?: DvarLockfile;
}

export async function runPolicyTests(
  policy: DvarPolicy,
  options: DvarPolicyTestOptions = {}
): Promise<DvarPolicyTestResult[]> {
  const enforcedPolicy: DvarPolicy = { ...policy, mode: "enforce" };
  const runtime = await createDvar({
    policy: enforcedPolicy,
    ...(options.lockfile !== undefined ? { lockfile: options.lockfile } : {})
  });
  const results: DvarPolicyTestResult[] = [];

  for (const test of policy.tests ?? []) {
    try {
      const decision = await runtime.evaluate(fixtureAction(test.action));
      const passed = decision.effect === test.expect.effect
        && (test.expect.ruleId === undefined || decision.ruleId === test.expect.ruleId)
        && (test.expect.reasonCode === undefined || decision.reasonCode === test.expect.reasonCode);
      results.push({ name: test.name, passed, expected: test.expect, decision });
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        expected: test.expect,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}
