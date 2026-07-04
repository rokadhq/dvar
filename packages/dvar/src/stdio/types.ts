import type {
  DvarAction,
  DvarAgent,
  DvarDecision,
  DvarEventSink,
  DvarPrincipal,
  DvarResource
} from "../types.js";
import type { DvarRuntimeOutcome } from "../runtime-safety/index.js";

export type DvarStdioViolationAction = "deny" | "allow";
export type DvarStdioExecutionStatus = "completed" | "timeout" | "output_limit";

export interface DvarStdioArgumentPolicy {
  maxCount?: number;
  allow?: string[];
  deny?: string[];
  validatePathArguments?: boolean;
}

export interface DvarStdioFilesystemPolicy {
  cwdRoots?: string[];
  pathArgumentRoots?: string[];
  denyRoots?: string[];
}

export interface DvarStdioExecutablePolicy {
  id: string;
  command?: string;
  realpath?: string;
  sha256?: string;
  packageName?: string;
  packageVersion?: string;
  args?: DvarStdioArgumentPolicy;
  envAllowlist?: string[];
  envDenylist?: string[];
  cwdRoots?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface DvarStdioPolicy {
  onViolation?: DvarStdioViolationAction;
  requireAbsoluteCommand?: boolean;
  allowShell?: false;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  envAllowlist?: string[];
  envDenylist?: string[];
  filesystem?: DvarStdioFilesystemPolicy;
  executables?: DvarStdioExecutablePolicy[];
}

export interface DvarPackageIntegrity {
  packageJsonPath?: string;
  packageName?: string;
  packageVersion?: string;
  packageLockPath?: string;
  packageLockIntegrity?: string;
}

export interface DvarExecutableIdentity extends DvarPackageIntegrity {
  command: string;
  realpath: string;
  sha256: string;
  sizeBytes: number;
  mode: number;
  mtimeMs: number;
}

export interface DvarStdioRunContext {
  principal: DvarPrincipal;
  agent: DvarAgent;
  environment: string;
  tenant?: { id: string };
  session?: { id: string };
  task?: { id: string; purpose?: string };
  resources?: DvarResource[];
  trace?: DvarAction["trace"];
  metadata?: Record<string, unknown>;
}

export interface DvarStdioRunRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
  maxOutputBytes?: number;
  toolName?: string;
  capabilities?: string[];
  context: DvarStdioRunContext;
}

export interface DvarStdioRunResult {
  status: DvarStdioExecutionStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  executable: DvarExecutableIdentity;
  action: DvarAction;
  decision?: DvarDecision;
}

export interface DvarStdioSupervisorOptions {
  policy?: DvarStdioPolicy;
  runtime?: {
    authorize(action: DvarAction): Promise<DvarDecision>;
    recordOutcome(action: DvarAction, outcome: DvarRuntimeOutcome): Promise<void>;
  };
  eventSink?: DvarEventSink;
  clock?: () => number;
}

export interface DvarStdioSupervisor {
  inspect(command: string): Promise<DvarExecutableIdentity>;
  run(request: DvarStdioRunRequest): Promise<DvarStdioRunResult>;
}

export interface DvarStdioPolicyFailure {
  ruleId: string;
  reasonCode: string;
  message: string;
  executable?: DvarExecutableIdentity;
}
