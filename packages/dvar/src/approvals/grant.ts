import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256 } from "../canonical.js";
import { DvarError } from "../errors.js";
import type {
  DvarAction,
  DvarApprovalGrant,
  DvarApprovalGrantClaims,
  DvarApprovalGrantIssueOptions,
  DvarApprovalRequest,
  DvarApprovalSigner,
  DvarApprovalUseStore
} from "../types.js";
import { approvalBindings } from "./request.js";

const TOKEN_PREFIX = "dvar1";
const MAX_TOKEN_BYTES = 32_768;

export class DvarApprovalGrantError extends DvarError {
  public constructor(message: string, reasonCode: string, options?: ErrorOptions) {
    super(message, reasonCode, options);
  }
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(secret: Buffer, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

function validateClaims(value: unknown): DvarApprovalGrantClaims {
  if (value === null || typeof value !== "object") {
    throw new DvarApprovalGrantError(
      "Approval grant payload is invalid",
      "approval.grant_invalid"
    );
  }
  const claims = value as Partial<DvarApprovalGrantClaims>;
  if (
    claims.version !== "1"
    || typeof claims.id !== "string"
    || typeof claims.requestId !== "string"
    || typeof claims.issuer !== "string"
    || claims.approver === undefined
    || typeof claims.approver.id !== "string"
    || (claims.scope !== "once" && claims.scope !== "session" && claims.scope !== "task")
    || claims.bindings === undefined
    || typeof claims.bindingHash !== "string"
    || typeof claims.policyHash !== "string"
    || typeof claims.policyVersion !== "string"
    || typeof claims.ruleId !== "string"
    || typeof claims.issuedAt !== "string"
    || typeof claims.expiresAt !== "string"
    || typeof claims.nonce !== "string"
    || !Number.isInteger(claims.maxUses)
    || (claims.maxUses ?? 0) < 1
  ) {
    throw new DvarApprovalGrantError(
      "Approval grant claims are incomplete",
      "approval.grant_invalid"
    );
  }
  return claims as DvarApprovalGrantClaims;
}

export interface HmacApprovalSignerOptions {
  secret: string | Uint8Array;
  issuer: string;
  keyId?: string;
  clock?: () => Date;
  clockToleranceSeconds?: number;
}

export function createHmacApprovalSigner(
  options: HmacApprovalSignerOptions
): DvarApprovalSigner {
  const secret = Buffer.from(options.secret);
  if (secret.byteLength < 32) {
    throw new DvarApprovalGrantError(
      "Approval signing secret must be at least 32 bytes",
      "approval.signing_key_weak"
    );
  }
  const clock = options.clock ?? (() => new Date());
  const toleranceMs = Math.max(options.clockToleranceSeconds ?? 5, 0) * 1000;

  return {
    issuer: options.issuer,

    issue(
      request: DvarApprovalRequest,
      issueOptions: DvarApprovalGrantIssueOptions
    ): DvarApprovalGrant {
      const now = clock();
      const requestExpiry = Date.parse(request.expiresAt);
      const requestedExpiry = issueOptions.expiresInSeconds === undefined
        ? requestExpiry
        : now.getTime() + Math.max(issueOptions.expiresInSeconds, 1) * 1000;
      const expiresAtMs = Math.min(requestExpiry, requestedExpiry);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
        throw new DvarApprovalGrantError(
          "Approval request has expired",
          "approval.request_expired"
        );
      }

      const maxUses = Math.min(
        Math.max(issueOptions.maxUses ?? request.maxUses, 1),
        request.maxUses
      );
      const resolvedKeyId = issueOptions.keyId ?? options.keyId;
      const claims: DvarApprovalGrantClaims = {
        version: "1",
        id: randomUUID(),
        requestId: request.id,
        issuer: options.issuer,
        ...(resolvedKeyId !== undefined ? { keyId: resolvedKeyId } : {}),
        approver: issueOptions.approver,
        scope: request.scope,
        bindings: request.bindings,
        bindingHash: sha256(request.bindings),
        policyHash: request.policyHash,
        policyVersion: request.policyVersion,
        ruleId: request.ruleId,
        issuedAt: now.toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        nonce: randomUUID(),
        maxUses
      };
      const payload = encode(canonicalJson(claims));
      const signingInput = `${TOKEN_PREFIX}.${payload}`;
      const token = `${signingInput}.${signature(secret, signingInput).toString("base64url")}`;
      return { token, claims };
    },

    verify(token: string): DvarApprovalGrantClaims {
      if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
        throw new DvarApprovalGrantError(
          "Approval grant is too large",
          "approval.grant_invalid"
        );
      }
      const parts = token.split(".");
      if (
        parts.length !== 3
        || parts[0] !== TOKEN_PREFIX
        || parts[1] === undefined
        || parts[2] === undefined
      ) {
        throw new DvarApprovalGrantError(
          "Approval grant format is invalid",
          "approval.grant_invalid"
        );
      }

      const signingInput = `${parts[0]}.${parts[1]}`;
      const expected = signature(secret, signingInput);
      let actual: Buffer;
      try {
        actual = Buffer.from(parts[2], "base64url");
      } catch {
        throw new DvarApprovalGrantError(
          "Approval signature is invalid",
          "approval.grant_invalid"
        );
      }
      if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
        throw new DvarApprovalGrantError(
          "Approval signature is invalid",
          "approval.grant_invalid"
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(decode(parts[1]));
      } catch {
        throw new DvarApprovalGrantError(
          "Approval grant payload is invalid",
          "approval.grant_invalid"
        );
      }
      const claims = validateClaims(parsed);
      if (claims.issuer !== options.issuer) {
        throw new DvarApprovalGrantError(
          "Approval issuer does not match",
          "approval.issuer_mismatch"
        );
      }
      if (sha256(claims.bindings) !== claims.bindingHash) {
        throw new DvarApprovalGrantError(
          "Approval binding hash is invalid",
          "approval.grant_invalid"
        );
      }

      const now = clock().getTime();
      const issuedAt = Date.parse(claims.issuedAt);
      const expiresAt = Date.parse(claims.expiresAt);
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
        throw new DvarApprovalGrantError(
          "Approval timestamps are invalid",
          "approval.grant_invalid"
        );
      }
      if (issuedAt > now + toleranceMs) {
        throw new DvarApprovalGrantError(
          "Approval grant is not active yet",
          "approval.grant_not_active"
        );
      }
      if (expiresAt <= now - toleranceMs) {
        throw new DvarApprovalGrantError(
          "Approval grant has expired",
          "approval.grant_expired"
        );
      }
      return claims;
    }
  };
}

