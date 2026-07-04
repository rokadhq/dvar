# API Stability

Dvar is currently pre-1.0.

Deliberate contracts include terminal effects, enforcement modes, approval scopes, runtime metrics and scope dimensions, side-effect-free `evaluate()`, execution-time `authorize()`, stdio executable identity fields, stdio `shell: false` execution, versioned records, and machine-readable reason codes.

The stdio supervisor policy shape, package metadata discovery, runtime-store interface, Redis/Valkey adapters, quota reservation semantics, loop fingerprints, circuit-breaker outcome interpretation, approval formats, MCP integration, and framework adapters remain experimental before 1.0. Breaking changes require release notes and migration guidance.
