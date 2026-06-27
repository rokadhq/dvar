# Changelog

All notable changes to Dvar are documented here. Dvar follows prerelease semantic versioning until 1.0.

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
- MCP security and inventory-reference documentation.
- Integrity-aware policy testing with an explicit lockfile.

### Security

- Caller authorization is not forwarded by the MCP proxy unless explicitly enabled.
- Plain HTTP is accepted automatically only for loopback endpoints.
- Scanning never mutates the reviewed lockfile.
- Tool metadata and server capability claims remain untrusted inputs.

## 0.1.0-alpha.0

### Added

- Deterministic policy engine and canonical action model.
- `allow`, `deny`, and `require_approval` decisions.
- `off`, `monitor`, `enforce`, and `strict` modes.
- Generic function-tool wrapper and JSON Schema input validation.
- Privacy-conscious audit events, policy tests, replay, and core CLI.
