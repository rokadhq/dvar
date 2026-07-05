import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DvarDeniedError,
  DvarStdioPolicyError,
  createDvar,
  createStdioSupervisor
} from "../src/index.js";
import type { DvarStdioRunContext } from "../src/stdio/index.js";

async function temp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dvar-stdio-"));
}

function context(): DvarStdioRunContext {
  return {
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    tenant: { id: "tenant-1" },
    task: { id: "task-1" },
    environment: "test"
  };
}

async function nodeSupervisor(cwd: string) {
  const base = createStdioSupervisor();
  const identity = await base.inspect(process.execPath);
  return createStdioSupervisor({
    policy: {
      maxTimeoutMs: 5_000,
      maxOutputBytes: 1024,
      filesystem: {
        cwdRoots: [cwd],
        pathArgumentRoots: [cwd]
      },
      envAllowlist: ["SAFE"],
      executables: [{
        id: "node",
        realpath: identity.realpath,
        sha256: identity.sha256,
        args: {
          maxCount: 4,
          deny: ["--inspect", "--eval=.*secret"],
          validatePathArguments: true
        }
      }]
    }
  });
}

describe("stdio supervisor", () => {
  it("executes an allowed absolute command without using a shell", async () => {
    const cwd = await temp();
    const supervisor = await nodeSupervisor(cwd);
    const result = await supervisor.run({
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
      cwd,
      env: { SAFE: "1" },
      context: context()
    });
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.action.server.transport).toBe("stdio");
    expect(result.action.server.integrity?.sha256).toBe(result.executable.sha256);
    expect(JSON.stringify(result.action.arguments)).not.toContain("SAFE=1");
  });

  it("blocks unallowlisted environment and path arguments outside roots", async () => {
    const cwd = await temp();
    const supervisor = await nodeSupervisor(cwd);
    await expect(supervisor.run({
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
      cwd,
      env: { SECRET: "nope" },
      context: context()
    })).rejects.toMatchObject({ code: "stdio.env_not_allowed" });

    await expect(supervisor.run({
      command: process.execPath,
      args: ["-e", "console.log('/etc/passwd')", "/etc/passwd"],
      cwd,
      context: context()
    })).rejects.toBeInstanceOf(DvarStdioPolicyError);
  });

  it("enforces process timeouts and output caps", async () => {
    const cwd = await temp();
    const supervisor = await nodeSupervisor(cwd);
    const timeout = await supervisor.run({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd,
      timeoutMs: 50,
      context: context()
    });
    expect(timeout.status).toBe("timeout");

    const output = await supervisor.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(10000))"],
      cwd,
      maxOutputBytes: 16,
      context: context()
    });
    expect(output.status).toBe("output_limit");
    expect(Buffer.byteLength(output.stdout)).toBe(16);
  });

  it("authorizes through Dvar runtime before local execution", async () => {
    const cwd = await temp();
    const base = createStdioSupervisor();
    const identity = await base.inspect(process.execPath);
    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "allow",
        runtime: { maxToolCallsPerTask: 1 }
      }
    });
    const supervisor = createStdioSupervisor({
      runtime,
      policy: {
        filesystem: { cwdRoots: [cwd] },
        executables: [{ id: "node", sha256: identity.sha256 }]
      }
    });
    await expect(supervisor.run({
      command: process.execPath,
      args: ["-e", "console.log('first')"],
      cwd,
      context: context()
    })).resolves.toMatchObject({ status: "completed" });
    await expect(supervisor.run({
      command: process.execPath,
      args: ["-e", "console.log('second')"],
      cwd,
      context: context()
    })).rejects.toBeInstanceOf(DvarDeniedError);
  });

  it("discovers local package metadata for executable identity", async () => {
    const cwd = await temp();
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      name: "local-tool",
      version: "1.2.3"
    }));
    const executable = join(cwd, "tool.js");
    await writeFile(executable, "#!/usr/bin/env node\nconsole.log('tool')\n");
    const identity = await createStdioSupervisor().inspect(executable);
    expect(identity.packageName).toBe("local-tool");
    expect(identity.packageVersion).toBe("1.2.3");
    expect(identity.sha256).toHaveLength(64);
  });
});
