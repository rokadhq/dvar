import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import "./runtime-safety/augment.js";
import "./output-guard/augment.js";
import {
  createApprovalRequest as buildApprovalRequest,
  InMemoryApprovalUseStore,
  processApprovalDecision,
  submitApprovalRequest
} from "./approvals/index.js";
import { sha256 } from "./canonical.js";
import {
  DvarApprovalRequiredError,
  DvarConfigurationError,
  DvarDeniedError
} from "./errors.js";
import {
  DvarApprovalProviderError,
  DvarApprovalRejectedError
} from "./approvals/errors.js";
import {
  decisionEvent,
  emitSafely,
  integrityMismatchEvent,
  internalErrorEvent,
  proposedEvent
} from "./events.js";
import {
  approvalConsumedEvent,
  approvalProviderErrorEvent,
  approvalProviderResultEvent,
  approvalReplayEvent,
  approvalRequestEvent
} from "./approvals/events.js";
import { evaluateIntegrity } from "./integrity.js";
import { findLockedTool, loadLockfile, validateLockfile } from "./lockfile.js";
import { createOutputGuard, DvarOutputPolicyError, type DvarOutputGuardSummary } from "./output-guard/index.js";
import { evaluatePolicy, type EvaluateOptions } from "./policy/engine.js";
import { loadPolicy, validatePolicy } from "./policy/load.js";
import { assessRisk } from "./risk.js";
import {
  createRuntimeGuard,
  DvarRuntimeStoreError,
  type DvarRuntimeDiagnostics,
  type DvarRuntimeOutcome,
  type DvarRuntimeSafetyFailure
} from "./runtime-safety/index.js";
import type {
  DvarAction,
  DvarApprovalProviderResult,
  DvarApprovalRequest,
  DvarCreateOptions,
  DvarDecision,
  DvarEvaluationOptions,
  DvarInventoryTool,
  DvarLockfile,
  DvarPolicy,
  DvarProtectedTool,
  DvarToolContext,
  DvarToolDefinition
} from "./types.js";

export interface DvarRuntime {
  readonly policy: DvarPolicy;
  readonly policyHash: string;
  readonly lockfile?: DvarLockfile;
  evaluate(action: DvarAction, options?: DvarEvaluationOptions): Promise<DvarDecision>;
  authorize(action: DvarAction, options?: DvarEvaluationOptions): Promise<DvarDecision>;
  commitRuntime(action: DvarAction, decision: DvarDecision): Promise<DvarDecision>;
  recordOutcome(action: DvarAction, outcome: DvarRuntimeOutcome): Promise<void>;
  diagnostics(): Promise<DvarRuntimeDiagnostics>;
  createApprovalRequest(action: DvarAction, decision?: DvarDecision): Promise<DvarApprovalRequest>;
  requestApproval(action: DvarAction, decision?: DvarDecision): Promise<DvarApprovalProviderResult>;
  resume(action: DvarAction, approvalGrant: string): Promise<DvarDecision>;
  lockedTool(serverId: string, toolName: string, endpoint?: string): DvarInventoryTool | undefined;
  protectTool<TArguments, TResult>(
    definition: DvarToolDefinition<TArguments, TResult>
  ): DvarProtectedTool<TArguments, TResult>;
}

