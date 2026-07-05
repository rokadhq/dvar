export type DvarMode = "off" | "monitor" | "enforce" | "strict";
export type DvarEffect = "allow" | "deny" | "require_approval";
export type DvarObservedEffect =
  | "would_allow"
  | "would_deny"
  | "would_require_approval";
export type DvarRiskLevel =
  | "informational"
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface DvarPrincipal {
  id: string;
  type: "user" | "service" | "workload" | "agent";
  roles?: string[];
  claims?: Record<string, unknown>;
}

export interface DvarAgent {
  id: string;
  version?: string;
  framework?: string;
  modelProvider?: string;
  model?: string;
}

export interface DvarResource {
  type: string;
  id?: string;
  ownerId?: string;
  tenantId?: string;
  classification?: string;
}

export interface DvarAction {
  id: string;
  principal: DvarPrincipal;
  agent: DvarAgent;
  tenant?: { id: string };
  session?: { id: string };
  task?: { id: string; purpose?: string };
  environment: string;
  server: {
    id: string;
    transport?: "function" | "streamable-http" | "stdio" | "custom";
    endpoint?: string;
    integrity?: Record<string, string>;
  };
  tool: {
    name: string;
    namespace?: string;
    capabilities?: string[];
    annotations?: Record<string, unknown>;
    schemaHash?: string;
    outputSchemaHash?: string;
    descriptionHash?: string;
    annotationsHash?: string;
  };
  arguments: unknown;
  resources?: DvarResource[];
  destination?: { type: string; value: string };
  trace?: {
    traceId?: string;
    spanId?: string;
    parentActionId?: string;
    depth?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface DvarRisk {
  level: DvarRiskLevel;
  score: number;
  signals: string[];
}

export interface DvarObligation {
  type: string;
  config?: Record<string, unknown>;
}

export type DvarApprovalScope = "once" | "session" | "task";
export type DvarApprovalStatus =
  | "required"
  | "pending"
  | "accepted"
  | "rejected"
  | "invalid"
  | "provider_error";

export interface DvarApprovalSummary {
  status: DvarApprovalStatus;
  requestId?: string;
  grantId?: string;
  scope?: DvarApprovalScope;
  approverId?: string;
  provider?: string;
  reason?: string;
}

export interface DvarDecision {
  id: string;
  effect: DvarEffect;
  observedEffect?: DvarObservedEffect;
  mode: DvarMode;
  ruleId: string;
  reasonCode: string;
  message: string;
  risk: DvarRisk;
  obligations: DvarObligation[];
  policyVersion: string;
  policyHash: string;
  actionHash: string;
  evaluatedAt: string;
  durationMs: number;
  approvalRequest?: DvarApprovalRequest;
  approval?: DvarApprovalSummary;
}

export type Primitive = string | number | boolean | null;

export interface DvarMatcher {
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
  notIn?: unknown[];
  containsAny?: unknown[];
  containsAll?: unknown[];
  exists?: boolean;
  greaterThan?: number;
  greaterThanOrEqual?: number;
  lessThan?: number;
  lessThanOrEqual?: number;
  prefix?: string;
  suffix?: string;
  matches?: string;
  equalsContext?: string;
}

export type DvarMatchValue = Primitive | Primitive[] | DvarMatcher;

export interface DvarApprovalPolicy {
  provider?: string;
  expiresInSeconds?: number;
  bind?: string[];
  scope?: DvarApprovalScope;
  maxUses?: number;
}

export interface DvarRule {
  id: string;
  priority?: number;
  effect: DvarEffect;
  when?: Record<string, DvarMatchValue>;
  constraints?: Record<string, DvarMatchValue>;
  obligations?: DvarObligation[];
  approval?: DvarApprovalPolicy;
  message?: string;
}

export interface DvarIntegrityPolicy {
  requireLockfile?: boolean;
  onUnknownServer?: DvarEffect;
  onUnknownTool?: DvarEffect;
  onDescriptionChange?: DvarEffect;
  onSchemaChange?: DvarEffect;
  onCapabilityExpansion?: DvarEffect;
}

export interface DvarRuntimePolicy {
  onEvaluationError?: "allow" | "deny";
  onDecisionTimeout?: "allow" | "deny";
  onOutputFilterError?: "allow" | "deny";
  onTelemetryError?: "continue" | "deny";
  onApprovalProviderError?: "allow" | "deny";
  maxDecisionMs?: number;
  maxToolCallsPerTask?: number;
  maxDepth?: number;
}

export interface DvarPolicyTest {
  name: string;
  action: Record<string, unknown>;
  expect: {
    effect: DvarEffect;
    ruleId?: string;
    reasonCode?: string;
  };
}

export interface DvarPolicy {
  schemaVersion: "1";
  version?: string;
  mode: DvarMode;
  defaultEffect: DvarEffect;
  runtime?: DvarRuntimePolicy;
  identity?: { require?: string[] };
  integrity?: DvarIntegrityPolicy;
  rules?: DvarRule[];
  tests?: DvarPolicyTest[];
}

export interface DvarApprovalRequest {
  version: "1";
  id: string;
  actionId: string;
  decisionId: string;
  actionHash: string;
  policyHash: string;
  policyVersion: string;
  ruleId: string;
  provider: string;
  scope: DvarApprovalScope;
  bind: string[];
  bindings: Record<string, string>;
  requestedAt: string;
  expiresAt: string;
  maxUses: number;
  principal: DvarPrincipal;
  agent: DvarAgent;
  tenant?: { id: string };
  session?: { id: string };
  task?: { id: string; purpose?: string };
  environment: string;
  server: DvarAction["server"];
  tool: DvarAction["tool"];
  arguments: unknown;
  argumentsHash: string;
  resources?: DvarResource[];
  resourcesHash?: string;
  destination?: DvarAction["destination"];
  destinationHash?: string;
  summary: string;
  reversible?: boolean;
  risk: DvarRisk;
}

export interface DvarApprovalGrantClaims {
  version: "1";
  id: string;
  requestId: string;
  issuer: string;
  keyId?: string;
  approver: { id: string; type?: string };
  scope: DvarApprovalScope;
  bindings: Record<string, string>;
  bindingHash: string;
  policyHash: string;
  policyVersion: string;
  ruleId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  maxUses: number;
}

export interface DvarApprovalGrant {
  token: string;
  claims: DvarApprovalGrantClaims;
}

export interface DvarApprovalGrantIssueOptions {
  approver: { id: string; type?: string };
  expiresInSeconds?: number;
  maxUses?: number;
  keyId?: string;
}

export interface DvarApprovalSigner {
  readonly issuer: string;
  issue(
    request: DvarApprovalRequest,
    options: DvarApprovalGrantIssueOptions
  ): DvarApprovalGrant | Promise<DvarApprovalGrant>;
  verify(token: string): DvarApprovalGrantClaims | Promise<DvarApprovalGrantClaims>;
}

export interface DvarApprovalUseResult {
  accepted: boolean;
  uses: number;
  reason?: "expired" | "replayed";
}

export interface DvarApprovalUseStore {
  consume(
    nonce: string,
    maxUses: number,
    expiresAt: string
  ): DvarApprovalUseResult | Promise<DvarApprovalUseResult>;
}

export type DvarApprovalProviderStatus = "pending" | "approved" | "rejected";

export interface DvarApprovalProviderResult {
  status: DvarApprovalProviderStatus;
  requestId: string;
  grant?: string;
  approver?: { id: string; type?: string };
  reason?: string;
}

export interface DvarApprovalProvider {
  readonly name: string;
  request(request: DvarApprovalRequest): Promise<DvarApprovalProviderResult>;
}

export interface DvarApprovalRuntimeOptions {
  signer: DvarApprovalSigner;
  provider?: DvarApprovalProvider;
  useStore?: DvarApprovalUseStore;
  autoRequest?: boolean;
}

export interface DvarEvaluationOptions {
  approvalGrant?: string;
}

export interface DvarAuditEvent {
  type:
    | "dvar.action.proposed"
    | "dvar.action.allowed"
    | "dvar.action.denied"
    | "dvar.action.approval_required"
    | "dvar.action.approved"
    | "dvar.action.rejected"
    | "dvar.approval.requested"
    | "dvar.approval.pending"
    | "dvar.approval.consumed"
    | "dvar.approval.replay_detected"
    | "dvar.approval.provider_error"
    | "dvar.integrity.mismatch"
    | "dvar.runtime.internal_error";
  timestamp: string;
  actionId: string;
  decisionId?: string;
  principalId?: string;
  agentId?: string;
  tenantId?: string;
  environment?: string;
  serverId?: string;
  toolName?: string;
  capabilities?: string[];
  actionHash?: string;
  effect?: DvarEffect;
  observedEffect?: DvarObservedEffect;
  ruleId?: string;
  reasonCode?: string;
  policyVersion?: string;
  policyHash?: string;
  risk?: DvarRisk;
  durationMs?: number;
  approvalRequestId?: string;
  approvalGrantId?: string;
  approvalScope?: DvarApprovalScope;
  approvalProvider?: string;
  approverId?: string;
  approvalStatus?: DvarApprovalStatus | DvarApprovalProviderStatus;
}

export type DvarEventSink = (
  event: DvarAuditEvent
) => void | Promise<void>;

export interface DvarCreateOptions {
  policyPath?: string;
  policy?: DvarPolicy;
  lockfilePath?: string;
  lockfile?: DvarLockfile;
  approval?: DvarApprovalRuntimeOptions;
  eventSink?: DvarEventSink;
}

export interface DvarToolContext {
  principal: DvarPrincipal;
  agent: DvarAgent;
  environment: string;
  tenant?: { id: string };
  session?: { id: string };
  task?: { id: string; purpose?: string };
  resources?: DvarResource[];
  destination?: { type: string; value: string };
  trace?: DvarAction["trace"];
  metadata?: Record<string, unknown>;
  approvalGrant?: string;
}

export interface DvarToolDefinition<TArguments, TResult> {
  name: string;
  namespace?: string;
  capabilities?: string[];
  inputSchema?: Record<string, unknown>;
  server?: DvarAction["server"];
  execute: (arguments_: TArguments, context: DvarToolContext) => TResult | Promise<TResult>;
}

export interface DvarProtectedTool<TArguments, TResult> {
  (arguments_: TArguments, context: DvarToolContext): Promise<TResult>;
}

export interface DvarPolicyTestResult {
  name: string;
  passed: boolean;
  expected: DvarPolicyTest["expect"];
  decision?: DvarDecision;
  error?: string;
}

export interface DvarMcpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface DvarInventoryTool {
  name: string;
  title?: string;
  description?: string;
  descriptionSha256: string;
  inputSchema: Record<string, unknown>;
  inputSchemaSha256: string;
  outputSchema?: Record<string, unknown>;
  outputSchemaSha256?: string;
  annotations?: Record<string, unknown>;
  annotationsSha256: string;
  capabilities: string[];
  risk: DvarRiskLevel;
  definitionSha256: string;
}

export interface DvarInventoryServer {
  id: string;
  transport: "streamable-http" | "stdio";
  endpoint?: string;
  command?: string;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string; [key: string]: unknown };
  advertisedCapabilities?: Record<string, unknown>;
  identity: { type: "url" | "command"; value: string };
  integrity: { manifestSha256: string };
  tools: DvarInventoryTool[];
}

export interface DvarInventory {
  inventoryVersion: "1";
  generatedAt: string;
  servers: DvarInventoryServer[];
}

export interface DvarLockfile {
  lockfileVersion: "1";
  generatedAt: string | null;
  servers: DvarInventoryServer[];
}

export type DvarInventoryChangeType =
  | "server.added"
  | "server.removed"
  | "server.endpoint_changed"
  | "server.integrity_changed"
  | "tool.added"
  | "tool.removed"
  | "tool.description_changed"
  | "tool.input_schema_widened"
  | "tool.input_schema_narrowed"
  | "tool.input_schema_changed"
  | "tool.output_schema_changed"
  | "tool.annotations_changed"
  | "tool.capability_expanded"
  | "tool.capability_reduced"
  | "tool.risk_changed";

export interface DvarInventoryChange {
  type: DvarInventoryChangeType;
  serverId: string;
  toolName?: string;
  risk: DvarRiskLevel;
  reasonCode: string;
  message: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface DvarInventoryDiff {
  clean: boolean;
  highestRisk: DvarRiskLevel;
  changes: DvarInventoryChange[];
}

export interface DvarMcpScanOptions {
  endpoint: string | URL;
  serverId?: string;
  headers?: Record<string, string>;
  allowInsecureHttp?: boolean;
  fetch?: typeof globalThis.fetch;
  protocolVersion?: string;
  timeoutMs?: number;
}

export interface DvarMcpProxyContext {
  principal: DvarPrincipal;
  agent: DvarAgent;
  environment: string;
  tenant?: { id: string };
  session?: { id: string };
  approvalGrant?: string;
}
