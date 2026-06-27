## 9. System Boundary

Dvar is positioned in the execution path between an action proposer and an action executor.

```text
User / Workflow / Application
              |
              v
      Model or Agent Runtime
              |
      proposed tool action
              |
              v
           Dvar
   identity + integrity + policy
              |
       +------+------+
       |             |
     deny      require approval
       |             |
       +------ or ---+
              |
            allow
              |
              v
 MCP Server / Function / API / Database / Browser / Shell
```

Dvar evaluates the proposed action before side effects occur.

Where technically possible, Dvar also observes the execution result to:

- confirm whether the call succeeded;
- classify output;
- redact or constrain data returned to the model;
- update quotas and failure counters;
- produce a complete audit record.

Dvar cannot reliably protect calls that bypass its interception boundary. Deployment documentation must state this clearly.

---

## 10. Trust Boundaries

Dvar must model at least these trust boundaries:

1. **User to agent**
2. **Application to model provider**
3. **Model output to tool-call parser**
4. **Agent runtime to Dvar**
5. **Dvar to MCP server or tool**
6. **MCP server to downstream API**
7. **Tool output back to the model**
8. **Tenant to tenant**
9. **Development to staging to production**
10. **Local process to network service**
11. **Policy author to policy distribution system**
12. **Approver to approval provider**
13. **Runtime to telemetry destination**

Every boundary may carry attacker-controlled or compromised data. No boundary receives implicit trust merely because it is internal.

---

## 11. Core Terminology

### Agent

A software actor that selects or proposes actions, usually with model assistance.

### Principal

The authenticated entity on whose behalf an action is being attempted. A principal may be a user, service account, workload, agent instance, or organization.

### Tool

A named capability exposed to an agent. A tool may be an MCP tool, function, API operation, command, browser action, database operation, or framework-specific callable.

### Server

The process or service that exposes one or more tools. For MCP this is an MCP server; for a generic adapter it may be an application module or remote service.

### Action

A normalized request to execute one tool with a specific set of arguments and context.

### Resource

The concrete object the action will affect, such as a file, repository, customer, invoice, database, cloud resource, domain, or account.

### Capability

A semantic description of what a tool can do, such as `data.read`, `data.write`, `code.execute`, `finance.transfer`, or `identity.admin`.

### Policy

A versioned declarative document containing rules and defaults used to evaluate actions.

### Rule

A conditional policy statement with an effect and optional obligations.

### Effect

The terminal policy result: `allow`, `deny`, or `require_approval`.

### Obligation

A constraint that must be applied before or during an allowed execution, such as redaction, argument transformation, throttling, timeout, output filtering, or additional audit capture.

### Decision

The complete structured outcome of evaluating an action.

### Approval grant

A cryptographically bound, time-limited authorization to execute one action or a narrowly defined class of actions.

### Lockfile

A machine-generated record of approved servers, tools, schemas, capabilities, and integrity metadata.

### Monitor mode

A mode that records enforcement outcomes without preventing execution.

### Replay

Evaluation of previously captured actions against policy without invoking the real tool.

---

## 12. Product Modes

Dvar must support four runtime modes.

### `off`

Dvar does not evaluate or intercept actions. This mode exists for controlled debugging and must produce a visible warning.

### `monitor`

Dvar evaluates actions and records the decision it would make, but it allows execution.

A monitor result must retain the underlying result:

- `would_allow`
- `would_deny`
- `would_require_approval`

### `enforce`

Dvar applies policy and blocks or pauses execution where required.

### `strict`

Dvar enforces policy and treats missing required context, integrity failures, unavailable required dependencies, and evaluation errors as denial unless a narrower explicit rule states otherwise.

Production guidance should recommend:

- `monitor` during onboarding;
- `enforce` after policy validation;
- `strict` for high-risk agents and environments.

---

## 13. Decision Model

The terminal effect must be one of:

```text
allow
deny
require_approval
```

A decision must contain at least:

