import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import type {
  DvarDecision,
  DvarEvaluationOptions
} from "../types.js";
import type { DvarRuntime } from "../runtime.js";
import {
  createMcpHttpProxy as createBaseMcpHttpProxy,
  type DvarMcpProxy,
  type DvarMcpProxyOptions
} from "./proxy.js";

function requestHeader(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
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

async function evaluateForProxy(
  runtime: DvarRuntime,
  action: Parameters<DvarRuntime["evaluate"]>[0],
  approvalGrant: string | undefined,
  evaluationOptions: DvarEvaluationOptions = {}
): Promise<DvarDecision> {
  const decision = await runtime.evaluate(action, {
    ...evaluationOptions,
    ...(approvalGrant !== undefined ? { approvalGrant } : {})
  });
  if (
    approvalGrant !== undefined
    || decision.mode === "monitor"
    || decision.effect !== "require_approval"
  ) {
    return decision;
  }

  try {
    const result = await runtime.requestApproval(action, decision);
    if (result.status === "approved" && result.grant !== undefined) {
      return runtime.resume(action, result.grant);
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
    return providerFailureDecision(runtime, decision);
  }
}

/**
 * Approval-aware MCP proxy facade.
 *
 * The `x-dvar-approval-grant` header is consumed only by Dvar. The underlying
 * proxy forwards an explicit header allowlist, so the grant never reaches the
 * MCP server.
 */
export function createMcpHttpProxy(
  options: DvarMcpProxyOptions
): DvarMcpProxy {
  const approvalContext = new AsyncLocalStorage<string | undefined>();
  const runtime = new Proxy(options.runtime, {
    get(target, property, receiver) {
      if (property !== "evaluate") {
        return Reflect.get(target, property, receiver);
      }
      return (
        action: Parameters<DvarRuntime["evaluate"]>[0],
        evaluationOptions: DvarEvaluationOptions = {}
      ) => evaluateForProxy(
        target,
        action,
        evaluationOptions.approvalGrant ?? approvalContext.getStore(),
        evaluationOptions
      );
    }
  }) as DvarRuntime;

  const proxy = createBaseMcpHttpProxy({ ...options, runtime });
  const requestListeners = proxy.server.listeners("request");
  proxy.server.removeAllListeners("request");
  for (const listener of requestListeners) {
    proxy.server.on("request", (request, response) => {
      const grant = requestHeader(request, "x-dvar-approval-grant");
      approvalContext.run(grant, () => {
        Reflect.apply(listener, proxy.server, [request, response]);
      });
    });
  }
  return proxy;
}
