# Changelog

All notable changes to Dvar are documented here. Dvar follows prerelease semantic versioning until 1.0.

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
