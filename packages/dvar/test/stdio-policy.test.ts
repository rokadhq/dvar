import { describe, expect, it } from "vitest";
import { inspectExecutable } from "../src/stdio/index.js";
import { evaluateStdioPolicy } from "../src/stdio/policy.js";
import type { DvarStdioRunContext } from "../src/stdio/index.js";

function context(): DvarStdioRunContext {
  return {
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    environment: "test"
  };
}

describe("stdio policy evaluator", () => {
  it("requires absolute commands by default", async () => {
    const executable = await inspectExecutable(process.execPath);
    const result = evaluateStdioPolicy({}, {
      command: "node",
      context: context()
    }, executable);
    expect(result.failure).toMatchObject({ reasonCode: "stdio.command_not_absolute" });
  });

  it("matches executables by hash and package identity", async () => {
    const executable = await inspectExecutable(process.execPath);
    const allowed = evaluateStdioPolicy({
      executables: [{ id: "node", sha256: executable.sha256 }]
    }, {
      command: process.execPath,
      context: context()
    }, executable);
    expect(allowed.failure).toBeUndefined();

    const denied = evaluateStdioPolicy({
      executables: [{ id: "other", sha256: "0".repeat(64) }]
    }, {
      command: process.execPath,
      context: context()
    }, executable);
    expect(denied.failure).toMatchObject({ reasonCode: "stdio.executable_not_allowed" });
  });
});
