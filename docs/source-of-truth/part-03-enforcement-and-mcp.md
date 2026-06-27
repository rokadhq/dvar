## 18. Obligations

An allow or approval decision may carry obligations.

Initial obligations:

- redact specified fields before logging;
- hash specified identifiers;
- remove undeclared arguments;
- replace arguments with policy-defined values;
- cap numeric values;
- constrain filesystem paths;
- constrain network destinations;
- apply execution timeout;
- apply rate or concurrency limit;
- limit tool output size;
- filter tool output fields;
- mark output as untrusted;
- require enhanced audit capture;
- emit notification;
- attach trace attributes.

Transformations must be visible in the decision record. Dvar must preserve hashes of both the proposed and executed argument sets.

Dvar must not silently change the meaning of an action. Material transformations require explicit policy and documentation.

---

## 19. Tool Argument Protection

Before execution, Dvar should be capable of:

- validating arguments against the declared JSON Schema;
- optionally converting compatible schemas into strict form;
- rejecting undeclared properties;
- applying type and format checks;
- validating identifiers and ownership;
- enforcing monetary and quantity bounds;
- normalizing and constraining filesystem paths;
- validating URLs, schemes, ports, and destinations;
- blocking private-network or metadata-service access when prohibited;
- preventing environment crossover;
- detecting high-risk command construction;
- preventing raw shell execution unless explicitly allowed;
- constraining SQL operations where an adapter can safely parse them;
- redacting credentials and secrets;
- detecting encoded or nested payloads that bypass ordinary constraints;
- limiting payload size and nesting depth.

Signature-based detection may provide additional signals but must not be presented as complete protection against semantic misuse.

---

## 20. Tool Output Protection

Tool output can contain secrets, personal data, adversarial instructions, oversized content, or references that induce unsafe follow-on actions.

Dvar should support output policies that:

- enforce maximum size;
- classify output by source and sensitivity;
- redact configured fields;
- remove credentials and tokens;
- prevent cross-tenant data return;
- mark external content as untrusted;
- preserve provenance;
- prevent raw binary content from entering model context unless allowed;
- restrict content types;
- detect suspicious instruction-like content as a risk signal;
- summarize or transform output only through explicitly configured processors.

A model-generated summary is not a security boundary. Sensitive raw output must be filtered before it reaches any model-based transformer.

---

## 21. MCP-Specific Security Model

Dvar supports MCP as a first-class integration surface.

### 21.1 Supported MCP roles

Dvar may operate as:

- a Streamable HTTP reverse proxy;
- a local stdio supervisor and wrapper;
- an embedded MCP client adapter;
- a tool-list scanner;
- a policy filter that exposes only permitted tools;
- an approval boundary around individual MCP calls.

### 21.2 Tool discovery

Dvar must record:

- server identity;
- transport;
- endpoint or command;
- protocol version;
- advertised capabilities;
- tool names;
- descriptions;
- input schemas;
- output schemas when available;
- annotations;
- metadata;
- discovery timestamp;
- canonical hashes.

### 21.3 Untrusted metadata

Tool descriptions, annotations, schemas, and server-provided capability labels are untrusted inputs.

Dvar must not grant authority solely because a tool describes itself as safe, read-only, idempotent, or non-destructive.

### 21.4 Tool-list changes

When a server signals or exhibits a tool-list change, Dvar must:

1. fetch the new tool inventory;
2. canonicalize and hash it;
3. compare it with the approved lockfile;
4. classify additions, removals, and modifications;
5. apply configured policy;
6. prevent unapproved changed capabilities from silently becoming available.

### 21.5 Streamable HTTP

The Streamable HTTP proxy must preserve protocol correctness while applying:

- server allowlists;
- authentication forwarding rules;
- session binding;
- origin and destination validation;
- message size limits;
- request timeouts;
- policy enforcement for tool calls;
- response filtering;
- trace propagation;
- audit generation.

Dvar must not log bearer tokens or authorization headers.

### 21.6 Stdio

A local stdio server can execute with the privileges of the launching process. Dvar’s stdio supervisor should support:

