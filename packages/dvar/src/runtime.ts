import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { sha256 } from "./canonical.js";
import { DvarApprovalRequiredError, DvarConfigurationError, DvarDeniedError } from "./errors.js";
import { decisionEvent, emitSafely, internalErrorEvent, proposedEvent } from "./events.js";
import { loadPolicy, validatePolicy } from "./policy/load.js";
import { evaluatePolicy, type EvaluateOptions } from "./policy/engine.js";
import { assessRisk } from "./risk.js";
import type {
  DvarAction,
  DvarCreateOptions,
  DvarDecision,
  DvarPolicy,
  DvarProtectedTool,
  DvarToolContext,
  DvarToolDefinition
} from "./types.js";

export interface DvarRuntime {
  readonly policy: DvarPolicy;
  readonly policyHash: string;
  evaluate(action: DvarAction): Promise<DvarDecision>;
  protectTool<TArguments, TResult>(
    definition: DvarToolDefinition<TArguments, TResult>
  ): DvarProtectedTool<TArguments, TResult>;
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
    ...(context.metadata !== undefined ? { metadata: context.metadata } : {})
  };
}

export async function createDvar(options: DvarCreateOptions = {}): Promise<DvarRuntime> {
  if (options.policy !== undefined && options.policyPath !== undefined) {
    throw new DvarConfigurationError("Provide either policy or policyPath, not both");
  }
  const policy = options.policy !== undefined
    ? validatePolicy(options.policy)
    : await loadPolicy(options.policyPath ?? "dvar.yaml");
  const policyHash = sha256(policy);
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  async function evaluateInternal(
    action: DvarAction,
    evaluateOptions: EvaluateOptions = {}
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
      const decision = evaluatePolicy(policy, policyHash, action, evaluateOptions);
      await emitSafely(options.eventSink, decisionEvent(action, decision));
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

  function protectTool<TArguments, TResult>(
    definition: DvarToolDefinition<TArguments, TResult>
  ): DvarProtectedTool<TArguments, TResult> {
    let validator: ValidateFunction | undefined;
    if (definition.inputSchema !== undefined) {
      validator = ajv.compile(definition.inputSchema);
    }

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
      const decision = await evaluateInternal(action, { ...(guardrailFailure !== undefined ? { guardrailFailure } : {}) });
      if (decision.effect === "deny") throw new DvarDeniedError(decision);
      if (decision.effect === "require_approval") throw new DvarApprovalRequiredError(decision);
      return definition.execute(arguments_, context);
    };
  }

  return {
    policy,
    policyHash,
    evaluate: evaluateInternal,
    protectTool
  };
}
