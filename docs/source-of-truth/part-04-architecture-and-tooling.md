## 26. Architecture

### 26.1 Core components

#### Policy loader and validator

Loads YAML or JSON, validates schema, resolves includes where allowed, rejects ambiguous configuration, and produces a canonical policy representation.

#### Policy compiler

Converts validated policy into an immutable, optimized evaluation structure. Compilation occurs at startup or controlled reload, not on every action.

#### Decision engine

Evaluates normalized actions deterministically and returns a decision plus obligations.

#### Action normalizer

Converts framework- and protocol-specific calls into the canonical action model.

#### Capability classifier

Combines built-in heuristics, adapter knowledge, administrator declarations, and optional external signals to classify tools.

#### MCP scanner

Discovers servers and tools, canonicalizes definitions, and creates inventory data.

#### Integrity manager

Generates and verifies `dvar.lock.json`.

#### Approval orchestrator

Creates approval requests, validates grants, prevents replay, and resumes or rejects paused actions.

#### Runtime guard

Tracks quotas, depth, retries, execution time, loops, and circuit breakers.

#### Output guard

Applies post-execution redaction, size constraints, provenance, and output policy.

#### Audit and telemetry pipeline

Emits bounded structured events and traces while applying privacy policy.

#### Replay engine

Re-evaluates captured calls against policy without executing tools.

#### CLI

Provides initialization, inspection, validation, scanning, testing, replay, proxy, and release diagnostics.

### 26.2 Synchronous decision path

The synchronous path must be small and predictable:

```text
normalize
  -> verify required context
  -> verify integrity state
  -> validate arguments
  -> evaluate policy
  -> apply obligations
  -> allow / deny / pause
```

Network calls and model calls must not be required for ordinary local policy evaluation.

### 26.3 Optional asynchronous analysis

Asynchronous systems may:

- enrich tool classifications;
- detect anomalies;
- recommend policy;
- summarize incidents;
- produce compliance reports.

Their outputs are signals or administrative recommendations unless explicitly converted into reviewed policy.

---

## 27. Integration Modes

### 27.1 Embedded function interceptor

Applications wrap ordinary tools:

```ts
import { createDvar } from "@rokadhq/dvar";

const dvar = await createDvar({
  policyPath: "dvar.yaml"
});

const protectedRefund = dvar.protectTool({
  name: "billing.issue_refund",
  capabilities: ["finance.refund"],
  inputSchema: refundSchema,
  execute: issueRefund
});
```

### 27.2 Explicit inspection API

```ts
const decision = await dvar.evaluate(action);

if (decision.effect === "deny") {
  throw new DvarDeniedError(decision);
}
```

### 27.3 MCP Streamable HTTP proxy

```bash
dvar proxy \
  --policy dvar.yaml \
  --upstream https://mcp.example.com/mcp \
  --listen 127.0.0.1:4319
```

### 27.4 MCP stdio supervisor

```bash
dvar stdio \
  --policy dvar.yaml \
  -- command --arg value
```

The CLI must avoid shell interpolation when direct executable and argument forms are available.

### 27.5 Agent-framework adapters

Adapters should improve context propagation and approval handling for supported frameworks while preserving the framework-independent core.

Initial priority:

1. generic JavaScript function tools;
2. MCP Streamable HTTP;
3. MCP stdio;
4. OpenAI Agents SDK;
5. Vercel AI SDK;
6. additional TypeScript frameworks;
7. Python SDK and adapters.

---

## 28. Package and Repository Structure

Dvar should use a monorepo internally while avoiding unnecessary public package fragmentation.

Suggested structure:

```text
apps/
  docs/
  playground/

packages/
  dvar/
  core/
  policy/
  mcp/
  cli/
  otel/
  approvals/
  testkit/
  adapters/
    openai-agents/
    vercel-ai/

examples/
  basic-tools/
  mcp-http-proxy/
  mcp-stdio/
  approval-webhook/
  multi-tenant/
  production-policy/

docs/
  source-of-truth.md
  threat-model.md
  policy-reference.md
  mcp-security.md
  deployment.md
  privacy.md
  support-policy.md
  api-stability.md
```

The primary public installation should remain:

```bash
npm install @rokadhq/dvar
```

Stable subpath exports may include:

```text
@rokadhq/dvar
@rokadhq/dvar/mcp
@rokadhq/dvar/otel
@rokadhq/dvar/approvals
@rokadhq/dvar/testkit
```

Separate public packages should be introduced only when their dependency or release lifecycle materially differs.

---

## 29. CLI Contract

Initial commands:

```bash
dvar init
dvar validate
dvar doctor
dvar inspect
dvar scan
dvar lock
dvar diff
dvar test-policy
dvar replay
dvar proxy
dvar stdio
dvar approvals
dvar readiness
dvar report
dvar version
```

