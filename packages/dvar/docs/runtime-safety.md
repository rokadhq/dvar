# Dvar Runtime Safety

Dvar runtime safety constrains sequences of otherwise valid actions.

`evaluate()` is side-effect-free. Use `authorize()`, `protectTool()`, or the MCP proxy immediately before execution. Call `recordOutcome()` after manually authorized execution when circuit breakers are enabled.

Supported controls include task/session call ceilings, scoped call/cost/monetary quotas, depth and retry limits, consecutive-tool limits, repeated and alternating loop detection, and circuit breakers.

`InMemoryRuntimeStore` is valid for one process. Multi-instance deployments require a shared atomic store through `createRedisRuntimeStore()`, `createValkeyRuntimeStore()`, or another `DvarRuntimeStore` implementation.

Store failures deny by default. Explicit fail-open behavior is available only outside strict mode.

Counters are conservative reservations made before execution. Earlier reservations are not rolled back when a later control denies the same action.

Cost and monetary values must come from trusted accounting. MCP accounting and approval headers are consumed locally and are not forwarded upstream.

Runtime usage is included in default approval bindings, so changing reviewed usage invalidates the grant. Approval never bypasses runtime safety.