```ts
interface DvarDecision {
  id: string;
  effect: "allow" | "deny" | "require_approval";
  observedEffect?:
    | "would_allow"
    | "would_deny"
    | "would_require_approval";
  mode: "off" | "monitor" | "enforce" | "strict";
  ruleId: string;
  reasonCode: string;
  message: string;
  risk: {
    level: "informational" | "low" | "medium" | "high" | "critical";
    score: number;
    signals: string[];
  };
  obligations: DvarObligation[];
  policyVersion: string;
  policyHash: string;
  actionHash: string;
  evaluatedAt: string;
  durationMs: number;
}
```

### 13.1 Decision precedence

Unless an explicit policy feature states otherwise:

1. invalid policy or invalid action context is handled first;
2. non-bypassable system guardrails are evaluated;
3. integrity and lockfile requirements are evaluated;
4. explicit matching denies override matching allows;
5. approval requirements override ordinary allows;
6. the highest-priority matching allow applies;
7. the configured default effect applies when no rule matches.

Policy authors must not depend on file order to resolve conflicts. Rules use explicit priority and deterministic tie-breaking.

### 13.2 Default effect

Every policy must declare a default effect.

Recommended generated configuration:

```yaml
mode: monitor
defaultEffect: deny
```

This permits safe observation during onboarding while ensuring the intended enforced state is default-deny.

### 13.3 Reason codes

Dvar must use stable machine-readable reason codes, for example:

- `policy.explicit_deny`
- `policy.no_matching_allow`
- `approval.required`
- `identity.missing`
- `tenant.mismatch`
- `tool.unlocked`
- `tool.schema_changed`
- `tool.capability_denied`
- `argument.schema_invalid`
- `argument.constraint_failed`
- `destination.not_allowed`
- `resource.out_of_scope`
- `quota.exceeded`
- `runtime.loop_detected`
- `runtime.internal_error`

Human-readable messages may evolve; stable reason codes form part of the public contract.

---

## 14. Action Context Model

Dvar must normalize framework-specific calls into a vendor-neutral action context.

```ts
interface DvarAction {
  id: string;

  principal: {
    id: string;
    type: "user" | "service" | "workload" | "agent";
    roles?: string[];
    claims?: Record<string, unknown>;
  };

  agent: {
    id: string;
    version?: string;
    framework?: string;
    modelProvider?: string;
    model?: string;
  };

  tenant?: {
    id: string;
  };

  session?: {
    id: string;
  };

  task?: {
    id: string;
    purpose?: string;
  };

  environment: string;

  server: {
    id: string;
    transport?: "function" | "streamable-http" | "stdio" | "custom";
    endpoint?: string;
    integrity?: Record<string, string>;
  };

  tool: {
    name: string;
    namespace?: string;
    capabilities?: string[];
    annotations?: Record<string, unknown>;
    schemaHash?: string;
  };

  arguments: unknown;

  resources?: Array<{
    type: string;
    id?: string;
    ownerId?: string;
    tenantId?: string;
    classification?: string;
  }>;

  destination?: {
    type: string;
    value: string;
  };

  trace?: {
    traceId?: string;
    spanId?: string;
    parentActionId?: string;
    depth?: number;
  };

  metadata?: Record<string, unknown>;
}
```

Adapters may add framework-specific metadata, but the policy engine must operate on the normalized core model.

---

## 15. Capability Model

Dvar must classify tools using a portable capability vocabulary.

Initial capability families:

```text
data.read
data.search
data.create
data.update
data.delete
data.export

filesystem.read
filesystem.write
filesystem.delete

network.request
network.download
network.upload

code.execute
shell.execute

communication.read
communication.send
communication.publish

finance.read
finance.charge
finance.refund
finance.transfer

identity.read
identity.manage
identity.impersonate

secrets.read
secrets.write

infrastructure.read
infrastructure.deploy
infrastructure.modify
infrastructure.delete

repository.read
repository.write
repository.merge
repository.admin

browser.navigate
browser.submit
browser.download
browser.purchase

system.admin
```

Tools may have multiple capabilities.

