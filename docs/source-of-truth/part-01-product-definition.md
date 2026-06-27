# Dvar — Source of Truth

> **Canonical product definition for Dvar**
>
> **Document version:** 0.1.0
> **Status:** Foundational specification
> **Date:** 27 June 2026
> **Owner:** Rokad
> **Repository:** `rokadhq/dvar`
> **Primary package:** `@rokadhq/dvar`
> **CLI:** `dvar`
> **Canonical configuration:** `dvar.yaml`
> **Canonical lockfile:** `dvar.lock.json`
> **License:** MIT
>
> This document is the authoritative source for Dvar’s product purpose, boundaries, architecture, security model, terminology, and roadmap. Product requirements, code, documentation, examples, marketing, and commercial offerings must not contradict it. When a material product decision changes, this document must be updated in the same change set.

---

## 1. Executive Definition

**Dvar is an open-source policy firewall for AI-agent actions, tool calls, and Model Context Protocol connections.**

Dvar sits between an AI agent and the external capabilities the agent can invoke. It discovers and classifies those capabilities, validates each attempted action, applies deterministic policy, requests human approval when required, constrains execution, and produces an auditable decision record.

Dvar answers one production-critical question:

> **Should this agent be permitted to perform this action, with these arguments, on this resource, for this user, in this environment, at this time?**

The canonical portfolio statement is:

> **Dhal secures requests. Dvar secures actions.**

Dhal protects applications from unsafe inbound HTTP requests. Dvar protects systems from unsafe outbound actions initiated by AI agents, automated workflows, MCP clients, or other tool-using software.

Dvar’s short product descriptor is:

> **The policy firewall for AI agents.**

Its technical category is:

> **Agent action security and MCP runtime policy enforcement.**

---

## 2. Name and Brand Meaning

**Dvar** is derived from the idea of a *door*, *gateway*, or controlled entry point. The name represents a boundary through which an action must pass before it can affect a real system.

The brand meaning is functional, not decorative:

- Dvar is the controlled doorway between reasoning and execution.
- An agent may propose an action; Dvar decides whether that action may cross the boundary.
- Every permitted action must have an attributable identity, a validated shape, an applicable policy, and an audit trail.

The product must consistently be presented as **Dvar**, not “DVAR,” except where an all-uppercase environment variable or constant is required.

---

## 3. Product Thesis

AI agents are increasingly able to read private data, modify databases, send communications, execute code, operate infrastructure, create financial transactions, and interact with external services. The model’s ability to select a tool does not establish that the tool call is authorized, safe, contextually appropriate, or within the user’s intent.

Authentication alone is insufficient. A valid agent, user, token, or MCP session may still attempt an unsafe action.

Prompt instructions alone are insufficient. Model instructions are probabilistic, mutable, and vulnerable to conflicting or adversarial context.

Tool schemas alone are insufficient. A schema can validate structure without validating authority, ownership, risk, environment, amount, destination, or business constraints.

Human approval alone is insufficient. Unstructured approval prompts can be vague, manipulated, replayed, or overused until reviewers approve requests mechanically.

Dvar therefore introduces a dedicated, deterministic action-control layer with five responsibilities:

1. **Discover** what capabilities exist.
2. **Verify** the identity, integrity, and declared behavior of those capabilities.
3. **Decide** whether a specific action is allowed.
4. **Constrain** how an allowed action may execute.
5. **Record** why the decision was made and what occurred.

---

## 4. Product Goals

Dvar exists to make tool-using AI systems safer to build, operate, audit, and govern.

### 4.1 Primary goals

Dvar must:

- provide deterministic authorization and safety policy for agent actions;
- work independently of the model provider and agent framework;
- support MCP without becoming dependent on MCP;
- protect both MCP tools and ordinary application functions;
- enforce least privilege and least agency;
- validate tool arguments and relevant tool outputs;
- detect capability, schema, and tool-definition changes;
- support human approval for narrowly defined sensitive actions;
- provide monitor-first adoption without hiding enforcement failures;
- emit structured, privacy-conscious audit and observability data;
- function locally without requiring a Rokad-hosted service;
- remain suitable for production use in multi-tenant applications;
- integrate incrementally into existing systems;
- create a coherent open-source security portfolio with Dhal.

### 4.2 Developer-experience goals

A developer should be able to:

- install Dvar and protect a first tool in less than ten minutes;
- generate a valid starter policy without learning a new programming language;
- understand why every action was allowed, denied, or escalated;
- test policy before production;
- replay historical calls against changed policy without executing the real tools;
- inspect MCP servers before granting them access;
- review meaningful lockfile diffs in pull requests;
- migrate from monitor mode to enforcement route by route, tool by tool, or agent by agent.

### 4.3 Commercial goals

Dvar should create qualified demand for Rokad services involving:

- secure AI-agent architecture;
- MCP implementation and hardening;
- agentic application security assessments;
- AI governance and approval workflows;
- custom MCP server and connector development;
- agent observability and incident investigation;
- private deployment and platform engineering;
- AI red-team exercises;
- enterprise policy and control-plane implementation.

Commercial goals may influence prioritization, but must not weaken the open-source runtime or introduce artificial insecurity into the community edition.

---

## 5. Non-Goals

Dvar is deliberately not all of the following:

