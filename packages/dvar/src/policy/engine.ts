import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { sha256 } from "../canonical.js";
import { getPath } from "../object-path.js";
import { matchesRecord } from "../matchers.js";
import { assessRisk } from "../risk.js";
import type {
  DvarAction,
  DvarDecision,
  DvarEffect,
  DvarObservedEffect,
  DvarPolicy,
  DvarRule
} from "../types.js";

interface GuardrailFailure {
  effect?: Exclude<DvarEffect, "allow">;
  ruleId: string;
  reasonCode: string;
  message: string;
}

export interface EvaluateOptions {
  guardrailFailure?: GuardrailFailure;
}

function observed(effect: DvarEffect): DvarObservedEffect {
  if (effect === "deny") return "would_deny";
  if (effect === "require_approval") return "would_require_approval";
  return "would_allow";
}

function reasonFor(effect: DvarEffect, isDefault: boolean): string {
  if (isDefault) return effect === "deny" ? "policy.no_matching_allow" : "policy.default_effect";
  if (effect === "deny") return "policy.explicit_deny";
  if (effect === "require_approval") return "approval.required";
  return "policy.explicit_allow";
}

function messageFor(effect: DvarEffect, ruleId: string): string {
  if (effect === "deny") return `Action denied by Dvar rule ${ruleId}`;
  if (effect === "require_approval") return `Action requires approval under Dvar rule ${ruleId}`;
  return `Action allowed by Dvar rule ${ruleId}`;
}

function selectRule(rules: DvarRule[], effect: DvarEffect): DvarRule | undefined {
  return rules
    .filter((rule) => rule.effect === effect)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))[0];
}

function requiredContextFailure(policy: DvarPolicy, action: DvarAction): GuardrailFailure | undefined {
  for (const path of policy.identity?.require ?? []) {
    const value = getPath(action, path);
    if (value === undefined || value === null || value === "") {
      return {
        ruleId: "system.required_context",
        reasonCode: path.startsWith("tenant.") ? "tenant.missing" : "identity.missing",
        message: `Required action context is missing: ${path}`
      };
    }
  }

  if (policy.mode === "strict") {
    const strictFields = ["principal.id", "agent.id", "environment"];
    for (const path of strictFields) {
      const value = getPath(action, path);
      if (value === undefined || value === null || value === "") {
        return {
          ruleId: "system.strict_context",
          reasonCode: "identity.missing",
          message: `Strict mode requires action context: ${path}`
        };
      }
    }
  }
  return undefined;
}

export function evaluatePolicy(
  policy: DvarPolicy,
  policyHash: string,
  action: DvarAction,
  options: EvaluateOptions = {}
): DvarDecision {
  const startedAt = performance.now();
  const actionHash = sha256(action);
  const risk = assessRisk(action);

  if (policy.mode === "off") {
    return {
      id: randomUUID(),
      effect: "allow",
      mode: "off",
      ruleId: "system.off",
      reasonCode: "runtime.off",
      message: "Dvar is disabled for this action",
      risk,
      obligations: [],
      policyVersion: policy.version ?? policy.schemaVersion,
      policyHash,
      actionHash,
      evaluatedAt: new Date().toISOString(),
      durationMs: performance.now() - startedAt
    };
  }

  const guardrail = options.guardrailFailure ?? requiredContextFailure(policy, action);
  let underlyingEffect: DvarEffect;
  let ruleId: string;
  let reasonCode: string;
  let message: string;
  let obligations = [] as DvarDecision["obligations"];

  if (guardrail !== undefined) {
    underlyingEffect = guardrail.effect ?? "deny";
    ({ ruleId, reasonCode, message } = guardrail);
  } else {
    const matchingRules = (policy.rules ?? []).filter(
      (rule) => matchesRecord(rule.when, action) && matchesRecord(rule.constraints, action)
    );
    const selected =
      selectRule(matchingRules, "deny") ??
      selectRule(matchingRules, "require_approval") ??
      selectRule(matchingRules, "allow");

    underlyingEffect = selected?.effect ?? policy.defaultEffect;
    ruleId = selected?.id ?? "policy.default";
    reasonCode = reasonFor(underlyingEffect, selected === undefined);
    message = selected?.message ?? messageFor(underlyingEffect, ruleId);
    obligations = selected?.obligations ?? [];
  }

  const durationMs = performance.now() - startedAt;
  const maxDecisionMs = policy.runtime?.maxDecisionMs;
  if (maxDecisionMs !== undefined && durationMs > maxDecisionMs) {
    underlyingEffect = policy.runtime?.onDecisionTimeout === "allow" ? "allow" : "deny";
    ruleId = "system.decision_timeout";
    reasonCode = "runtime.decision_timeout";
    message = `Dvar decision exceeded ${maxDecisionMs}ms`;
    obligations = [];
  }

  const monitor = policy.mode === "monitor";
  return {
    id: randomUUID(),
    effect: monitor ? "allow" : underlyingEffect,
    ...(monitor ? { observedEffect: observed(underlyingEffect) } : {}),
    mode: policy.mode,
    ruleId,
    reasonCode,
    message,
    risk,
    obligations,
    policyVersion: policy.version ?? policy.schemaVersion,
    policyHash,
    actionHash,
    evaluatedAt: new Date().toISOString(),
    durationMs: performance.now() - startedAt
  };
}
