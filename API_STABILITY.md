# API Stability

Dvar is currently pre-1.0.

The following are treated as deliberate contracts but may still evolve with documented migration guidance:

- terminal effects: `allow`, `deny`, `require_approval`;
- modes: `off`, `monitor`, `enforce`, `strict`;
- canonical policy file: `dvar.yaml` with JSON support;
- canonical lockfile name: `dvar.lock.json`;
- policy schema version field;
- stable machine-readable reason-code namespace.

Experimental features will be clearly labeled. A stable 1.x release will preserve valid schema-version-1 policies within the documented compatibility guarantees.