export interface VerifyApprovalGrantOptions {
  action: DvarAction;
  request: DvarApprovalRequest;
  token: string;
  signer: DvarApprovalSigner;
  useStore: DvarApprovalUseStore;
}

export async function verifyAndConsumeApprovalGrant(
  options: VerifyApprovalGrantOptions
): Promise<DvarApprovalGrantClaims> {
  const claims = await options.signer.verify(options.token);
  if (
    claims.policyHash !== options.request.policyHash
    || claims.policyVersion !== options.request.policyVersion
    || claims.ruleId !== options.request.ruleId
  ) {
    throw new DvarApprovalGrantError(
      "Approval grant policy binding does not match",
      "approval.policy_mismatch"
    );
  }
  if (claims.scope !== options.request.scope) {
    throw new DvarApprovalGrantError(
      "Approval scope does not match",
      "approval.scope_mismatch"
    );
  }
  if (canonicalJson(claims.bindings) !== canonicalJson(options.request.bindings)) {
    throw new DvarApprovalGrantError(
      "Approval grant does not contain the required bindings",
      "approval.binding_mismatch"
    );
  }
  if (
    claims.maxUses > options.request.maxUses
    || (claims.scope === "once" && claims.maxUses !== 1)
  ) {
    throw new DvarApprovalGrantError(
      "Approval grant use count exceeds the request",
      "approval.grant_invalid"
    );
  }
  if (Date.parse(claims.expiresAt) > Date.parse(options.request.expiresAt)) {
    throw new DvarApprovalGrantError(
      "Approval grant outlives the request",
      "approval.grant_invalid"
    );
  }

  const currentBindings = approvalBindings(
    options.action,
    options.request.actionHash,
    Object.keys(claims.bindings)
  );
  if (
    sha256(currentBindings) !== claims.bindingHash
    || canonicalJson(currentBindings) !== canonicalJson(claims.bindings)
  ) {
    throw new DvarApprovalGrantError(
      "Approval grant is bound to a different action",
      "approval.binding_mismatch"
    );
  }

  const use = await options.useStore.consume(
    claims.nonce,
    claims.maxUses,
    claims.expiresAt
  );
  if (!use.accepted) {
    throw new DvarApprovalGrantError(
      use.reason === "expired"
        ? "Approval grant has expired"
        : "Approval grant has already been consumed",
      use.reason === "expired"
        ? "approval.grant_expired"
        : "approval.grant_replayed"
    );
  }
  return claims;
}