- an AI-agent framework;
- a model router;
- an LLM gateway focused primarily on provider selection or token cost;
- a prompt-management platform;
- a general API gateway;
- a general-purpose web application firewall;
- an identity provider;
- an OAuth authorization server;
- a secrets manager;
- a full data-loss prevention platform;
- a malware scanner;
- an endpoint security agent;
- a container or virtual-machine sandbox;
- a replacement for application-level authorization;
- a replacement for database permissions, cloud IAM, or operating-system controls;
- a replacement for human judgment;
- a SIEM, APM, or complete observability backend;
- a guarantee that an AI model will reason correctly;
- a system that declares actions safe solely because another AI model said so.

Dvar may integrate with these systems and may provide overlapping safety controls, but it must not falsely claim to replace them.

---

## 6. Foundational Principles

### 6.1 Deterministic enforcement

The final permit, deny, or approval decision must be reproducible from explicit policy and normalized context.

A model-based classifier may contribute a risk signal, classification, or recommendation. It must never be the sole reason a consequential action is allowed.

### 6.2 Least agency

An agent should receive only the capabilities required for the current task, user, tenant, and environment.

Dvar should reduce both:

- **permission scope** — what the agent technically can access; and
- **decision scope** — what the agent is permitted to decide autonomously.

### 6.3 Explicit trust

Tool names, descriptions, schemas, annotations, server metadata, model outputs, user-supplied content, and retrieved content are untrusted unless policy explicitly establishes a stronger trust level.

Trust must be attributable to a source and bounded by time, environment, and scope.

### 6.4 Deny by policy, not by accident

A denial must identify the rule, reason, and relevant decision context. Internal errors must not be mislabeled as policy denials.

### 6.5 No silent downgrade

When a declared security dependency is unavailable, Dvar must follow an explicit failure policy. It must not silently fall back to a weaker enforcement mechanism.

Examples include:

- a distributed quota configured without an available shared store;
- an approval-required action when the approval provider is unavailable;
- a required lockfile that cannot be verified;
- a required identity field that is missing;
- a policy bundle whose signature cannot be validated.

### 6.6 Monitor before enforce

New installations should begin in monitor mode, where Dvar reports what it would have denied or escalated. Production adoption should move incrementally toward enforcement.

Monitor mode must not be marketed as protection. It is an observation and migration mode.

### 6.7 Local-first and vendor-neutral

The core runtime, policy engine, scanner, lockfile, replay tooling, and audit event generation must work without a Rokad cloud account.

Dvar must not require a specific model vendor, agent framework, database, cloud, or observability provider.

### 6.8 Privacy by default

Sensitive arguments, credentials, personal data, model content, tool output, and resource identifiers must not be logged by default in full.

Dvar should prefer omission, classification, masking, hashing, and bounded capture over indiscriminate logging.

### 6.9 Explainable decisions

Every decision must be explainable through structured fields rather than a free-form model explanation.

### 6.10 Policy as reviewable configuration

The primary policy format must be declarative, schema-validated, diffable, and safe to review. Executable TypeScript or JavaScript is not the canonical policy format.

### 6.11 Defense in depth

Dvar must assume that upstream and downstream controls can fail. Dvar complements, rather than replaces:

- authentication;
- authorization;
- IAM;
- network policy;
- sandboxing;
- secret management;
- input validation;
- database permissions;
- approval workflows;
- monitoring and incident response.

---

## 7. Target Users

### 7.1 Primary users

- developers building tool-using AI applications;
- platform engineers operating internal agents;
- security engineers reviewing AI-agent permissions;
- teams deploying MCP clients and servers;
- SaaS companies adding agentic workflows;
- enterprises connecting models to internal systems.

### 7.2 Secondary users

- AI governance teams;
- compliance and audit teams;
- DevSecOps teams;
- MCP server authors;
- framework and SDK maintainers;
- managed-service providers;
- consultants implementing enterprise AI systems.

### 7.3 Initial technical audience

The initial release is TypeScript- and Node.js-first because it aligns with Rokad’s existing engineering strengths, Dhal’s ecosystem, and a large share of MCP and agent application development.

Python support is a planned expansion, not a prerequisite for validating the product.

---

## 8. Canonical Use Cases

Dvar must support the following representative use cases.

### 8.1 Customer-support agent

Permit reading a customer record and creating an internal note. Require approval before issuing credit. Deny deleting a customer or exporting an account history to an unapproved destination.

### 8.2 Finance agent

Permit invoice lookup. Require approval above a monetary threshold. Deny transfers to newly introduced beneficiaries. Enforce daily and per-task transaction limits.

### 8.3 Software-development agent

Permit repository reads and branch creation. Require approval before merging, changing CI secrets, modifying branch protection, or altering deployment configuration. Deny destructive administrative actions.

### 8.4 Infrastructure agent

Permit read-only inspection in production. Allow mutations in development. Require approval for production changes. Deny privilege escalation and unrestricted shell execution.

### 8.5 Internal knowledge agent

Permit approved document retrieval. Deny access across tenant or department boundaries. Redact secrets before returning tool output to the model.

### 8.6 Browser or computer-use agent

Permit navigation to approved domains. Deny credential submission to unknown domains. Require approval before purchases, account changes, downloads, or irreversible submissions.

### 8.7 MCP-enabled desktop or IDE

Inspect local stdio servers, restrict filesystem roots, validate command provenance, detect tool-list changes, and prevent newly added destructive tools from becoming automatically available.

---
