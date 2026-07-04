# Changelog

All notable changes to Dvar are documented here. Dvar follows prerelease semantic versioning until 1.0.

## 0.5.0-alpha.0

### Added

- `@rokadhq/dvar/stdio` package export.
- Local process supervisor for stdio and subprocess tools.
- Executable realpath and SHA-256 identity inspection.
- Local package metadata discovery from `package.json`.
- Executable allowlisting by command, realpath, hash, package name, or package version.
- Command absolute-path enforcement.
- Argument count, allow-pattern, deny-pattern, NUL, and path-root checks.
- Environment allowlist and denylist checks.
- Cwd and path-argument root restrictions.
- Process timeouts and stdout/stderr output caps.
- Optional Dvar runtime authorization before spawning.
- Runtime outcome recording after supervised execution.

### Security

- Supervised processes run with `shell: false`.
- Parent-process environment variables are not inherited by default.
- Normalized stdio actions record environment keys, not environment values.
- Local process execution is denied before spawn when Dvar runtime policy denies the action.
- Stdio hardening is documented as a boundary, not as a sandbox replacement.

## 0.4.0-alpha.0

### Added

- Side-effect-free `evaluate()` and execution-time `authorize()` APIs.
- Runtime `commitRuntime`, `recordOutcome`, and `diagnostics` APIs.
- Task and session tool-call ceilings.
- Scoped call, cost, and monetary quotas with configurable windows.
- Depth, retry, and consecutive-tool limits.
- Repeated-action and alternating-action loop detection.
- Circuit breakers with closed, open, and half-open states.
- In-memory runtime store and Redis/Valkey-compatible adapters.
- Runtime-safety enforcement for protected tools and MCP `tools/call` requests.
- Runtime usage binding in approval requests and grants.
- Bounded runtime-control metadata in decision audit events.
- `@rokadhq/dvar/runtime-safety` package export.

### Security

- `evaluate()` does not consume quotas, preventing policy tests and previews from mutating enforcement state.
- Strict mode fails closed when the runtime state store is unavailable.
- Fail-open store behavior requires explicit policy outside strict mode.
- Multi-instance stateful enforcement rejects process-local stores.
- Approval grants are invalidated when reviewed cost or monetary usage changes.
- MCP accounting headers are consumed locally and are not forwarded upstream.

## 0.3.0-alpha.0

### Added

- Structured approval requests containing attributable action, policy, risk, scope, expiry, and binding data.
- HMAC-SHA256 signed approval grants with constant-time verification.
- Bounded `once`, `session`, and `task` approval scopes.
- Stable semantic action hashing for interruption and resume flows.
- Pluggable approval-use store with an in-memory reference implementation.
- Runtime `createApprovalRequest`, `requestApproval`, and `resume` APIs.
- Automatic protected-tool provider submission and immediate-grant resume.
- Webhook approval-provider reference implementation.
- Approval-aware MCP proxy with delayed-grant header consumption.
- Structural OpenAI Agents interruption helpers.
- `@rokadhq/dvar/approvals` and `@rokadhq/dvar/adapters/openai-agents` exports.
- Approval lifecycle audit events.

### Security

- Grants bind policy hash/version, rule, scope, identity, environment, tool, and configured action fields.
- One-time grants are single-use and action-exact by default.
- Expiry and use counts cannot exceed the originating request.
- Replayed, modified, expired, or context-mismatched grants are rejected before execution.
- Approval grants are omitted from default audit events and removed before MCP forwarding.
- Strict mode fails closed when an approval provider is unavailable.

## 0.2.0-alpha.0

### Added

- MCP Streamable HTTP scanner with initialization, session handling, negotiated protocol headers, and paginated `tools/list` discovery.
- Canonical `dvar.inventory.json` observations and explicit `dvar.lock.json` approval records.
- Risk-aware inventory diffing for server, tool, schema, metadata, capability, endpoint, and risk changes.
- Runtime integrity policy for unknown or changed servers and tools.
- MCP Streamable HTTP policy proxy for pre-execution `tools/call` enforcement.
- CLI commands: `scan`, `inspect`, `lock`, `diff`, and `proxy`.
- `@rokadhq/dvar/mcp` package export.

## 0.1.0-alpha.0

### Added

- Deterministic policy engine and canonical action model.
- `allow`, `deny`, and `require_approval` decisions.
- `off`, `monitor`, `enforce`, and `strict` modes.
- Generic function-tool wrapper and JSON Schema input validation.
- Privacy-conscious audit events, policy tests, replay, and core CLI.
