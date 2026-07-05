import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import type {
  DvarAction,
  DvarDecision,
  DvarEvaluationOptions
} from "../types.js";
import type { DvarRuntime } from "../runtime.js";
import type { DvarRuntimeUsage } from "../runtime-safety/index.js";
import {
  createMcpHttpProxy as createBaseMcpHttpProxy,
  type DvarMcpProxy,
  type DvarMcpProxyOptions
} from "./proxy.js";

interface ProxyRuntimeContext {
  approvalGrant?: string;
  usage?: DvarRuntimeUsage;
  actions: DvarAction[];
}

function requestHeader(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function finiteHeader(
  request: IncomingMessage,
  name: string
): number | undefined {
  const value = requestHeader(request, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function requestUsage(request: IncomingMessage): DvarRuntimeUsage | undefined {
  const retry = finiteHeader(request, "x-dvar-retry");
  const cost = finiteHeader(request, "x-dvar-cost");
  const monetaryValue = finiteHeader(request, "x-dvar-monetary-value");
  const currency = requestHeader(request, "x-dvar-currency");
  if (
    retry === undefined
    && cost === undefined
    && monetaryValue === undefined
    && currency === undefined
  ) {
    return undefined;
  }
  return {
    ...(retry !== undefined ? { retry } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(monetaryValue !== undefined ? { monetaryValue } : {}),
    ...(currency !== undefined ? { currency } : {})
  };
}

function providerFailureDecision(
  runtime: DvarRuntime,
  decision: DvarDecision
): DvarDecision {
  const allow = runtime.policy.mode !== "strict"
    && runtime.policy.runtime?.onApprovalProviderError === "allow";
  const { observedEffect: _observedEffect, ...base } = decision;
  return {
    ...base,
    effect: allow ? "allow" : "deny",
    ruleId: "system.approval_provider",
    reasonCode: allow
      ? "approval.provider_error_fail_open"
      : "approval.provider_unavailable",
    message: allow
      ? "Approval provider failed and policy explicitly allowed fail-open execution"
      : "Approval provider is unavailable",
    approval: {
      status: "provider_error",
      ...(decision.approvalRequest !== undefined
        ? {
            requestId: decision.approvalRequest.id,
            scope: decision.approvalRequest.scope,
            provider: decision.approvalRequest.provider
          }
        : {})
    }
  };
}

function rememberAllowed(
  context: ProxyRuntimeContext | undefined,
  action: DvarAction,
  decision: DvarDecision
): DvarDecision {
  if (decision.effect === "allow") context?.actions.push(action);
  return decision;
}

async function authorizeForProxy(
  runtime: DvarRuntime,
  action: DvarAction,
  approvalGrant: string | undefined,
  context: ProxyRuntimeContext | undefined,
  evaluationOptions: DvarEvaluationOptions = {}
): Promise<DvarDecision> {
  const effectiveAction = context?.usage === undefined
    ? action
    : { ...action, usage: context.usage };

  if (approvalGrant !== undefined) {
    const decision = await runtime.authorize(effectiveAction, {
      ...evaluationOptions,
      approvalGrant
    });
    return rememberAllowed(context, effectiveAction, decision);
  }

  const decision = await runtime.evaluate(effectiveAction, evaluationOptions);
  if (decision.mode === "monitor" || decision.effect === "allow") {
    const committed = await runtime.commitRuntime(effectiveAction, decision);
    return rememberAllowed(context, effectiveAction, committed);
  }
  if (decision.effect !== "require_approval") return decision;

  try {
    const result = await runtime.requestApproval(effectiveAction, decision);
    if (result.status === "approved" && result.grant !== undefined) {
      const approved = await runtime.authorize(effectiveAction, {
        ...evaluationOptions,
        approvalGrant: result.grant
      });
      return rememberAllowed(context, effectiveAction, approved);
    }
    if (result.status === "rejected") {
      const { observedEffect: _observservedEffect, ...base } = decision;
      return {
        ...base,
        effect: "deny",
        reasonCode: "approval.rejected",
        message: result.reason ?? "Approval request was rejected",
        approval: {
          status: "rejected",
          requestId: result.requestId,
          ...(decision.approvalRequest !== undefined
            ? {
                scope: decision.approvalRequest.scope,
                provider: decision.approvalRequest.provider
              }
            : {}),
          ...(result.approver?.id !== undefined
            ? { approverId: result.approver.id }
            : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {})
        }
      };
    }
    return {
      ...decision,
      approval: {
        status: "pending",
        requestId: result.requestId,
        ...(decision.approvalRequest !== undefined
          ? {
              scope: decision.approvalRequest.scope,
              provider: decision.approvalRequest.provider
            }
          : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {})
      }
    };
  } catch {
    const failure = providerFailureDecision(runtime, decision);
    if (failure.effect !== "allow") return failure;
    const committed = await runtime.commitRuntime(effectiveAction, failure);
    return rememberAllowed(context, effectiveAction, committed);
  }
}

/**
 * Approval- and runtime-safety-aware MCP proxy facade.
 *
 * Dvar consumes approval and accounting headers locally. The underlying proxy
 * forwards an explicit header allowlist, so these values never reach the MCP
 * server.
 */
export function createMcpHttpProxy(
  options: DvarMcpProxyOptions
): DvarMcpProxy {
  const runtimeContext = new AsyncLocalStorage<ProxyRuntimeContext>();
  const upstreamFetch = options.fetch ?? globalThis.fetch;
  const runtime = new Proxy(options.runtime, {
    get(target, property, receiver) {
      if (property !== "evaluate") {
        return Reflect.get(target, property, receiver);
      }
      return (
        action: Parameters<DvarRuntime["evaluate"]>[0],
        evaluationOptions: DvarEvaluationOptions = {}
      ) => {
        const current = runtimeContext.getStore();
        return authorizeForProxy(
          target,
          action,
          evaluationOptions.approvalGrant ?? current?.approvalGrant,
          current,
          evaluationOptions
        );
      };
    }
  }) as DvarRuntime;

  const fetchWithOutcome: typeof globalThis.fetch = async (input, init) => {
    const startedAt = performance.now();
    const current = runtimeContext.getStore();
    const actions = current?.actions.splice(0) ?? [];
    try {
      const response = await upstreamFetch(input, init);
      for (const action of actions) {
        await options.runtime.recordOutcome(action, {
          success: response.ok,
          durationMs: performance.now() - startedAt
        });
      }
      return response;
    } catch (error) {
      for (const action of actions) {
        await options.runtime.recordOutcome(action, {
          success: false,
          durationMs: performance.now() - startedAt,
          ...(error instanceof Error && error.name !== "Error"
            ? { errorCode: error.name }
            : {})
        });
      }
      throw error;
    }
  };

  const proxy = createBaseMcpHttpProxy({
    ...options,
    runtime,
    fetch: fetchWithOutcome
  });
  const requestListeners = proxy.server.listeners("request");
  proxy.server.removeAllListeners("request");
  for (const listener of requestListeners) {
    proxy.server.on("request", (request, response) => {
      const approvalGrant = requestHeader(request, "x-dvar-approval-grant");
      const usage = requestUsage(request);
      runtimeContext.run({
        ...(approvalGrant !== undefined ? { approvalGrant } : {}),
        ...(usage !== undefined ? { usage } : {}),
        actions: []
      }, () => {
        Reflect.apply(listener, proxy.server, [request, response]);
      });
    });
  }
  return proxy;
}
