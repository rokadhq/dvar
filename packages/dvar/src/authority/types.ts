import type {
  DvarAction, DvarDecision, DvarPrincipal, DvarProtectedTool,
  DvarResource, DvarToolDefinition
} from "../types.js";

export type DvarAgentTrustLevel = "untrusted" | "restricted" | "trusted";

/** The application verifier authenticates these claims; model JSON is not evidence. */
export interface DvarVerifiedIdentity {
  readonly issuer: string;
  readonly audience: string;
  readonly principal: { readonly id: string; readonly type: DvarPrincipal["type"]; readonly roles: readonly string[] };
  readonly agent: {
    readonly id: string;
    readonly roles: readonly string[];
    readonly trustLevel: DvarAgentTrustLevel;
    readonly version?: string;
    readonly framework?: string;
  };
  readonly tenantId: string;
  readonly environment: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  /** UTC epoch milliseconds. This is assertion issuance, not a fresh timestamp on every lookup. */
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly notBeforeMs?: number;
}

export interface DvarIdentityVerifier {
  /** Application-controlled public audit alias, not a credential or endpoint. */
  readonly id: string;
  /** Authenticate cryptographic/session evidence and current revocation state, or return null. */
  verify(credential: string, context: { readonly signal: AbortSignal }): Promise<DvarVerifiedIdentity | null>;
}

export interface DvarResourceReference {
  readonly type: string;
  readonly id: string;
  readonly operation: "read" | "write" | "delete";
}

export interface DvarOwnershipRecord {
  readonly type: string;
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  /** Opaque application/database revision; executors must enforce this condition atomically. */
  readonly version: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly classification?: string;
}

/** Extra fields are retained in Dvar's resource/action hashes and approval requests. */
export interface DvarVerifiedResource extends DvarResource {
  type: string;
  id: string;
  ownerId: string;
  tenantId: string;
  version: string;
  operation: DvarResourceReference["operation"];
}

export interface DvarOwnershipProvider {
  readonly id: string;
  resolve(reference: DvarResourceReference, context: {
    readonly identity: DvarVerifiedIdentity;
    readonly signal: AbortSignal;
  }): Promise<DvarOwnershipRecord | null>;
}

export type DvarResourceRequirement<TArguments> =
  | { readonly mode: "none" }
  | {
      /** owner checks both tenant and principal; tenant requires an explicit same-tenant opt-in. */
      readonly mode: "owner" | "tenant";
      /** Trusted application selector, not a model-selected set of resources. Must return 1–16 resources. */
      readonly select: (arguments_: TArguments, identity: DvarVerifiedIdentity) => readonly DvarResourceReference[];
    };

export interface DvarAuthorityExecutionContext {
  readonly identity: DvarVerifiedIdentity;
  readonly resources: readonly Readonly<DvarVerifiedResource>[];
  readonly signal?: AbortSignal;
}

export interface DvarAuthorityToolDefinition<TArguments, TResult> {
  readonly name: string;
  readonly namespace?: string;
  readonly capabilities?: readonly string[];
  readonly inputSchema?: Record<string, unknown>;
  readonly server?: DvarAction["server"];
  readonly resources: DvarResourceRequirement<TArguments>;
  readonly requiredRoles?: readonly string[];
  readonly allowedTrustLevels?: readonly DvarAgentTrustLevel[];
  readonly execute: (arguments_: TArguments, context: DvarAuthorityExecutionContext) => TResult | Promise<TResult>;
}

export interface DvarAuthorityCallOptions {
  /** Pass from authenticated application transport, never from model-visible tool arguments. */
  readonly credential: string;
  readonly signal?: AbortSignal;
  readonly approvalGrant?: string;
}

export interface DvarAuthorityPreview {
  readonly action: DvarAction;
  readonly decision: DvarDecision;
}

export interface DvarAuthorityTool<TArguments, TResult> {
  (arguments_: TArguments, options: DvarAuthorityCallOptions): Promise<TResult>;
  /** Does not supply/consume an approval grant or call protectTool(). Provider reads still occur. */
  evaluate(arguments_: TArguments, options: Omit<DvarAuthorityCallOptions, "approvalGrant">): Promise<DvarAuthorityPreview>;
}

/** Directly satisfied by the existing DvarRuntime; no alternative policy engine. */
export interface DvarAuthorityRuntime {
  evaluate(action: DvarAction): Promise<DvarDecision>;
  protectTool<TArguments, TResult>(definition: DvarToolDefinition<TArguments, TResult>): DvarProtectedTool<TArguments, TResult>;
}

export interface DvarAuthorityEvent {
  readonly type: "dvar.authority.checked" | "dvar.authority.denied";
  readonly stage: "preview" | "prepare" | "dispatch";
  readonly source: string;
  readonly ownershipSource?: string;
  readonly reasonCode: string;
  readonly resourceCount: number;
}

export interface DvarAuthorityOptions {
  readonly runtime: DvarAuthorityRuntime;
  readonly identityVerifier: DvarIdentityVerifier;
  readonly ownershipProvider?: DvarOwnershipProvider;
  readonly allowedIssuers: readonly string[];
  readonly audience: string;
  readonly environment: string;
  readonly maxIdentityAgeMs?: number;
  readonly maxOwnershipAgeMs?: number;
  readonly providerTimeoutMs?: number;
  readonly phaseTimeoutMs?: number;
  readonly maxPendingChecks?: number;
  readonly maxArgumentBytes?: number;
  readonly eventSink?: (event: DvarAuthorityEvent) => void | Promise<void>;
  /** Testing/host time source only. Backward time fails closed. */
  readonly clock?: () => number;
}

export interface DvarAuthorityBoundary {
  protectTool<TArguments, TResult>(definition: DvarAuthorityToolDefinition<TArguments, TResult>): DvarAuthorityTool<TArguments, TResult>;
  diagnostics(): { readonly pendingChecks: number; readonly pendingEvents: number; readonly droppedEvents: number };
}