### `dvar init`

Creates:

- starter policy;
- policy schema reference;
- empty or generated lockfile;
- example test fixture;
- recommended `.gitignore` entries;
- integration instructions.

### `dvar validate`

Validates syntax, schema, rule references, matcher types, impossible conditions, duplicate IDs, and unsafe configuration.

### `dvar doctor`

Checks runtime prerequisites, package compatibility, policy loading, lockfile state, approval provider, stores, telemetry, and integration configuration.

### `dvar scan`

Discovers tools and produces an inventory without changing the lockfile unless explicitly requested.

### `dvar lock`

Creates or updates `dvar.lock.json` through an explicit operation.

### `dvar diff`

Compares observed inventory with the lockfile and returns human- and machine-readable risk classifications.

### `dvar test-policy`

Runs declared policy tests and exits non-zero on failure.

### `dvar replay`

Evaluates captured calls without executing tools.

### `dvar proxy`

Runs the Streamable HTTP policy proxy.

### `dvar stdio`

Runs a local MCP server under Dvar supervision.

### `dvar readiness`

Checks whether the configuration satisfies production guidance.

---

## 30. Policy Testing

Policies are security code and must be testable.

Example:

```yaml
tests:
  - name: support can read own tenant
    action:
      principal.id: user-1
      agent.id: support-agent
      tenant.id: tenant-a
      environment: production
      tool.name: crm.read_customer
      resource.tenantId: tenant-a
    expect:
      effect: allow
      ruleId: support.read-customer

  - name: support cannot read another tenant
    action:
      principal.id: user-1
      agent.id: support-agent
      tenant.id: tenant-a
      environment: production
      tool.name: crm.read_customer
      resource.tenantId: tenant-b
    expect:
      effect: deny

  - name: large credit requires approval
    action:
      principal.id: user-1
      agent.id: support-agent
      tenant.id: tenant-a
      environment: production
      tool.name: billing.apply_credit
      arguments:
        amount: 5000
    expect:
      effect: require_approval
```

The test engine must produce stable output suitable for CI.

---

## 31. Replay

Dvar replay fixtures should use JSON Lines for streaming and bounded processing.

A replay record should include:

- normalized action;
- original decision if available;
- policy version;
- timestamp;
- redacted result metadata;
- no live credentials;
- no executable approval grant.

Replay must never execute the tool.

Primary uses:

- migrate from monitor to enforce;
- compare policy versions;
- identify false positives;
- test newly added rules;
- demonstrate incident behavior;
- validate compatibility before upgrading Dvar.

---

## 32. Audit and Telemetry

### 32.1 Event types

Initial events:

- `dvar.action.proposed`
- `dvar.action.allowed`
- `dvar.action.denied`
- `dvar.action.approval_required`
- `dvar.action.approved`
- `dvar.action.rejected`
- `dvar.action.started`
- `dvar.action.completed`
- `dvar.action.failed`
- `dvar.integrity.mismatch`
- `dvar.tool.discovered`
- `dvar.tool.changed`
- `dvar.policy.loaded`
- `dvar.policy.failed`
- `dvar.runtime.limit_exceeded`
- `dvar.runtime.internal_error`

### 32.2 Event properties

Events should include:

- event and decision IDs;
- trace and span IDs;
- timestamp;
- principal, agent, tenant, session, and task identifiers subject to redaction;
- environment;
- server and tool;
- capabilities;
- risk level and signals;
- decision effect;
- rule and reason code;
- policy version and hash;
- action hash;
- obligation summary;
- duration;
- execution outcome;
- privacy and redaction metadata.

### 32.3 OpenTelemetry

Dvar should emit OpenTelemetry-compatible traces, logs, and metrics and align with the evolving OpenTelemetry GenAI and MCP semantic conventions.

Dvar-specific attributes should use a stable namespace such as:

```text
dvar.decision.effect
dvar.decision.rule_id
dvar.decision.reason_code
dvar.policy.version
dvar.policy.hash
dvar.action.hash
dvar.risk.level
dvar.risk.score
dvar.approval.id
dvar.integrity.status
```

Where an applicable standard attribute exists, Dvar should use it rather than creating a duplicate.

### 32.4 Privacy defaults

By default Dvar should:

- omit raw prompt and completion content;
- omit raw secrets and authorization headers;
- omit full tool output;
- mask or hash principal and resource identifiers when configured;
- record argument field names and classifications rather than values;
- permit bounded opt-in capture for debugging;
- attach a visible warning to unsafe capture modes.

### 32.5 Delivery guarantees

Telemetry must be bounded and isolated from decisions.

A telemetry failure must not crash the host application. Required audit delivery, when configured, must have an explicit failure policy rather than silently dropping records.

---
