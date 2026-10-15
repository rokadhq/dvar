# Slice 04 — Verified identity and resource ownership

**Development only. F11 and F09 in progress. No merge or publication authorization.**

Base: `feat/v1-opentelemetry-foundation` / PR #10 at
`3899dd612e101a7fae64c759be6f2fbbbcb19b62`. CI investigation remains deferred.

## Implemented

- Opt-in `@rokadhq/dvar/authority` and `createAuthorityBoundary()` with trusted application identity verification.
- Explicit issuer/audience/environment checks, canonical principal/agent/tenant/session/task mapping, roles,
  trust labels, assertion activation/expiry/age validation, no model-to-identity promotion and no identity cache.
- Resource selectors owned by the application, explicit owner/tenant/no-resource modes, tenant isolation,
  bounded references and authoritative resource versions/ownership/freshness checks.
- Immutable JSON snapshots before asynchronous work; actual Dvar protected-tool pipeline delegation.
- Fresh identity and ownership/version rechecks inside the protected executor boundary, after policy/approval
  processing and immediately before the application executor. Existing quotas are not reserved twice.
- Non-executing `.evaluate()` with no approval-grant consumption; verified identity projection and resource
  versions participate in the existing semantic action/once-approval hash.
- Provider deadlines, total preparation/dispatch phase deadlines, abort propagation, bounded pending checks
  retained until actual provider settlement, fail-closed clock rollback and no stale/provider-error fallback.
- Fixed privacy-safe authority error codes, bounded source/stage/count diagnostic events and no raw
  credentials, grants, identity/resource IDs or provider exception payloads in that projection.
- Tests, real-SQLite ownership/conditional-write fixture, actual-runtime integration cases, docs and exports.

## Verification actually performed

Environment: Node.js 22.16.0, TypeScript 5.8.3, embedded SQLite 3.49.1.

- Strict compilation and declarations for the eight authority modules passed in ESM and CommonJS, with exact
  optional properties, unchecked indexed access and unused checks. Imports were compiled against the exact
  repository `types.ts` and `canonical.ts` (Git blob hashes independently matched before compiling).
- **138 contract tests passed in ESM and the same 138 in CommonJS:** 276 successful format-specific executions,
  with zero failures, cancellations or skips. This suite uses an explicitly labeled runtime protocol harness,
  not the complete Dvar runtime.
- **Six real SQLite-backed tests passed.** Two connections to a temporary database exercise ownership change,
  session revocation, tenant scoping and conditional updates. In 25 concurrent writes admitted against one
  revision, exactly one conditional mutation succeeds and 24 reject the stale revision. The SQLite database
  is real; the outer Dvar policy pipeline in this fixture remains the contract harness.
- JavaScript syntax checks passed for the actual-runtime Vitest suite, SQLite fixture and package runner.
- Six modified parent metadata/tracker files were reconstructed from retrieved content and matched byte-for-byte
  to the live branch's Git blob hashes. Only F09/F11 change status/evidence; all 55 acceptance criteria,
  dependencies, earlier evidence and release approval fields remain unchanged.

**Not executed here:** the ten actual-Dvar-runtime Vitest cases, complete repository/tsup package build, package
installation consumers, supported Node-version matrix, real external identity/JWT/session service integrations,
production ownership stores and remote provider failure qualification. Dependency downloads are unavailable.
GitHub CI was not polled, retried or dispatched. The separately executed SQLite fixture uses Node's experimental
SQLite module; it is not a new core dependency or a claim of Node-20 fixture compatibility.

## Important boundaries

This is not an issuer, OIDC/JWT verifier, distributed lease or delegated-grant implementation. Application
verifiers must authenticate evidence, check revocation, authorize the principal/agent relationship and map
issuer-local subjects into canonical identities. Unwrapped runtimes/tools, MCP, stdio and direct workflows
are not automatically intercepted; their boundary integrations remain required.

Preflight and dispatch rechecks do not atomically authorize an external effect. Application executors must
apply tenant/owner/version conditions in the same database operation/transaction as the effect. The SQLite
fixture explicitly demonstrates a change AFTER the last wrapper check being stopped by the executor's CAS,
not by claiming the wrapper eliminates the race. Multi-resource transactions and production DB adapters
remain unqualified.

Authentication/ownership failure is fail-closed in every Dvar mode. Dvar policy monitor/off behavior still
applies inside the existing runtime. Quota or grant consumption can precede a later dispatch-check failure;
this is not rolled back. Such failures currently appear to the core as protected-executor failures and may
influence circuit-breaker outcomes. Detailed pre-dispatch outcome classification remains follow-up work.

Callbacks must cooperate with abort signals. Same-process code cannot preempt synchronous blocking code or
undo a committed effect. Diagnostic sinks are best-effort and bounded, not a delivery-guaranteed audit ledger.

Tracker: **F01, F02, F09, F11, F53 and F55 in progress; 49 planned; 0 verified.** Publication remains on hold.