Capability claims originating from a tool server are untrusted hints. Dvar’s scanner and policy may infer, override, or require manual approval of classifications.

---

## 16. Risk Model

Dvar must assign a contextual risk level to each action.

### 16.1 Risk levels

- **Informational:** no external side effect and no sensitive data exposure.
- **Low:** bounded read or reversible low-impact action.
- **Medium:** meaningful write, external communication, or access to sensitive data.
- **High:** destructive, privileged, production, financial, identity, secret, or broad export action.
- **Critical:** irreversible or systemic action capable of major financial, security, availability, legal, or cross-tenant impact.

### 16.2 Risk is contextual

A tool does not have one immutable risk level.

For example:

- reading a public repository may be low risk;
- reading a private security repository may be medium or high;
- merging a documentation change may be medium;
- merging a production infrastructure change may be high;
- deleting a branch may be high;
- changing organization ownership may be critical.

### 16.3 Risk signals

Risk signals may include:

- destructive capability;
- production environment;
- privileged role;
- sensitive data classification;
- cross-tenant access;
- unknown or changed tool;
- new destination;
- high monetary value;
- shell or code execution;
- wildcard resource scope;
- unusual call rate;
- excessive recursive depth;
- missing identity;
- untrusted server;
- failed schema verification;
- previously unseen argument pattern.

Risk scoring supports explanation and policy matching. It must not replace explicit policy.

---

## 17. Policy Format

### 17.1 Canonical files

The canonical configuration is:

```text
dvar.yaml
```

JSON is supported as:

```text
dvar.json
```

The lockfile is:

```text
dvar.lock.json
```

Executable JavaScript or TypeScript policy files are not part of the stable v1 policy contract.

### 17.2 Schema versioning

Every policy must declare:

```yaml
schemaVersion: "1"
```

Within a stable major release:

- existing valid policies must remain valid;
- removed fields require a major release;
- new optional fields may be added;
- deprecated fields must produce migration guidance;
- semantic changes must be documented and testable.

### 17.3 Representative policy

```yaml
schemaVersion: "1"
mode: monitor
defaultEffect: deny

runtime:
  onEvaluationError: deny
  maxDecisionMs: 10
  maxToolCallsPerTask: 40
  maxDepth: 8

identity:
  require:
    - principal.id
    - agent.id
    - environment

integrity:
  requireLockfile: true
  onUnknownTool: require_approval
  onSchemaChange: deny

rules:
  - id: support.read-customer
    priority: 100
    effect: allow
    when:
      agent.id: support-agent
      tool.name: crm.read_customer
      environment:
        in: [development, staging, production]
    constraints:
      resource.tenantId:
        equalsContext: tenant.id

  - id: support.create-note
    priority: 100
    effect: allow
    when:
      agent.id: support-agent
      tool.name: crm.create_note
    constraints:
      arguments.note:
        maxLength: 4000

  - id: support.credit-approval
    priority: 200
    effect: require_approval
    when:
      agent.id: support-agent
      tool.name: billing.apply_credit
      arguments.amount:
        greaterThan: 1000
    approval:
      provider: webhook
      expiresInSeconds: 300
      bind:
        - principal.id
        - tenant.id
        - tool.name
        - arguments
        - environment

  - id: deny-destructive-production
    priority: 1000
    effect: deny
    when:
      environment: production
      tool.capabilities:
        containsAny:
          - data.delete
          - infrastructure.delete
          - system.admin
```

### 17.4 Matchers

The initial matcher set should include:

- equality and inequality;
- membership and non-membership;
- string prefix, suffix, and safe regular expression;
- numeric comparisons and ranges;
- array contains any/all;
- CIDR and hostname matching where relevant;
- path normalization and root containment;
- context-to-field equality;
- existence and absence;
- risk level and score;
- capability matching;
- time window;
- environment;
- tenant and ownership relationship.

Matchers must be bounded against pathological runtime behavior. User-provided regular expressions should use a safe engine or be rejected when safety cannot be established.

---
