import { randomUUID } from "node:crypto";
import { DvarError } from "../errors.js";
import { getPath } from "../object-path.js";
import { sha256 } from "../canonical.js";
import type {
  DvarAction,
  DvarApprovalPolicy,
  DvarApprovalRequest,
  DvarApprovalScope,
  DvarDecision,
  DvarPolicy
} from "../types.js";

const DEFAULT_EXPIRY_SECONDS = 300;
const MAX_EXPIRY_SECONDS = 86_400;
const DEFAULT_BINDINGS = [
  "principal.id",
  "agent.id",
  "tenant.id",
  "environment",
  "server.id",
  "server.endpoint",
  "tool.name",
  "arguments",
  "resources",
  "destination"
];

export class DvarApprovalRequestError extends DvarError {
  public constructor(message: string, reasonCode: string, options?: ErrorOptions) {
    super(message, reasonCode, options);
  }
}

function approvalPolicy(policy: DvarPolicy, decision: DvarDecision): DvarApprovalPolicy {
  return policy.rules?.find((rule) => rule.id === decision.ruleId)?.approval ?? {};
}

function requiredScopePath(scope: DvarApprovalScope): string | undefined {
  if (scope === "session") return "session.id";
  if (scope === "task") return "task.id";
  return undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function approvalBindingPaths(
  scope: DvarApprovalScope,
  configured: string[] | undefined
): string[] {
  const mandatory = ["principal.id", "agent.id", "environment", "server.id", "tool.name"];
  const scopePath = requiredScopePath(scope);
  if (scopePath !== undefined) mandatory.push(scopePath);
  if (scope === "once") mandatory.push("$actionHash");
  return uniqueSorted([...mandatory, ...(configured ?? DEFAULT_BINDINGS)]);
}

export function approvalBindings(
  action: DvarAction,
  actionHash: string,
  paths: string[]
): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [
    path,
    sha256(path === "$actionHash" ? actionHash : (getPath(action, path) ?? null))
  ]));
}


export function approvalActionHash(action: DvarAction): string {
  return sha256({
    principal: action.principal,
    agent: action.agent,
    tenant: action.tenant ?? null,
    session: action.session ?? null,
    task: action.task ?? null,
    environment: action.environment,
    server: action.server,
    tool: action.tool,
    arguments: action.arguments,
    resources: action.resources ?? null,
    destination: action.destination ?? null
  });
}

export interface CreateApprovalRequestOptions {
  provider?: string;
  now?: Date;
}

export function createApprovalRequest(
  policy: DvarPolicy,
  action: DvarAction,
  decision: DvarDecision,
  options: CreateApprovalRequestOptions = {}
): DvarApprovalRequest {
  const config = approvalPolicy(policy, decision);
  const scope = config.scope ?? "once";
  const scopePath = requiredScopePath(scope);
  if (scopePath !== undefined && getPath(action, scopePath) === undefined) {
    throw new DvarApprovalRequestError(
      `Approval scope ${scope} requires ${scopePath}`,
      "approval.scope_context_missing"
    );
  }
  const now = options.now ?? new Date();
  const expiresInSeconds = Math.min(
    Math.max(config.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS, 1),
    MAX_EXPIRY_SECONDS
  );
  const maxUses = scope === "once" ? 1 : Math.max(config.maxUses ?? 1, 1);
  const bind = approvalBindingPaths(scope, config.bind);
  const stableActionHash = approvalActionHash(action);
  const argumentsHash = sha256(action.arguments);
  const resourcesHash = action.resources === undefined ? undefined : sha256(action.resources);
  const destinationHash = action.destination === undefined ? undefined : sha256(action.destination);
  return {
    version: "1",
    id: randomUUID(),
    actionId: action.id,
    decisionId: decision.id,
    actionHash: stableActionHash,
    policyHash: decision.policyHash,
    policyVersion: decision.policyVersion,
    ruleId: decision.ruleId,
    provider: config.provider ?? options.provider ?? "manual",
    scope,
    bind,
    bindings: approvalBindings(action, stableActionHash, bind),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    maxUses,
    principal: action.principal,
    agent: action.agent,
    ...(action.tenant !== undefined ? { tenant: action.tenant } : {}),
    ...(action.session !== undefined ? { session: action.session } : {}),
    ...(action.task !== undefined ? { task: action.task } : {}),
    environment: action.environment,
    server: action.server,
    tool: action.tool,
    arguments: action.arguments,
    argumentsHash,
    ...(action.resources !== undefined ? { resources: action.resources } : {}),
    ...(resourcesHash !== undefined ? { resourcesHash } : {}),
    ...(action.destination !== undefined ? { destination: action.destination } : {}),
    ...(destinationHash !== undefined ? { destinationHash } : {}),
    summary: `Agent ${action.agent.id} requests ${action.tool.name} on ${action.server.id} in ${action.environment}`,
    ...(typeof action.tool.annotations?.destructiveHint === "boolean"
      ? { reversible: action.tool.annotations.destructiveHint !== true }
      : {}),
    risk: decision.risk
  };
}