- exact executable and argument allowlists;
- resolved executable path capture;
- package and binary integrity metadata;
- controlled environment variables;
- working-directory restrictions;
- filesystem root policy;
- process lifetime and timeout controls;
- output size limits;
- child-process restrictions where feasible;
- explicit shell prohibition by default;
- isolation integration points.

Dvar is not itself a complete OS sandbox. Documentation must recommend native sandboxing, containers, restricted users, or microVMs for hostile tools.

### 21.7 Authorization and scope

Dvar complements MCP authorization. It must support:

- preserving authenticated principal context;
- validating token audience and expected resource where available;
- scope minimization;
- preventing token passthrough to unintended downstream services;
- rejecting missing required identity in strict mode;
- binding approval and policy decisions to the authenticated principal and session.

Dvar must not act as an insecure token relay.

---

## 22. Integrity and `dvar.lock.json`

The Dvar lockfile makes approved tool capabilities reviewable and detects changes after approval.

### 22.1 Lockfile contents

The lockfile should contain:

```json
{
  "lockfileVersion": "1",
  "generatedAt": "2026-06-27T00:00:00.000Z",
  "servers": [
    {
      "id": "github",
      "transport": "streamable-http",
      "endpoint": "https://example.invalid/mcp",
      "identity": {
        "type": "url",
        "value": "https://example.invalid/mcp"
      },
      "integrity": {
        "manifestSha256": "..."
      },
      "tools": [
        {
          "name": "create_pull_request",
          "descriptionSha256": "...",
          "inputSchemaSha256": "...",
          "outputSchemaSha256": "...",
          "annotationsSha256": "...",
          "capabilities": ["repository.write"],
          "risk": "medium"
        }
      ]
    }
  ]
}
```

### 22.2 Lockfile guarantees

The lockfile does not prove that a server is benign. It proves that the current observed inventory matches a reviewed inventory.

### 22.3 Diff classifications

`dvar diff` should identify:

- server added or removed;
- endpoint or command changed;
- tool added or removed;
- description changed;
- input schema widened or narrowed;
- output schema changed;
- annotations changed;
- capability classification changed;
- executable or package identity changed;
- integrity hash changed.

Diffs should be assigned a risk level with machine-readable reasons.

### 22.4 Enforcement behavior

Policy controls behavior on mismatch:

```yaml
integrity:
  requireLockfile: true
  onUnknownServer: deny
  onUnknownTool: require_approval
  onDescriptionChange: require_approval
  onSchemaChange: deny
  onCapabilityExpansion: deny
```

---

## 23. Human Approval

Human approval is a policy effect, not a generic confirmation dialog.

### 23.1 Approval requirements

An approval request must clearly display:

- requesting principal;
- agent identity;
- tenant and environment;
- server and tool;
- human-readable action summary;
- material arguments;
- affected resources;
- data classifications;
- risk level and reasons;
- policy rule;
- requested approval scope;
- expiry;
- whether the action is reversible.

### 23.2 Approval scopes

Initial supported scopes:

- **once:** exactly one action hash;
- **bounded session:** matching actions within one session and a short duration;
- **bounded task:** matching actions within one task;
- **policy exception:** administrator-created, versioned exception outside the runtime prompt.

“Approve everything” must not be an ordinary runtime option.

### 23.3 Approval binding

An approval grant must bind to selected fields, normally including:

- principal;
- agent;
- tenant;
- environment;
- server;
- tool;
- normalized arguments or approved argument constraints;
- resource;
- policy version;
- expiry;
- maximum use count.

Changing a bound field invalidates the grant.

### 23.4 Replay resistance

Approval tokens must be nonce-bearing, time-limited, and single-use by default. Reuse attempts must be auditable.

### 23.5 Failure behavior

When approval is required but the provider is unavailable:

- monitor mode records the failure and allows execution;
- enforce mode follows explicit policy;
- strict mode denies by default.

### 23.6 Approval fatigue

Dvar should mitigate approval fatigue through:

- risk-based grouping;
- concise but complete summaries;
- duplicate suppression;
- bounded grants;
- escalation thresholds;
- rate limits on approval requests;
- refusal to convert repeated critical actions into broad grants;
- metrics showing approval frequency and rejection rates.

---

