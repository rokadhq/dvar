## 40. Version 0.1 Acceptance Criteria

Version 0.1 is complete only when all of the following are true:

1. A Node.js application can install `@rokadhq/dvar`.
2. A developer can generate `dvar.yaml` using `dvar init`.
3. Invalid policy fails with actionable diagnostics.
4. A generic function tool can be wrapped without an agent-framework dependency.
5. Dvar can deterministically return allow, deny, or require-approval.
6. Monitor mode reports the underlying enforcement result.
7. Rule precedence is explicit and covered by tests.
8. JSON Schema input validation occurs before execution.
9. Policy tests run in CI and produce stable machine-readable output.
10. Replay evaluates captured actions without executing tools.
11. Decision events apply privacy-safe defaults.
12. Internal errors have explicit behavior.
13. No model or network service is required for local decisions.
14. The package supports ESM, CommonJS where practical, and TypeScript consumers.
15. The package includes a threat model, security policy, support policy, and API stability statement.
16. Release artifacts include integrity metadata and an SBOM.
17. A complete example demonstrates monitor-to-enforce migration.

---

## 41. Success Metrics

Product metrics should measure real adoption and safety value.

### Developer adoption

- time to first protected tool;
- successful installation rate;
- weekly active repositories;
- package downloads;
- GitHub stars, contributors, and issue quality;
- number of production deployments voluntarily reported;
- adapter adoption.

### Security usefulness

- percentage of calls attributable to principal, agent, tenant, and policy;
- number of unknown or changed tools detected;
- number of policy violations found in monitor mode before enforcement;
- false-positive rate after rollout;
- approval acceptance and rejection rates;
- frequency of broad or unsafe policies detected by diagnostics;
- replay coverage before policy changes.

### Commercial relevance

- security assessments initiated through Dvar;
- MCP and agent implementation leads;
- enterprise support inquiries;
- control-plane design partners;
- conversion from technical users to Rokad services.

Download volume alone is not sufficient evidence of success.

---

## 42. Product and Engineering Decisions Already Locked

The following decisions are canonical unless this source-of-truth document is revised:

1. The product name is **Dvar**.
2. Dvar is an **agent action firewall and policy runtime**.
3. Dvar is not an agent framework.
4. Dvar is model-provider and framework independent.
5. MCP is first-class but not the only supported integration.
6. TypeScript and Node.js are first.
7. Node.js 20 or newer is the initial minimum.
8. The primary package is `@rokadhq/dvar`.
9. The CLI is `dvar`.
10. The canonical policy is declarative YAML, with JSON support.
11. Executable TypeScript policy is not part of the stable v1 contract.
12. The canonical lockfile is `dvar.lock.json`.
13. The final security decision is deterministic.
14. Model-based analysis cannot be the sole permit authority.
15. The terminal effects are allow, deny, and require approval.
16. Monitor mode is the generated onboarding default.
17. The generated policy’s intended enforced default is deny.
18. Dvar has no required cloud dependency.
19. OpenTelemetry is the primary observability standard.
20. Privacy-safe telemetry is the default.
21. Tool metadata and annotations are untrusted.
22. Tool and schema changes are reviewable through a lockfile.
23. Dvar will not silently downgrade declared protection.
24. The open-source license is MIT to remain consistent with Dhal.
25. The open-source runtime remains independently useful.
26. The portfolio statement is: **Dhal secures requests. Dvar secures actions.**

---

## 43. Deferred Decisions

These decisions are intentionally deferred and must not block version 0.1:

- final hosted control-plane architecture;
- hosted pricing;
- final web domain;
- managed policy distribution protocol;
- whether a future policy adapter supports Rego, Cedar, or both;
- enterprise database choice;
- long-term event-retention backend;
- exact UI framework for approval and inventory dashboards;
- WASM runtime support;
- Kubernetes sidecar and admission-controller design;
- whether browser and computer-use controls become a dedicated adapter package;
- formal third-party certification strategy.

Deferred decisions must not be accidentally encoded into the stable core API.

---

## 44. Reference Standards and Guidance

Dvar should track, without becoming tightly coupled to unstable drafts:

- the stable Model Context Protocol specification;
- MCP authorization guidance;
- MCP security best practices;
- MCP tool and transport semantics;
- OAuth security best practices where authorization is involved;
- OpenTelemetry core semantic conventions;
- OpenTelemetry GenAI and MCP semantic conventions;
- OWASP guidance for agentic application security;
- secure software supply-chain and SBOM practices;
- applicable JSON Schema standards.

When standards evolve, Dvar should prefer adapters and versioned compatibility layers over breaking the core policy model.

---

## 45. Canonical One-Paragraph Description

Dvar is an open-source policy firewall for AI agents, tool calls, and MCP connections. It sits between an agent and the systems the agent can affect, then uses deterministic policy to verify identity, validate arguments, enforce least privilege, detect tool changes, constrain execution, require human approval for sensitive operations, and produce privacy-conscious audit telemetry. Dvar is model- and framework-independent, works locally without a hosted dependency, and complements authentication, IAM, sandboxing, and application authorization rather than replacing them.

---

## 46. Canonical Short Descriptions

### Five words

**Policy firewall for AI agents.**

### One sentence

**Dvar controls what AI agents are allowed to do.**

### Portfolio sentence

**Dhal secures requests; Dvar secures actions.**

### Developer-oriented sentence

**Add deterministic policy, approvals, integrity checks, and audit trails to agent tool calls and MCP connections.**

### Enterprise-oriented sentence

**Govern agent access to data, systems, infrastructure, and financial operations through enforceable policy and attributable approvals.**

---

## 47. Final Product Test

A proposed feature belongs in Dvar when the answer to most of these questions is yes:

1. Does it control, constrain, verify, or audit an agent action?
2. Does it operate near the boundary between proposed intent and real execution?
3. Can it be expressed independently of one model or framework?
4. Does it improve least privilege, integrity, approval, runtime containment, or accountability?
5. Can it produce a deterministic and explainable outcome?
6. Does it complement rather than duplicate existing infrastructure controls?
7. Is it useful without requiring Rokad’s hosted service?

A proposed feature probably does not belong in Dvar when it primarily:

- improves model reasoning;
- manages prompts;
- selects model providers;
- builds agent workflows;
- stores general application data;
- replaces IAM;
- provides generic API gateway functionality;
- performs ordinary web request filtering already owned by Dhal;
- offers observability without action-control relevance.

---

# End of Canonical Specification

Changes to Dvar’s product identity, policy model, security boundary, stable file names, or open-source boundary require an explicit update to this document.
