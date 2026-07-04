import { isAbsolute, resolve, sep } from "node:path";
import type {
  DvarExecutableIdentity,
  DvarStdioExecutablePolicy,
  DvarStdioFilesystemPolicy,
  DvarStdioPolicy,
  DvarStdioPolicyFailure,
  DvarStdioRunRequest
} from "./types.js";

function normalize(path: string): string {
  return resolve(path);
}

function within(path: string, root: string): boolean {
  const target = normalize(path);
  const base = normalize(root);
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

function pathLike(value: string): boolean {
  return value.startsWith("/")
    || value.startsWith("./")
    || value.startsWith("../")
    || value.includes(`${sep}`);
}

function matchAny(patterns: string[] | undefined, value: string): boolean {
  return (patterns ?? []).some((pattern) => new RegExp(pattern, "u").test(value));
}

function fail(reasonCode: string, message: string, executable?: DvarExecutableIdentity): DvarStdioPolicyFailure {
  return {
    ruleId: "stdio.policy",
    reasonCode,
    message,
    ...(executable !== undefined ? { executable } : {})
  };
}

function selectExecutablePolicy(
  policy: DvarStdioPolicy,
  executable: DvarExecutableIdentity
): DvarStdioExecutablePolicy | undefined {
  return (policy.executables ?? []).find((candidate) => {
    if (candidate.command !== undefined && candidate.command !== executable.command) return false;
    if (candidate.realpath !== undefined && candidate.realpath !== executable.realpath) return false;
    if (candidate.sha256 !== undefined && candidate.sha256 !== executable.sha256) return false;
    if (candidate.packageName !== undefined && candidate.packageName !== executable.packageName) return false;
    if (candidate.packageVersion !== undefined && candidate.packageVersion !== executable.packageVersion) return false;
    return true;
  });
}

function validateCwd(
  cwd: string,
  filesystem: DvarStdioFilesystemPolicy | undefined,
  localRoots: string[] | undefined,
  executable: DvarExecutableIdentity
): DvarStdioPolicyFailure | undefined {
  const roots = localRoots ?? filesystem?.cwdRoots;
  if ((roots?.length ?? 0) > 0 && !roots!.some((root) => within(cwd, root))) {
    return fail("stdio.cwd_outside_roots", `Working directory is outside allowed roots: ${cwd}`, executable);
  }
  if ((filesystem?.denyRoots?.length ?? 0) > 0 && filesystem!.denyRoots!.some((root) => within(cwd, root))) {
    return fail("stdio.cwd_denied", `Working directory is inside a denied root: ${cwd}`, executable);
  }
  return undefined;
}

function validatePathArgument(
  value: string,
  cwd: string,
  filesystem: DvarStdioFilesystemPolicy | undefined,
  executable: DvarExecutableIdentity
): DvarStdioPolicyFailure | undefined {
  if (!pathLike(value)) return undefined;
  const path = isAbsolute(value) ? value : resolve(cwd, value);
  if ((filesystem?.denyRoots?.length ?? 0) > 0 && filesystem!.denyRoots!.some((root) => within(path, root))) {
    return fail("stdio.path_argument_denied", `Path argument is inside a denied root: ${value}`, executable);
  }
  const roots = filesystem?.pathArgumentRoots ?? filesystem?.cwdRoots;
  if ((roots?.length ?? 0) > 0 && !roots!.some((root) => within(path, root))) {
    return fail("stdio.path_argument_outside_roots", `Path argument is outside allowed roots: ${value}`, executable);
  }
  return undefined;
}

function validateEnvironment(
  request: DvarStdioRunRequest,
  global: DvarStdioPolicy,
  local: DvarStdioExecutablePolicy | undefined,
  executable: DvarExecutableIdentity
): DvarStdioPolicyFailure | undefined {
  const env = request.env ?? {};
  const keys = Object.keys(env);
  const allowlist = local?.envAllowlist ?? global.envAllowlist;
  const denylist = local?.envDenylist ?? global.envDenylist;
  for (const key of keys) {
    if (key.includes("\0")) return fail("stdio.env_invalid", `Environment key contains NUL: ${key}`, executable);
    if ((denylist ?? []).includes(key)) return fail("stdio.env_denied", `Environment key is denied: ${key}`, executable);
    if (allowlist !== undefined && !allowlist.includes(key)) {
      return fail("stdio.env_not_allowed", `Environment key is not allowlisted: ${key}`, executable);
    }
  }
  return undefined;
}

export function evaluateStdioPolicy(
  policy: DvarStdioPolicy | undefined,
  request: DvarStdioRunRequest,
  executable: DvarExecutableIdentity
): { executablePolicy?: DvarStdioExecutablePolicy; failure?: DvarStdioPolicyFailure } {
  const effective = policy ?? {};
  if ((effective.allowShell as boolean | undefined) === true) {
    return { failure: fail("stdio.shell_not_supported", "Dvar stdio supervisor does not execute through a shell", executable) };
  }
  if ((effective.requireAbsoluteCommand ?? true) && !isAbsolute(request.command)) {
    return { failure: fail("stdio.command_not_absolute", `Command must be absolute: ${request.command}`, executable) };
  }
  const executablePolicy = selectExecutablePolicy(effective, executable);
  if ((effective.executables?.length ?? 0) > 0 && executablePolicy === undefined) {
    return { failure: fail("stdio.executable_not_allowed", `Executable is not allowed: ${executable.realpath}`, executable) };
  }

  const cwd = request.cwd ?? process.cwd();
  const cwdFailure = validateCwd(cwd, effective.filesystem, executablePolicy?.cwdRoots, executable);
  if (cwdFailure !== undefined) return { executablePolicy, failure: cwdFailure };

  const envFailure = validateEnvironment(request, effective, executablePolicy, executable);
  if (envFailure !== undefined) return { executablePolicy, failure: envFailure };

  const args = request.args ?? [];
  const argPolicy = executablePolicy?.args;
  if (argPolicy?.maxCount !== undefined && args.length > argPolicy.maxCount) {
    return { executablePolicy, failure: fail("stdio.args_too_many", `Too many command arguments: ${args.length}`, executable) };
  }
  for (const arg of args) {
    if (arg.includes("\0")) return { executablePolicy, failure: fail("stdio.arg_invalid", "Argument contains NUL", executable) };
    if (matchAny(argPolicy?.deny, arg)) {
      return { executablePolicy, failure: fail("stdio.arg_denied", `Argument denied by policy: ${arg}`, executable) };
    }
    if ((argPolicy?.allow?.length ?? 0) > 0 && !matchAny(argPolicy?.allow, arg)) {
      return { executablePolicy, failure: fail("stdio.arg_not_allowed", `Argument not allowed by policy: ${arg}`, executable) };
    }
    if (argPolicy?.validatePathArguments !== false) {
      const pathFailure = validatePathArgument(arg, cwd, effective.filesystem, executable);
      if (pathFailure !== undefined) return { executablePolicy, failure: pathFailure };
    }
  }

  return { executablePolicy };
}

export function stdioLimits(
  policy: DvarStdioPolicy | undefined,
  executablePolicy: DvarStdioExecutablePolicy | undefined,
  request: DvarStdioRunRequest
): { timeoutMs: number; maxOutputBytes: number } {
  const configuredTimeout = request.timeoutMs
    ?? executablePolicy?.timeoutMs
    ?? policy?.defaultTimeoutMs
    ?? 30_000;
  const maxTimeout = policy?.maxTimeoutMs ?? configuredTimeout;
  const timeoutMs = Math.min(Math.max(configuredTimeout, 1), Math.max(maxTimeout, 1));
  const maxOutputBytes = request.maxOutputBytes
    ?? executablePolicy?.maxOutputBytes
    ?? policy?.maxOutputBytes
    ?? 1_048_576;
  return { timeoutMs, maxOutputBytes: Math.max(maxOutputBytes, 1) };
}
