# Verified identity and resource ownership

`@rokadhq/dvar/authority` is an **opt-in application enforcement boundary** for F11 and F09.
It authenticates identity through an application-owned verifier, resolves resource ownership through a
trusted provider, and routes execution through the existing Dvar `protectTool()` pipeline. It is not
an identity provider, token parser, database proxy, or a replacement policy engine.

## Trust model

A caller supplies opaque credentials separately from model-visible arguments. The verifier must authenticate
those credentials, validate their issuer/key binding and intended audience, check current validity/revocation,
and return **canonical application** principal, agent, tenant, session and task identities. The provider must
verify that the principal is authorized to operate as the returned agent. Merely decoding a JWT or copying
headers/model fields is not authentication. Mapping issuer-local subjects into canonical application IDs is
part of the verifier; identical `sub` strings from different issuers must not accidentally identify one owner.

The boundary independently checks the configured issuer allowlist, audience and environment; known principal
and trust types; bounded role lists; issuance, activation, expiry and maximum assertion age. Verification runs
for every call and again immediately before dispatch. Claims must remain identical between these checks.
This version does not implement JWT/OIDC discovery, signature validation, credential issuance or delegation.

Identity assertions use UTC epoch **milliseconds**: `issuedAtMs`, `expiresAtMs`, optional `notBeforeMs`.
Issuance is stable for the assertion, not the latest cache lookup time. Returning a freshly fabricated issuance
time on every verifier call causes the dispatch consistency check to fail. Session providers should use a
stable assertion revision and a configured maximum age appropriate to their authenticated session contract.

`untrusted`, `restricted`, and `trusted` are explicit labels, not automatic privilege ranks. A tool can restrict
`allowedTrustLevels` and require principal roles. Its Dvar action policy remains necessary. No model-supplied
role, owner, tenant, trust label or `trusted: true` flag is promoted into verified identity.

## Wrap an existing runtime

Applications supply their real authentication and resource services. This factory is a complete typed wrapper;
its dependencies are injected, not placeholder authentication implementations.

```ts
import {
  createAuthorityBoundary,
  type DvarAuthorityRuntime,
  type DvarIdentityVerifier,
  type DvarOwnershipProvider,
} from "@rokadhq/dvar/authority";

export function secureOrderUpdates(
  runtime: DvarAuthorityRuntime,
  identityVerifier: DvarIdentityVerifier,
  ownershipProvider: DvarOwnershipProvider,
  updateIfCurrent: (input: {
    id: string; tenantId: string; ownerId: string;
    expectedVersion: string; note: string;
  }) => Promise<{ updated: boolean }>,
) {
  const authority = createAuthorityBoundary({
    runtime,
    identityVerifier,
    ownershipProvider,
    allowedIssuers: ["app-session-service"],
    audience: "orders-api",
    environment: "production",
  });

  return authority.protectTool<{ id: string; note: string }, { updated: boolean }>({
    name: "orders.update-note",
    capabilities: ["data.write"],
    requiredRoles: ["operator"],
    allowedTrustLevels: ["restricted", "trusted"],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 }, note: { type: "string" } },
      required: ["id", "note"],
      additionalProperties: false,
    },
    resources: {
      mode: "owner",
      select: args => [{ type: "order", id: args.id, operation: "write" }],
    },
    execute: async (args, context) => {
      const resource = context.resources[0];
      if (!resource) throw new Error("Expected a verified order");
      return updateIfCurrent({
        id: resource.id,
        tenantId: context.identity.tenantId,
        ownerId: context.identity.principal.id,
        expectedVersion: resource.version,
        note: args.note,
      });
    },
  });
}
```

Call the returned function with `(arguments, { credential, signal?, approvalGrant? })`. Never obtain that
credential or approval grant from tool arguments. The application should discard raw/unwrapped executor and
runtime references from agent-facing code. Nothing in this optional wrapper intercepts those references.

## Ownership provider and conditional effects

Each resource-sensitive definition must explicitly select `mode: "owner"` or `mode: "tenant"` and a synchronous,
application-owned selector returning 1–16 exact `{ type, id, operation }` references. Empty, duplicate, malformed
or asynchronous selections are denied. A non-resource tool must explicitly declare `{ mode: "none" }`.
The selector must enumerate **every** resource the executor actually touches. It receives snapshotted JSON
arguments; native Dvar input-schema validation still runs in `protectTool()`, so selectors must handle malformed
input safely. Arguments are not rewritten between policy checking and execution.

The provider returns `{ type, id, tenantId, ownerId, version, observedAtMs, validUntilMs, classification? }`.
It must load authoritative data keyed/scoped by canonical tenant identity, not trust caller-supplied ownership.
Both modes require the exact tenant. Owner mode additionally requires the authenticated principal to own the
resource. Tenant mode is an explicit application choice, not a cross-tenant override or an admin-role inference.
Missing records, wrong tenant, wrong owner and reference substitutions produce the same outward denial code.