interface InternalEvaluationOptions
  extends EvaluateOptions,
    DvarEvaluationOptions {
  commitRuntime?: boolean;
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function buildAction<TArguments>(
  definition: DvarToolDefinition<TArguments, unknown>,
  arguments_: TArguments,
  context: DvarToolContext
): DvarAction {
  return {
    id: randomUUID(),
    principal: context.principal,
    agent: context.agent,
    ...(context.tenant !== undefined ? { tenant: context.tenant } : {}),
    ...(context.session !== undefined ? { session: context.session } : {}),
    ...(context.task !== undefined ? { task: context.task } : {}),
    environment: context.environment,
    server: definition.server ?? { id: "local", transport: "function" },
    tool: {
      name: definition.name,
      ...(definition.namespace !== undefined ? { namespace: definition.namespace } : {}),
      capabilities: definition.capabilities ?? [],
      ...(definition.inputSchema !== undefined ? { schemaHash: sha256(definition.inputSchema) } : {})
    },
    arguments: arguments_,
    ...(context.resources !== undefined ? { resources: context.resources } : {}),
    ...(context.destination !== undefined ? { destination: context.destination } : {}),
    ...(context.trace !== undefined ? { trace: context.trace } : {}),
    ...(context.metadata !== undefined ? { metadata: context.metadata } : {}),
    ...(context.usage !== undefined ? { usage: context.usage } : {})
  };
}

function providerFailureDecision(
  decision: DvarDecision,
  request: DvarApprovalRequest,
  allow: boolean
): DvarDecision {
  const { observedEffect: _observedEffect, ...baseDecision } = decision;
  return {
    ...baseDecision,
    effect: allow ? "allow" : "deny",
    ruleId: "system.approval_provider",
    reasonCode: allow
      ? "approval.provider_error_fail_open"
      : "approval.provider_unavailable",
    message: allow
      ? "Approval provider failed and policy explicitly allowed fail-open execution"
      : "Approval provider is unavailable",
    approvalRequest: request,
    approval: {
      status: "provider_error",
      requestId: request.id,
      scope: request.scope,
      provider: request.provider,
      reason: "approval.provider_unavailable"
    }
  };
}

function runtimeFailureDecision(
  policy: DvarPolicy,
  decision: DvarDecision,
  failure: DvarRuntimeSafetyFailure
): DvarDecision {
  const monitor = policy.mode === "monitor";
  const { observedEffect: _observedEffect, ...base } = decision;
  return {
    ...base,
    effect: monitor ? "allow" : "deny",
    ...(monitor ? { observedEffect: "would_deny" as const } : {}),
    ruleId: failure.ruleId,
    reasonCode: failure.reasonCode,
    message: failure.message,
    runtimeSafety: failure.summary
  };
}

async function runtimeStoreFailureDecision(
  policy: DvarPolicy,
  decision: DvarDecision,
  diagnostics: () => Promise<DvarRuntimeDiagnostics>,
  error: unknown
): Promise<DvarDecision> {
  const allow = policy.mode !== "strict"
    && policy.runtime?.onRuntimeStoreError === "allow";
  const monitor = policy.mode === "monitor";
  const { observedEffect: _observedEffect, ...base } = decision;
  let store = "unknown";
  let distributed = false;
  try {
    const current = await diagnostics();
    store = current.store.kind;
    distributed = current.store.distributed;
  } catch {
    // Preserve the original runtime-store failure.
  }
  return {
    ...base,
    effect: allow || monitor ? "allow" : "deny",
    ...(monitor ? { observedEffect: "would_deny" as const } : {}),
    ruleId: "system.runtime_store",
    reasonCode: allow
      ? "runtime.store_error_fail_open"
      : "runtime.store_unavailable",
    message: allow
      ? "Runtime store failed and policy explicitly allowed fail-open execution"
      : error instanceof Error
        ? error.message
        : "Runtime store is unavailable",
    runtimeSafety: {
      status: "store_error",
      control: "runtimeStore",
      store,
      distributed
    }
  };
}

function outputPolicyDecision(
  policy: DvarPolicy,
  decision: DvarDecision,
  summary: DvarOutputGuardSummary
): DvarDecision {
  const monitor = policy.mode === "monitor";
  const off = policy.mode === "off";
  const { observedEffect: _observedEffect, ...base } = decision;
  return {
    ...base,
    effect: monitor || off ? "allow" : "deny",
    ...(monitor ? { observedEffect: "would_deny" as const } : {}),
    ruleId: "system.output_guard",
    reasonCode: summary.reasonCode ?? "output.denied",
    message: summary.message ?? "Tool output denied by Dvar output policy",
    outputSafety: summary
  };
}

function outputFilterErrorDecision(
  policy: DvarPolicy,
  decision: DvarDecision,
  summary: DvarOutputGuardSummary
): DvarDecision {
  const allow = policy.mode !== "strict"
    && policy.runtime?.onOutputFilterError === "allow";
  const monitor = policy.mode === "monitor";
  const { observedEffect: _observedEffect, ...base } = decision;
  return {
    ...base,
    effect: allow || monitor ? "allow" : "deny",
    ...(monitor ? { observedEffect: "would_deny" as const } : {}),
    ruleId: "system.output_guard",
    reasonCode: allow ? "output.filter_error_fail_open" : "output.filter_error",
    message: allow
      ? "Output filtering failed and policy explicitly allowed fail-open return"
      : summary.message ?? "Output filtering failed",
    outputSafety: summary
  };
}

function requiresApproval(decision: DvarDecision): boolean {
  return decision.effect === "require_approval";
}

export async function createDvar(options: DvarCreateOptions = {}): Promise<DvarRuntime> {
  if (options.policy !== undefined && options.policyPath !== undefined) {
    throw new DvarConfigurationError("Provide either policy or policyPath, not both");
  }
  if (options.lockfile !== undefined && options.lockfilePath !== undefined) {
    throw new DvarConfigurationError("Provide either lockfile or lockfilePath, not both");
  }
  const policy = options.policy !== undefined
    ? validatePolicy(options.policy)
    : await loadPolicy(options.policyPath ?? "dvar.yaml");
  const policyHash = sha256(policy);
  const lockfile = options.lockfile !== undefined
    ? validateLockfile(options.lockfile)
    : options.lockfilePath !== undefined
      ? await loadLockfile(options.lockfilePath)
      : undefined;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const approvalUseStore = options.approval?.useStore ?? new InMemoryApprovalUseStore();
  const runtimeGuard = createRuntimeGuard(policy, options.runtimeSafety);
  const outputGuard = options.outputGuard === undefined
    ? undefined
    : createOutputGuard(options.outputGuard);
  const runtimeStoreKind = options.runtimeSafety?.store?.kind ?? "memory";
  const runtimeStoreDistributed = options.runtimeSafety?.store?.distributed ?? false;

  async function commitRuntimeInternal(
    action: DvarAction,
    decision: DvarDecision
  ): Promise<DvarDecision> {
    if (decision.effect !== "allow") return decision;
    try {
      const runtimeFailure = await runtimeGuard.before(action);
      if (runtimeFailure !== undefined) {
        return runtimeFailureDecision(policy, decision, runtimeFailure);
      }
      return {
        ...decision,
        runtimeSafety: {
          status: "allowed",
          control: "runtimeGuard",
          store: runtimeStoreKind,
          distributed: runtimeStoreDistributed
        }
      };
    } catch (error) {
      return runtimeStoreFailureDecision(
        policy,
        decision,
        () => runtimeGuard.diagnostics(),
        error
      );
    }
  }

  async function evaluateInternal(
    action: DvarAction,
    evaluateOptions: InternalEvaluationOptions = {}
  ): Promise<DvarDecision> {
    const startedAt = performance.now();
    let actionHash: string;
    try {
      actionHash = sha256(action);
    } catch {
      actionHash = sha256({
        id: action.id,
        principalId: action.principal.id,
        agentId: action.agent.id,
        environment: action.environment,
        serverId: action.server.id,
        toolName: action.tool.name
      });
    }
    await emitSafely(options.eventSink, proposedEvent(action, actionHash));

    try {
      const integrityFailure = evaluateIntegrity(policy, lockfile, action);
      const baseDecision = evaluatePolicy(policy, policyHash, action, {
        ...evaluateOptions,
        ...(evaluateOptions.guardrailFailure === undefined && integrityFailure !== undefined
          ? { guardrailFailure: integrityFailure }
          : {})
      });
      let decision = await processApprovalDecision({
        policy,
        action,
        decision: baseDecision,
        ...(options.approval !== undefined ? { runtime: options.approval } : {}),
        ...(evaluateOptions.approvalGrant !== undefined
          ? { approvalGrant: evaluateOptions.approvalGrant }
          : {}),
        useStore: approvalUseStore
      });

      if (evaluateOptions.commitRuntime === true) {
        decision = await commitRuntimeInternal(action, decision);
      }

      await emitSafely(options.eventSink, decisionEvent(action, decision));
      const integrityEvent = integrityMismatchEvent(action, decision);
      if (integrityEvent !== undefined) await emitSafely(options.eventSink, integrityEvent);
      const consumedEvent = approvalConsumedEvent(action, decision);
      if (consumedEvent !== undefined) await emitSafely(options.eventSink, consumedEvent);
      const replayEvent = approvalReplayEvent(action, decision);
      if (replayEvent !== undefined) await emitSafely(options.eventSink, replayEvent);
      return decision;
    } catch {
      const configuredEffect = policy.runtime?.onEvaluationError === "allow" ? "allow" : "deny";
      const monitor = policy.mode === "monitor";
      const decision: DvarDecision = {
        id: randomUUID(),
        effect: policy.mode === "off" || monitor ? "allow" : configuredEffect,
        ...(monitor
          ? { observedEffect: configuredEffect === "allow" ? "would_allow" : "would_deny" }
          : {}),
        mode: policy.mode,
        ruleId: "system.evaluation_error",
        reasonCode: "runtime.internal_error",
        message: `Dvar evaluation failed; onEvaluationError=${configuredEffect}`,
        risk: assessRisk(action),
        obligations: [],
        policyVersion: policy.version ?? policy.schemaVersion,
        policyHash,
        actionHash,
        evaluatedAt: new Date().toISOString(),
        durationMs: performance.now() - startedAt
      };
      await emitSafely(options.eventSink, internalErrorEvent(action, decision));
      return decision;
    }
  }

  async function recordOutcomeInternal(
    action: DvarAction,
    outcome: DvarRuntimeOutcome
  ): Promise<void> {
    try {
      await runtimeGuard.after(action, outcome);
    } catch (error) {
      const failOpen = policy.mode === "off"
        || policy.mode === "monitor"
        || (policy.mode !== "strict" && policy.runtime?.onRuntimeStoreError === "allow");
      if (failOpen) return;
      if (error instanceof DvarRuntimeStoreError) throw error;
      throw new DvarRuntimeStoreError(
        error instanceof Error ? error.message : "Runtime outcome update failed",
        error instanceof Error ? { cause: error } : undefined
      );
    }
  }

  async function filterOutputInternal<TResult>(
    action: DvarAction,
    decision: DvarDecision,
    value: TResult
  ): Promise<TResult> {
    if (outputGuard === undefined) return value;
    try {
      const filtered = outputGuard.filter({
        action,
        value,
        contentType: "json",
        source: action.server.transport === "stdio" ? "stdio" : "tool"
      });
      const outputDecision = filtered.summary.status === "denied"
        ? outputPolicyDecision(policy, decision, filtered.summary)
        : { ...decision, outputSafety: filtered.summary };
      await emitSafely(options.eventSink, decisionEvent(action, outputDecision));
      if (filtered.summary.status === "denied") {
        if (outputDecision.effect === "deny") throw new DvarOutputPolicyError(filtered.summary);
        return value;
      }
      return filtered.value;
    } catch (error) {
      if (error instanceof DvarOutputPolicyError) throw error;
      const summary: DvarOutputGuardSummary = {
        status: "denied",
        contentType: "unknown",
        bytes: 0,
        redactions: [],
        reasonCode: "output.filter_error",
        message: error instanceof Error ? error.message : "Output filtering failed"
      };
      const outputDecision = outputFilterErrorDecision(policy, decision, summary);
      await emitSafely(options.eventSink, decisionEvent(action, outputDecision));
      if (outputDecision.effect === "deny") throw new DvarOutputPolicyError(summary);
      return value;
    }
  }

  async function createRequest(
    action: DvarAction,
    suppliedDecision?: DvarDecision
  ): Promise<DvarApprovalRequest> {
    const decision = suppliedDecision ?? await evaluateInternal(action);
    if (decision.approvalRequest !== undefined) return decision.approvalRequest;
    if (decision.effect !== "require_approval" && decision.observedEffect !== "would_require_approval") {
      throw new DvarConfigurationError("Action does not currently require approval");
    }
    return buildApprovalRequest(policy, action, decision, {
      ...(options.approval?.provider?.name !== undefined
        ? { provider: options.approval.provider.name }
        : {})
    });
  }

  async function requestApproval(
    action: DvarAction,
    suppliedDecision?: DvarDecision
  ): Promise<DvarApprovalProviderResult> {
    const request = await createRequest(action, suppliedDecision);
    await emitSafely(options.eventSink, approvalRequestEvent(action, request));
    try {
      const result = await submitApprovalRequest(request, options.approval);
      await emitSafely(options.eventSink, approvalProviderResultEvent(action, request, result));
      return result;
    } catch (error) {
      await emitSafely(options.eventSink, approvalProviderErrorEvent(action, request));
      throw new DvarApprovalProviderError(request, error);
    }
  }

  function protectTool<TArguments, TResult>(
    definition: DvarToolDefinition<TArguments, TResult>
  ): DvarProtectedTool<TArguments, TResult> {
    let validator: ValidateFunction | undefined;
    if (definition.inputSchema !== undefined) validator = ajv.compile(definition.inputSchema);

    return async (arguments_: TArguments, context: DvarToolContext): Promise<TResult> => {
      const action = buildAction(definition, arguments_, context);
      let guardrailFailure: EvaluateOptions["guardrailFailure"];
      if (validator !== undefined && !validator(arguments_)) {
        guardrailFailure = {
          ruleId: "system.argument_schema",
          reasonCode: "argument.schema_invalid",
          message: `Tool arguments failed JSON Schema validation: ${validationMessage(validator.errors)}`
        };
      }
      let decision = await evaluateInternal(action, {
        commitRuntime: true,
        ...(guardrailFailure !== undefined ? { guardrailFailure } : {}),
        ...(context.approvalGrant !== undefined ? { approvalGrant: context.approvalGrant } : {})
      });
      if (decision.effect === "deny") throw new DvarDeniedError(decision);
      if (requiresApproval(decision)) {
        const request = decision.approvalRequest ?? await createRequest(action, decision);
        if (options.approval?.provider !== undefined && options.approval.autoRequest !== false) {
          let providerResult: DvarApprovalProviderResult | undefined;
          try {
            providerResult = await requestApproval(action, decision);
          } catch (error) {
            const allow = policy.mode !== "strict" && policy.runtime?.onApprovalProviderError === "allow";
            const failureDecision = providerFailureDecision(decision, request, allow);
            await emitSafely(options.eventSink, decisionEvent(action, failureDecision));
            if (!allow) {
              if (error instanceof DvarApprovalProviderError) throw error;
              throw new DvarApprovalProviderError(request, error);
            }
            decision = await commitRuntimeInternal(action, failureDecision);
            if (decision.effect === "deny") throw new DvarDeniedError(decision);
          }
          if (providerResult?.status === "approved" && providerResult.grant !== undefined) {
            decision = await evaluateInternal(action, {
              approvalGrant: providerResult.grant,
              commitRuntime: true
            });
            if (decision.effect === "deny") throw new DvarDeniedError(decision);
            if (requiresApproval(decision)) {
              throw new DvarApprovalRequiredError(decision);
            }
          } else if (providerResult?.status === "rejected") {
            throw new DvarApprovalRejectedError(decision, request, providerResult);
          } else if (providerResult !== undefined) {
            throw new DvarApprovalRequiredError(decision);
          }
        } else {
          throw new DvarApprovalRequiredError(decision);
        }
      }

      const executionStartedAt = performance.now();
      try {
        const result = await definition.execute(arguments_, context);
        await recordOutcomeInternal(action, {
          success: true,
          durationMs: performance.now() - executionStartedAt
        });
        return filterOutputInternal(action, decision, result);
      } catch (error) {
        try {
          await recordOutcomeInternal(action, {
            success: false,
            durationMs: performance.now() - executionStartedAt,
            ...(error instanceof Error && error.name !== "Error"
              ? { errorCode: error.name }
              : {})
          });
        } catch (storeError) {
          throw new AggregateError(
            [error, storeError],
            "Tool execution and runtime outcome recording both failed"
          );
        }
        throw error;
      }
    };
  }

  return {
    policy,
    policyHash,
    ...(lockfile !== undefined ? { lockfile } : {}),
    evaluate: (action: DvarAction, evaluateOptions: DvarEvaluationOptions = {}) =>
      evaluateInternal(action, evaluateOptions),
    authorize: (action: DvarAction, evaluateOptions: DvarEvaluationOptions = {}) =>
      evaluateInternal(action, { ...evaluateOptions, commitRuntime: true }),
    commitRuntime: commitRuntimeInternal,
    recordOutcome: recordOutcomeInternal,
    diagnostics: () => runtimeGuard.diagnostics(),
    createApprovalRequest: createRequest,
    requestApproval,
    resume: (action: DvarAction, approvalGrant: string) =>
      evaluateInternal(action, { approvalGrant, commitRuntime: true }),
    lockedTool: (serverId: string, toolName: string, endpoint?: string) =>
      findLockedTool(lockfile, serverId, toolName, endpoint),
    protectTool
  };
}
