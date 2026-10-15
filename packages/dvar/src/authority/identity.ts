import { fail } from "./errors.js";
import { number, record, snapshot, strings, text } from "./validation.js";
import type { DvarAgentTrustLevel, DvarVerifiedIdentity } from "./types.js";

export const TRUST_LEVELS: readonly DvarAgentTrustLevel[] = ["untrusted", "restricted", "trusted"];

export interface IdentityPolicy {
  readonly allowedIssuers: readonly string[];
  readonly audience: string;
  readonly environment: string;
  readonly maxIdentityAgeMs: number;
}

export function checkIdentityTime(identity: DvarVerifiedIdentity, now: number, maxAgeMs: number): void {
  if (identity.issuedAtMs > now || (identity.notBeforeMs ?? identity.issuedAtMs) > now) fail("identity.not_yet_valid");
  if (identity.expiresAtMs <= now) fail("identity.expired");
  if (now - identity.issuedAtMs > maxAgeMs) fail("identity.stale");
}

export function validateIdentity(raw: unknown, policy: IdentityPolicy, now: number): DvarVerifiedIdentity {
  if (raw === null) fail("identity.invalid");
  const value = record(snapshot(raw, "identity.invalid", 16_384), [
    "issuer", "audience", "principal", "agent", "tenantId", "environment", "sessionId", "taskId",
    "issuedAtMs", "expiresAtMs", "notBeforeMs"
  ], "identity.invalid");
  const issuer = text(value.issuer, "identity.invalid", 512);
  const audience = text(value.audience, "identity.invalid", 512);
  const environment = text(value.environment, "identity.invalid");
  if (!policy.allowedIssuers.includes(issuer)) fail("identity.issuer_denied");
  if (audience !== policy.audience) fail("identity.audience_denied");
  if (environment !== policy.environment) fail("identity.environment_denied");
  const principal = record(value.principal, ["id", "type", "roles"], "identity.invalid");
  const agent = record(value.agent, ["id", "roles", "trustLevel", "version", "framework"], "identity.invalid");
  if (!["user", "service", "workload", "agent"].includes(String(principal.type))) fail("identity.invalid");
  if (!TRUST_LEVELS.includes(agent.trustLevel as DvarAgentTrustLevel)) fail("identity.invalid");
  const issuedAtMs = number(value.issuedAtMs, "identity.invalid", 0);
  const expiresAtMs = number(value.expiresAtMs, "identity.invalid", 1);
  if (expiresAtMs <= issuedAtMs) fail("identity.invalid");
  const notBeforeMs = value.notBeforeMs === undefined ? undefined : number(value.notBeforeMs, "identity.invalid", 0);
  if (notBeforeMs !== undefined && (notBeforeMs < issuedAtMs || notBeforeMs >= expiresAtMs)) fail("identity.invalid");
  const identity: DvarVerifiedIdentity = snapshot({
    issuer, audience, environment,
    principal: {
      id: text(principal.id, "identity.invalid"), type: principal.type as DvarVerifiedIdentity["principal"]["type"],
      roles: strings(principal.roles, "identity.invalid")
    },
    agent: {
      id: text(agent.id, "identity.invalid"), roles: strings(agent.roles, "identity.invalid"),
      trustLevel: agent.trustLevel as DvarAgentTrustLevel,
      ...(agent.version === undefined ? {} : { version: text(agent.version, "identity.invalid") }),
      ...(agent.framework === undefined ? {} : { framework: text(agent.framework, "identity.invalid") })
    },
    tenantId: text(value.tenantId, "identity.invalid"), issuedAtMs, expiresAtMs,
    ...(notBeforeMs === undefined ? {} : { notBeforeMs }),
    ...(value.sessionId === undefined ? {} : { sessionId: text(value.sessionId, "identity.invalid") }),
    ...(value.taskId === undefined ? {} : { taskId: text(value.taskId, "identity.invalid") })
  }, "identity.invalid", 16_384);
  checkIdentityTime(identity, now, policy.maxIdentityAgeMs);
  return identity;
}