Before dispatch, the boundary reauthenticates and rereads every resource, rejects changed versions/owners/
classifications, and checks freshness again after all awaits. Verified resource references and executor input
are immutable snapshots. The executor receives the expected revisions.

**Rechecking alone is not an atomic database authorization.** The backing operation must compare tenant,
owner and expected revision in the same conditional update/transaction that applies the effect. For example:

```sql
UPDATE orders
SET note = ?, version = version + 1
WHERE id = ? AND tenant_id = ? AND owner_id = ? AND version = ?;
```

Require exactly one changed row. Treat zero rows as a conflict, not permission to retry without conditions.
Use equivalent row-level policy/transactions for reads, deletions and multi-resource operations. Version tokens
must change when ownership or the protected state changes; a provider that reuses versions can undermine
check/use protection. This slice provides an adapter contract and a real SQLite conditional-write fixture,
not production database adapters or a general transaction manager.

## Policy and approval behavior

The existing Dvar runtime still owns policies, schemas, approvals, quotas, circuit outcomes and output filtering.
There is no extra `authorize()` call and no repeated quota reservation introduced by the wrapper. A late
identity/ownership denial can occur **after** Dvar has reserved quota or consumed a grant; it does not roll that
state back. In this initial integration the runtime sees a dispatch-check failure as a protected-executor error,
which can affect circuit-breaker outcomes. Granular pre-dispatch outcome classification remains follow-up work.

`tool.evaluate(arguments, { credential, signal? })` prepares the same canonical action and delegates only to
`runtime.evaluate()`. It never invokes an executor or supplies a grant for consumption. Authentication and
ownership-provider reads still occur and must be non-mutating. Preview is not a transferable execution permit.
Pass its `decision.approvalRequest` to the application's existing authorized review flow, then supply the approved
signed grant outside arguments on the eventual invocation. The boundary itself never signs or auto-approves.

Verified identity source, issuer, audience, agent roles/trust and assertion lifetime appear in
`principal.claims.dvarAuthority`; these participate in Dvar's existing semantic action hash. Resource snapshots
contain `version` and `operation` in addition to normal resource identity/ownership fields. Once-scope grants
therefore bind the reviewed identity and resource revisions. Custom broader session/task grant bindings retain
their existing documented semantics; do not assume every field is bound after deliberately narrowing `bind`.
Ownership is always checked again regardless of grant scope.

The authority checks are independent authentication/ownership gates. They fail closed even when the supplied
Dvar policy uses `monitor`, `off`, or a policy-evaluation fail-open setting. Those modes continue to control
Dvar policy behavior; they are not permission to impersonate a user or cross tenant boundaries.

## Limits and diagnostics

Defaults: 2-second provider deadline, 10-second preparation/dispatch phase deadline, 128 pending provider
checks, 5-minute maximum identity assertion age, 5-second ownership observation age and 64 KiB JSON arguments.
The phase timer applies separately to preparation and dispatch, not to the business executor. JSON snapshots
also bound depth (32), nodes (4096), reject cycles/accessors/classes/symbols, and copy input before the first await.
Absolute expiry is exclusive. Clock rollback fails closed. There is no assertion/ownership cache or silent
fallback to caller data when a provider fails.

Provider timeouts and caller cancellation abort the supplied signal. A provider that ignores cancellation keeps
its capacity slot until its original promise settles; new work is refused rather than making unlimited abandoned
requests. Same-process JavaScript cannot preempt synchronously blocking application callbacks. Executors receive
the caller signal, but cancellation cannot undo a committed effect and does not forcibly terminate an executor.

Optional `eventSink` emits bounded source/stage/reason/count diagnostics without credentials, approval grants,
identity IDs, resource IDs or raw provider errors. It has at most 16 unresolved events and drops excess observations.
It never delays dispatch. This is not guaranteed audit delivery. Existing Dvar audit events retain their own privacy
contract; do not confuse this projection with redaction of application SDK exporters or arbitrary tool errors.
`diagnostics()` reports only pending checks, pending events and dropped-event counts.

## Qualification and references

This is development work under the no-release-before-v1 hold. See `v1/progress/slice-04-identity-ownership.md`
for exact verification and remaining work. Node's experimental SQLite API is used only in a separate development
fixture (Node >=22.13), never in the core package or the normal Node-20-compatible authority contract suite.

Design references reviewed on 2026-10-15:
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- RFC 8725, sections 3.8–3.10: https://www.rfc-editor.org/rfc/rfc8725.html

These references inform verifier/application responsibilities; this package does not claim JWT/OAuth conformance.
