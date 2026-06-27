## 33. Storage Interfaces

Dvar should define pluggable interfaces for:

- distributed quotas and counters;
- approval grants and nonces;
- policy bundles;
- audit delivery;
- inventory state;
- replay capture.

Initial implementations:

- in-memory for development and single-process use;
- Redis or Valkey for distributed counters and ephemeral grants;
- filesystem for local policy, lockfile, and replay;
- webhook for approval and audit integration;
- OpenTelemetry Protocol for observability.

Production documentation must distinguish development stores from horizontally scalable stores.

---

## 34. Performance and Reliability Targets

These are engineering targets, not unconditional marketing guarantees.

### 34.1 Policy evaluation

For local deterministic policy without external dependencies:

- p50 under 1 ms;
- p95 under 2 ms;
- p99 under 5 ms;

measured on a documented reference environment with a representative policy set.

### 34.2 Runtime behavior

Dvar must:

- keep the decision path non-blocking where possible;
- bound queues and buffers;
- bound parsing depth and payload sizes;
- avoid per-call policy recompilation;
- avoid synchronous network dependencies for ordinary decisions;
- isolate telemetry failures;
- expose runtime health;
- support graceful shutdown and telemetry drain;
- provide backpressure or explicit dropping behavior;
- avoid unbounded high-cardinality metrics.

### 34.3 Time budgets

Policy can define:

```yaml
runtime:
  maxDecisionMs: 10
  onDecisionTimeout: deny
```

Timeout behavior must be explicit and observable.

---

## 35. Security Requirements for Dvar Itself

Dvar is security-sensitive infrastructure and must be developed accordingly.

Required practices:

- strict TypeScript;
- no implicit `any` in stable code;
- schema validation at trust boundaries;
- constant-time comparison for sensitive hashes or signatures where applicable;
- secure random identifiers;
- canonical serialization before hashing;
- dependency minimization;
- lockfile and provenance checks;
- secret-free logs;
- fuzzing for parsers and matchers;
- property tests for policy precedence;
- malicious fixture suites;
- documented threat model;
- security reporting process;
- signed or provenance-backed release artifacts where feasible;
- SBOM generation;
- reproducible package-content checks;
- supported-version policy;
- explicit experimental API labels.

Dvar must never use `eval`, dynamically execute policy code, or construct shell commands from untrusted strings in its core runtime.

---

## 36. Failure Model

Dvar must distinguish:

- policy denial;
- approval requirement;
- invalid action;
- integrity failure;
- dependency unavailability;
- decision timeout;
- adapter failure;
- tool execution failure;
- output-policy failure;
- telemetry failure;
- internal Dvar defect.

Applications must be able to handle these categories separately.

Representative configuration:

```yaml
runtime:
  onEvaluationError: deny
  onDecisionTimeout: deny
  onOutputFilterError: deny
  onTelemetryError: continue
  onApprovalProviderError: deny
```

Monitor mode records the effective enforcement outcome while allowing execution, except where an application explicitly installs a non-bypassable emergency guardrail.

---

## 37. Open-Source and Enterprise Boundary

### 37.1 Open-source runtime

The open-source project should include:

- policy engine;
- YAML and JSON policy;
- schema validation;
- function-tool interceptor;
- MCP Streamable HTTP proxy;
- stdio supervisor;
- scanner;
- lockfile;
- diff;
- argument constraints;
- output constraints;
- local and distributed runtime limits;
- approval interfaces;
- webhook approval reference implementation;
- replay;
- policy tests;
- OpenTelemetry export;
- local audit events;
- documentation and examples.

### 37.2 Hosted and enterprise capabilities

Commercial offerings may include:

- central policy management;
- signed policy distribution;
- organization-wide server and tool inventory;
- managed approval application;
- SSO and SCIM;
- enterprise RBAC;
- separation of duties;
- immutable audit retention;
- policy analytics;
- anomaly detection;
- compliance mappings and reports;
- SIEM and ticketing integrations;
- private control-plane deployment;
- fleet-wide configuration;
- managed MCP gateway;
- enterprise support and service-level agreements.