## 24. Runtime Safety Controls

Dvar should provide controls for:

- maximum calls per task;
- maximum calls per session;
- maximum recursive depth;
- maximum consecutive calls to one tool;
- maximum retries;
- maximum execution duration;
- maximum cumulative execution duration;
- maximum concurrency;
- maximum monetary value;
- maximum bytes read, written, uploaded, or downloaded;
- maximum unique destinations;
- maximum unique resources;
- circuit breakers;
- distributed quotas through pluggable stores;
- repeated-failure detection;
- loop and oscillation detection.

Limits may apply per principal, agent, tenant, task, session, server, tool, resource, or combination.

Distributed enforcement must require an explicitly configured shared store. Dvar must not silently substitute process-local counters in horizontally scaled enforcement.

---

## 25. Threat Model

Dvar is designed to reduce, detect, or contain the following threat classes.

### 25.1 Goal hijacking and prompt injection

Untrusted content manipulates an agent into attempting an action inconsistent with the user’s intent.

Dvar response:

- enforce policy independently of prompt content;
- limit exposed tools;
- require attributable context;
- restrict destinations and resources;
- escalate sensitive actions;
- mark untrusted tool output;
- cap action chains.

### 25.2 Excessive agency

An agent receives broader authority or autonomy than the task requires.

Dvar response:

- least-capability tool exposure;
- explicit default deny;
- task-, tenant-, and environment-scoped rules;
- runtime limits;
- approval for consequential actions.

### 25.3 Tool poisoning

A tool description, schema, annotation, or output contains adversarial instructions or misleading semantics.

Dvar response:

- treat metadata as untrusted;
- hash and lock definitions;
- detect changes;
- classify suspicious metadata;
- enforce policy on actual action context rather than descriptions alone.

### 25.4 Tool rug pull

A previously approved server changes its behavior or declared interface.

Dvar response:

- inventory lockfile;
- schema and metadata diff;
- capability expansion detection;
- deny or approval on mismatch.

### 25.5 Confused deputy

An agent or proxy uses its authority on behalf of an unauthorized caller or for an unintended resource.

Dvar response:

- preserve principal context;
- bind tenant and ownership;
- validate audience and destination;
- prevent unscoped token forwarding;
- bind approvals to the initiating identity.

### 25.6 Privilege escalation

An agent reaches administrative, production, identity, secret, or infrastructure capabilities outside its role.

Dvar response:

- capability policy;
- environment policy;
- explicit deny;
- identity requirements;
- resource-scope enforcement;
- approval for bounded exceptions.

### 25.7 Data exfiltration

An agent sends sensitive data to an external destination or exposes cross-tenant data.

Dvar response:

- destination allowlists;
- output filtering;
- data classification;
- tenant checks;
- upload and export policy;
- size and rate limits.

### 25.8 Injection into tool arguments

Model- or user-controlled values alter command, query, path, URL, template, or code execution semantics.

Dvar response:

- schema validation;
- typed adapters;
- path and URL normalization;
- command restrictions;
- deny raw shell by default;
- structured argument constraints.

### 25.9 Resource exhaustion and loops

An agent repeatedly invokes tools, recursively delegates, or consumes unbounded compute, money, tokens, or external capacity.

Dvar response:

- quotas;
- depth limits;
- retry limits;
- cost and amount limits;
- loop detection;
- circuit breakers.

### 25.10 Approval manipulation

An approval request hides material facts, changes after approval, or is replayed.

Dvar response:

- structured summaries generated from normalized action context;
- action hashing;
- bound and expiring grants;
- single-use tokens;
- post-approval integrity verification.

### 25.11 Cross-tenant access

An agent accesses or modifies resources belonging to another tenant.

Dvar response:

- tenant context as a first-class field;
- resource ownership constraints;
- deny on missing tenant identity in strict mode;
- cross-tenant rules that require explicit administrative authority.

### 25.12 Compromised or malicious local server

A stdio tool executes arbitrary local behavior.

Dvar response:

- executable integrity;
- exact command policy;
- environment and path restrictions;
- lifecycle limits;
- sandbox integration;
- clear statement that Dvar is not a complete process sandbox.

---
