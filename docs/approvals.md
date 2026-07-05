# Dvar Approval Security

Dvar approvals are deterministic, bounded authorization artifacts. They are not generic confirmation dialogs and do not replace application authorization.

## Lifecycle

1. Policy returns `require_approval`.
2. Dvar creates a structured `DvarApprovalRequest`.
3. A provider returns `pending`, `approved`, or `rejected`.
4. Approval produces a signed grant bound to the request.
5. The action is normalized again and the grant is verified.
6. The use store atomically consumes the grant nonce.
7. Only then does Dvar return `allow` and permit execution.

## Scopes

### `once`

Binds the semantic action hash and permits exactly one execution. This is the default and recommended scope for financial, destructive, identity, secret, and production actions.

### `session`

Requires `session.id`. Policy may omit arguments or resources from `bind` to approve a narrowly defined class of calls within the same session. It remains bounded by expiry and `maxUses`.

### `task`

Requires `task.id` and follows the same bounded class-of-actions model within one task.

Dvar does not provide an ordinary “approve everything” scope.

## Mandatory bindings

Every grant binds principal, agent, environment, server, and tool. Scope-specific identifiers are mandatory. Additional configured fields are canonicalized and hashed.

Default bindings also include tenant, endpoint, arguments, resources, and destination. Replacing the default set with a narrower explicit set is a security decision and should be reviewed as policy code.

## Reference grant format

The reference signer emits a compact, versioned token containing canonical claims and an HMAC-SHA256 signature. Claims include issuer, optional key identifier, approver, scope, binding hash, policy hash/version, rule, issued time, expiry, nonce, and maximum use count. Raw arguments are not placed in the grant.

The compact format is pre-1.0 and may evolve with migration guidance.

## Use stores

`InMemoryApprovalUseStore` is process-local. It is correct only when one process is the sole enforcement authority. A distributed deployment must implement `DvarApprovalUseStore.consume` with an atomic check-and-increment operation and shared expiry state.

Dvar must not silently substitute the in-memory store for a declared distributed enforcement requirement.

## Provider failure

The default is fail closed. `runtime.onApprovalProviderError: allow` is an explicit fail-open policy and is ignored by strict mode. Provider failure and rejection are distinct outcomes.

## Webhook provider

The reference provider posts a versioned structured request over HTTPS. Loopback HTTP is allowed for development. The response must declare `pending`, `approved`, or `rejected`; an approved response must include a signed grant.

The approval service, not the requesting agent, must control signing keys.

## MCP

The approval-aware proxy can submit requests automatically. A delayed grant is supplied through `X-Dvar-Approval-Grant`. The header is never included in the upstream header allowlist.

## Privacy

Approval requests may contain material arguments because reviewers need to understand the action. Treat provider traffic and storage as sensitive. Default Dvar audit events record identifiers, hashes, status, scope, and approver—not raw arguments or grant tokens.

## Operational requirements

- keep signing keys out of agent context and model prompts;
- use at least 32 random bytes for HMAC secrets;
- rotate keys through issuer and key identifier conventions;
- authenticate the approval interface and provider endpoint;
- display material arguments and affected resources;
- show whether the action is reversible;
- cap expiry and use count;
- monitor rejection, replay, and provider-error rates;
- preserve separation of duties for critical actions.