### 37.3 Open-core rule

The community runtime must remain independently useful and secure. Rokad must not reserve basic enforcement correctness, local policy, lockfile verification, or audit generation exclusively for a paid tier.

---

## 38. Relationship with Dhal and AI Trace

### 38.1 Dhal

Dhal protects the inbound application request path.

Dvar protects outbound agent action execution.

The products should share design principles where appropriate:

- monitor-first rollout;
- deterministic policy;
- route/tool-level controls;
- explicit failure behavior;
- replay;
- readiness checks;
- OpenTelemetry;
- privacy defaults;
- stable configuration contracts;
- no silent downgrade.

They must remain independently installable.

Potential future integration:

```text
Inbound request
  -> Dhal request decision
  -> application / agent
  -> Dvar action decision
  -> external tool
```

Trace context should link the Dhal request decision to downstream Dvar action decisions.

### 38.2 AI Trace

AI tracing should be an observability subsystem and companion capability rather than the next independent flagship product.

Dvar may consume or expose shared instrumentation through:

```text
@rokadhq/dvar/otel
```

A future standalone `@rokadhq/ai-trace` may remain possible, but Dvar must not depend on a proprietary tracing backend.

---

## 39. Initial Release Roadmap

### Version 0.1 — Core enforcement

- canonical action model;
- YAML and JSON policy;
- schema version 1 draft;
- allow, deny, and approval decisions;
- off, monitor, enforce, and strict modes;
- deterministic precedence;
- generic JavaScript tool wrapper;
- argument schema validation;
- basic capability model;
- structured decision events;
- CLI initialization, validation, doctor, and policy tests;
- local replay;
- MIT license;
- Node.js 20 or newer.

### Version 0.2 — MCP inventory and HTTP enforcement

- Streamable HTTP proxy;
- MCP tool discovery;
- inventory canonicalization;
- `dvar.lock.json`;
- scan, lock, and diff commands;
- unknown-tool and schema-change policy;
- MCP trace propagation;
- server and destination controls.

### Version 0.3 — Approval system

- approval provider interface;
- signed and bound approval grants;
- webhook reference provider;
- single-use and expiry enforcement;
- interruption and resume APIs;
- OpenAI Agents SDK adapter;
- approval audit events.

### Version 0.4 — Runtime safety

- quotas;
- depth and retry limits;
- loop detection;
- circuit breakers;
- Redis and Valkey stores;
- cost and monetary limits;
- distributed enforcement diagnostics.

### Version 0.5 — Stdio and local-tool hardening

- stdio supervisor;
- executable identity;
- command and environment policy;
- filesystem root restrictions;
- process timeouts;
- sandbox integration guidance;
- local package integrity metadata.

### Version 0.6 — Output security and observability

- output constraints;
- field redaction;
- data-classification hooks;
- OpenTelemetry traces, logs, and metrics;
- privacy profiles;
- bounded audit delivery;
- cross-product trace correlation with Dhal.

### Version 0.7 — Framework ecosystem

- Vercel AI SDK adapter;
- additional TypeScript adapters;
- adapter conformance suite;
- starter integrations;
- expanded examples.

### Version 0.8 — Python

- language-neutral policy contract;
- Python runtime;
- MCP and framework adapters;
- cross-language conformance tests.

### Version 0.9 — Production stabilization

- performance budgets;
- fuzz and property-test expansion;
- compatibility matrix;
- migration tooling;
- release integrity;
- support policy;
- external security review;
- stable API candidate.

### Version 1.0 — Stable contract

- stable package exports;
- stable CLI inventory;
- stable schema version 1;
- documented compatibility guarantees;
- production deployment guide;
- upgrade policy;
- complete security boundary documentation;
- public readiness and release-integrity checks.

---
