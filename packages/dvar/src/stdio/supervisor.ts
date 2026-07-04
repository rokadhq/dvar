import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DvarDeniedError } from "../errors.js";
import { sha256 } from "../canonical.js";
import { inspectExecutable } from "./inspect.js";
import { DvarStdioPolicyError } from "./errors.js";
import { evaluateStdioPolicy, stdioLimits } from "./policy.js";
import type {
  DvarExecutableIdentity,
  DvarStdioExecutionStatus,
  DvarStdioRunRequest,
  DvarStdioRunResult,
  DvarStdioSupervisor,
  DvarStdioSupervisorOptions
} from "./types.js";
import type { DvarAction, DvarDecision } from "../types.js";

function buildAction(request: DvarStdioRunRequest, executable: DvarExecutableIdentity): DvarAction {
  const envKeys = Object.keys(request.env ?? {}).sort();
  return {
    id: randomUUID(),
    principal: request.context.principal,
    agent: request.context.agent,
    ...(request.context.tenant !== undefined ? { tenant: request.context.tenant } : {}),
    ...(request.context.session !== undefined ? { session: request.context.session } : {}),
    ...(request.context.task !== undefined ? { task: request.context.task } : {}),
    environment: request.context.environment,
    server: {
      id: `stdio:${executable.realpath}`,
      transport: "stdio",
      endpoint: executable.realpath,
      integrity: {
        sha256: executable.sha256,
        ...(executable.packageName !== undefined ? { packageName: executable.packageName } : {}),
        ...(executable.packageVersion !== undefined ? { packageVersion: executable.packageVersion } : {}),
        ...(executable.packageLockIntegrity !== undefined ? { packageLockIntegrity: executable.packageLockIntegrity } : {})
      }
    },
    tool: {
      name: request.toolName ?? executable.packageName ?? executable.realpath,
      capabilities: request.capabilities ?? ["local.process"],
      schemaHash: sha256({ command: executable.realpath, args: request.args ?? [], envKeys })
    },
    arguments: {
      command: executable.realpath,
      args: request.args ?? [],
      cwd: request.cwd ?? process.cwd(),
      envKeys,
      stdinBytes: typeof request.stdin === "string"
        ? Buffer.byteLength(request.stdin)
        : request.stdin?.byteLength ?? 0
    },
    ...(request.context.resources !== undefined ? { resources: request.context.resources } : {}),
    ...(request.context.trace !== undefined ? { trace: request.context.trace } : {}),
    ...(request.context.metadata !== undefined ? { metadata: request.context.metadata } : {})
  };
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  maxBytes: number
): { bytes: number; exceeded: boolean } {
  const remaining = maxBytes - currentBytes;
  if (remaining <= 0) return { bytes: currentBytes, exceeded: true };
  if (chunk.byteLength > remaining) {
    chunks.push(chunk.subarray(0, remaining));
    return { bytes: maxBytes, exceeded: true };
  }
  chunks.push(chunk);
  return { bytes: currentBytes + chunk.byteLength, exceeded: false };
}

export function createStdioSupervisor(
  options: DvarStdioSupervisorOptions = {}
): DvarStdioSupervisor {
  return {
    inspect: inspectExecutable,

    async run(request: DvarStdioRunRequest): Promise<DvarStdioRunResult> {
      const executable = await inspectExecutable(request.command);
      const { executablePolicy, failure } = evaluateStdioPolicy(options.policy, request, executable);
      if (failure !== undefined) throw new DvarStdioPolicyError(failure);
      const limits = stdioLimits(options.policy, executablePolicy, request);
      const action = buildAction(request, executable);
      let decision: DvarDecision | undefined;
      if (options.runtime !== undefined) {
        decision = await options.runtime.authorize(action);
        if (decision.effect !== "allow") throw new DvarDeniedError(decision);
      }

      const startedAt = performance.now();
      let status: DvarStdioExecutionStatus = "completed";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      const child = spawn(request.command, request.args ?? [], {
        cwd: request.cwd,
        env: { ...process.env, ...(request.env ?? {}) },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });

      const timeout = setTimeout(() => {
        status = "timeout";
        child.kill("SIGTERM");
      }, limits.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        const result = appendBounded(stdout, chunk, stdoutBytes, limits.maxOutputBytes);
        stdoutBytes = result.bytes;
        if (result.exceeded && status === "completed") {
          status = "output_limit";
          child.kill("SIGTERM");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const result = appendBounded(stderr, chunk, stderrBytes, limits.maxOutputBytes);
        stderrBytes = result.bytes;
        if (result.exceeded && status === "completed") {
          status = "output_limit";
          child.kill("SIGTERM");
        }
      });

      if (request.stdin !== undefined) child.stdin.end(request.stdin);
      else child.stdin.end();

      const completion = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
      }).finally(() => clearTimeout(timeout));

      const durationMs = performance.now() - startedAt;
      if (options.runtime !== undefined) {
        await options.runtime.recordOutcome(action, {
          success: status === "completed" && completion.exitCode === 0,
          durationMs,
          ...(status !== "completed" ? { errorCode: status } : {})
        });
      }

      return {
        status,
        exitCode: completion.exitCode,
        signal: completion.signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs,
        executable,
        action,
        ...(decision !== undefined ? { decision } : {})
      };
    }
  };
}
