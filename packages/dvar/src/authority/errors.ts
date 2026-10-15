const REASONS = [
  "authority.configuration_invalid",
  "authority.arguments_invalid",
  "authority.context_invalid",
  "authority.aborted",
  "authority.timeout",
  "authority.capacity",
  "authority.clock_invalid",
  "authority.provider_unavailable",
  "authority.execution_replayed",
  "identity.missing",
  "identity.invalid",
  "identity.issuer_denied",
  "identity.audience_denied",
  "identity.environment_denied",
  "identity.expired",
  "identity.not_yet_valid",
  "identity.stale",
  "identity.changed",
  "identity.roles_denied",
  "identity.trust_denied",
  "ownership.references_invalid",
  "ownership.invalid",
  "ownership.denied",
  "ownership.stale",
  "ownership.changed",
] as const;
export type DvarAuthorityReason = typeof REASONS[number];
export function safeAuthorityReason(value: unknown): DvarAuthorityReason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value)
    ? value as DvarAuthorityReason : "authority.provider_unavailable";
}

/** Fixed safe text only: provider errors, tokens and resource identifiers are never attached. */
export class DvarAuthorityError extends Error {
  public readonly code: DvarAuthorityReason;
  public constructor(code: DvarAuthorityReason) {
    super(`Dvar authority check failed (${safeAuthorityReason(code)})`);
    this.name = "DvarAuthorityError";
    this.code = safeAuthorityReason(code);
    Object.defineProperty(this, "code", { writable: false, configurable: false });
  }
}

export function fail(code: DvarAuthorityReason): never { throw new DvarAuthorityError(code); }
