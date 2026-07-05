# Changelog

All notable changes to Dvar are documented here. Dvar follows prerelease semantic versioning until 1.0.

## 0.6.0-alpha.0

### Added

- `@rokadhq/dvar/output-guard` export.
- Output classification, max-size enforcement, redaction, deny-pattern blocking, and built-in secret redaction.
- Protected-tool output filtering and MCP JSON/text response filtering.
- Bounded output-safety audit metadata.

### Security

- Denied output is not returned to protected-tool callers.
- Binary output is denied by default.
- Output summaries avoid raw sensitive values.

## 0.5.0-alpha.0

### Added

- `@rokadhq/dvar/stdio` export.
- Local process supervisor with executable identity, env policy, argument checks, cwd/path-root checks, timeouts, and output caps.
- Optional Dvar runtime authorization and outcome recording around local execution.

### Security

- Processes run with `shell: false`.
- Parent-process environment variables are not inherited by default.
- Environment values are not copied into normalized action arguments.

## 0.4.0-alpha.0

### Added

- Execution-time `authorize()`, runtime-state commits, outcome recording, and diagnostics.
- Task/session limits and scoped call, cost, and monetary quotas.
- Depth, retry, consecutive-tool, loop-detection, and circuit-breaker controls.
- In-memory and Redis/Valkey-compatible runtime stores.
- Runtime-aware protected-tool and MCP enforcement.
- Usage-bound approval grants and runtime audit metadata.
- `@rokadhq/dvar/runtime-safety` export.

### Security

- Policy previews do not consume runtime state.
- Strict mode fails closed on store unavailability.
- Multi-instance stateful enforcement requires a shared store.
- Runtime accounting headers are not forwarded through the MCP proxy.

## 0.3.0-alpha.0

### Added

- Structured approval requests and deterministic interruption/resume APIs.
- HMAC-SHA256 grants bound to policy, action context, scope, expiry, and use count.
- Bounded `once`, `session`, and `task` scopes.
- Pluggable approval-use stores and a webhook provider.
- Approval-aware MCP proxying and OpenAI Agents interruption helpers.
- Approval lifecycle audit events.

### Security

- Single-use replay resistance by default.
- Constant-time signature verification.
- Changed bound context invalidates a grant.
- Approval grants are removed before MCP forwarding and omitted from default audit events.
- Strict mode fails closed on provider unavailability.

## 0.2.0-alpha.0

- MCP inventory, lockfiles, integrity enforcement, and Streamable HTTP proxying.

## 0.1.0-alpha.0

- Deterministic core policy enforcement, tool wrappers, policy tests, and replay.
