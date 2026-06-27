# API Stability

Dvar is currently pre-1.0.

The following are deliberate contracts but may still evolve with documented migration guidance:

- terminal effects: `allow`, `deny`, `require_approval`;
- modes: `off`, `monitor`, `enforce`, `strict`;
- canonical policy file: `dvar.yaml` with JSON support;
- canonical inventory file: `dvar.inventory.json`;
- canonical lockfile name: `dvar.lock.json`;
- policy schema version, inventory version, and lockfile version fields;
- stable machine-readable reason-code namespace;
- explicit lockfile updates: scanning does not mutate approval state.

The MCP scanner, proxy API, inferred capability vocabulary, inventory-diff taxonomy, and lockfile record fields are experimental in 0.2. They may be refined before 1.0, but breaking changes require release notes and migration guidance.

A stable 1.x release will preserve valid schema-version-1 policies within the documented compatibility guarantees.
