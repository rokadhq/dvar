# API Stability

Dvar is currently pre-1.0.

The following are deliberate contracts but may still evolve with documented migration guidance:

- terminal effects: `allow`, `deny`, `require_approval`;
- modes: `off`, `monitor`, `enforce`, `strict`;
- approval scopes: `once`, `session`, `task`;
- canonical policy file: `dvar.yaml` with JSON support;
- canonical inventory file: `dvar.inventory.json`;
- canonical lockfile name: `dvar.lock.json`;
- versioned policy, inventory, lockfile, and approval request records;
- stable machine-readable reason codes.

The approval-provider interfaces, use-store interface, compact grant format, MCP integration, and framework adapters are experimental before 1.0. Breaking changes require release notes and migration guidance.
