# Dvar v1.0 implementation and acceptance plan

**Decision: 15 October 2026. No alpha, beta, release candidate, npm or other public package release before the complete v1 scope is qualified and explicitly approved.**

All 55 features below are required. Internal milestones are development batches, not shipping versions. The earlier 0.8/0.9 release sequence is superseded; the current package version is not bumped merely because development starts.

## Tracking and release gates

`features.json` is the machine-readable tracker. `planned` means not started; `in_progress` means incomplete; `implemented` means code exists but qualification remains; `verified` requires reviewed implementation, tests, documentation and review evidence. Historical feature descriptions and CI success are not proof that the expanded v1 acceptance criteria are complete.

Run `npm run check:v1-plan` to validate IDs, dependencies and evidence shape. Run `npm run check:v1-release` to see release blockers. Publication also invokes the package-level gate. The release workflow is intentionally a non-publishing hold until a reviewed release change restores it. These repository checks are safeguards, not protection against a maintainer deliberately bypassing npm lifecycle scripts.

Final release requires all 55 items verified; actual source and built-package tests; supported Node/Python/framework compatibility; real Redis/Valkey concurrency and failure tests; tenant isolation; protocol conformance; adversarial/fuzz tests; performance/resource budgets; complete API/policy migration documentation; dependency/SBOM/provenance review; security-review approval; and owner approval. No mock dashboard data, type-only adapter or placeholder provider counts as an implemented feature.

## Milestones

### M1 — Release hold, network foundation, shared-state and telemetry primitives
Scope: F01, F02, F53, F55.

### M2 — Identity, ownership, delegation and operation controls
Scope: F03, F04, F05, F06, F07, F08, F09, F11, F12, F13, F14, F18, F19, F44.

### M3 — Action-chain, behavioral and workflow security
Scope: F10, F15, F16, F17, F20.

### M4 — MCP protocol, streaming, OAuth and supply-chain security
Scope: F21, F22, F23, F24, F25, F26, F27, F28, F29.

### M5 — Data classification, provenance, DLP and output contracts
Scope: F30, F31, F32, F33, F34, F35, F36, F37, F38.

### M6 — Human approval operations and governance
Scope: F39, F40, F41, F42, F43.

### M7 — Python, Mayura, frameworks, presets and developer tooling
Scope: F45, F46, F47, F48, F49, F50, F51, F52.

### M8 — Security analytics and integrated v1 qualification
Scope: F54.

Work follows the dependency graph, not rigid calendar deadlines. For example, streaming content inspection must precede completion of the MCP streaming guard. Telemetry/shared-state primitives start early and are exercised throughout later milestones.

## Feature register

| ID | Feature | Priority | Milestone | Status |
|---|---|---|---|---|
| F01 | Advanced URL and SSRF protection | P0 | M1 | in_progress |
| F02 | Network egress firewall | P0 | M1 | in_progress |
| F03 | Sensitive operation classification | P1 | M2 | planned |
| F04 | File access protection | P1 | M2 | planned |
| F05 | SQL query firewall | P1 | M2 | planned |
| F06 | Shell command security | P1 | M2 | planned |
| F07 | Process isolation integration | P1 | M2 | planned |
| F08 | Credential delegation | P1 | M2 | planned |
| F09 | Resource ownership enforcement | P0 | M2 | in_progress |
| F10 | Transaction-aware authorization | P2 | M3 | planned |
| F11 | Agent identity and trust levels | P1 | M2 | in_progress |
| F12 | Agent-to-agent authorization | P1 | M2 | planned |
| F13 | Delegated authority limits | P0 | M2 | planned |
| F14 | Task-scoped permissions | P1 | M2 | planned |
| F15 | Agent behavioral baselines | P2 | M3 | planned |
| F16 | Adaptive risk scoring | P2 | M3 | planned |
| F17 | Action-chain analysis | P1 | M3 | planned |
| F18 | Kill switch | P1 | M2 | planned |
| F19 | Agent execution leases | P1 | M2 | planned |
| F20 | Workflow security policies | P1 | M3 | planned |
| F21 | MCP 2026 specification support | P0 | M4 | planned |
| F22 | Multi Round-Trip Request security | P1 | M4 | planned |
| F23 | Dynamic tool visibility | P1 | M4 | planned |
| F24 | Continuous MCP integrity monitoring | P1 | M4 | planned |
| F25 | MCP server trust profiles | P1 | M4 | planned |
| F26 | MCP OAuth security | P0 | M4 | planned |
| F27 | MCP response streaming guard | P0 | M4 | planned |
| F28 | MCP tool execution analytics | P1 | M4 | planned |
| F29 | MCP supply-chain verification | P2 | M4 | planned |
| F30 | Data classification engine | P1 | M5 | planned |
| F31 | Sensitive data tracking | P1 | M5 | planned |
| F32 | PII detection and redaction | P1 | M5 | planned |
| F33 | Output schema enforcement | P1 | M5 | planned |
| F34 | Streaming DLP | P0 | M5 | planned |
| F35 | Content provenance | P1 | M5 | planned |
| F36 | Prompt-injection risk signals | P1 | M5 | planned |
| F37 | Data export restrictions | P1 | M5 | planned |
| F38 | Custom output processors | P2 | M5 | planned |
| F39 | Approval dashboard | P1 | M6 | planned |
| F40 | Slack and Microsoft Teams approvals | P1 | M6 | planned |
| F41 | Multi-person approval | P1 | M6 | planned |
| F42 | Approval delegation and escalation | P2 | M6 | planned |
| F43 | Approval fatigue protection | P1 | M6 | planned |
| F44 | Emergency revocation | P1 | M2 | planned |
| F45 | Python SDK and runtime | P1 | M7 | planned |
| F46 | Native Mayura adapter | P1 | M7 | planned |
| F47 | LangChain/LangGraph adapter | P1 | M7 | planned |
| F48 | Additional framework adapters | P2 | M7 | planned |
| F49 | Policy presets | P1 | M7 | planned |
| F50 | Policy simulator | P1 | M7 | planned |
| F51 | VS Code extension | P2 | M7 | planned |
| F52 | Policy migration tools | P1 | M7 | planned |
| F53 | OpenTelemetry integration | P0 | M1 | in_progress |
| F54 | Security analytics dashboard | P1 | M8 | planned |
| F55 | Distributed enforcement hardening | P0 | M1 | in_progress |

## Per-feature acceptance criteria

### F01 — Advanced URL and SSRF protection
Dependencies: none. Status: `in_progress`.

- Validate URL parsing, credentials, every IPv4/IPv6 DNS answer and every redirect; connect only to the validated address while preserving TLS hostname verification.
- Reject rebinding, mixed public/private DNS, mapped IPs, metadata endpoints, proxy bypass, unsafe fallback and timeout races across every supported outbound boundary.

Slice 01 implements the bounded HTTP transport only. The remaining qualification and integration work is recorded in the JSON tracker.

### F02 — Network egress firewall
Dependencies: F01. Status: `in_progress`.

- Enforce explicit host, scheme, method, port and destination rules with deny precedence and narrow private-service exceptions.
- Prove denied requests never connect; integrate with MCP, credential/webhook traffic and protected agent HTTP tools; document OS-level network containment separately.

Slice 01 implements the bounded HTTP transport only. The remaining qualification and integration work is recorded in the JSON tracker.

### F03 — Sensitive operation classification
Dependencies: none. Status: `planned`.

- Classify finance, database, identity, repository, infrastructure and destructive operations from trusted manifests and reviewed mappings.
- Expose provenance, overrides and unknown classifications; untrusted tool descriptions cannot downgrade operation risk.

### F04 — File access protection
Dependencies: none. Status: `planned`.

- Enforce read/write root, extension and classification policy on the actual file operation, including canonical paths and symlinks.
- Test traversal, symlink replacement, hardlinks, nonexistent targets and platform differences; argv inspection alone is not filesystem enforcement.

### F05 — SQL query firewall
Dependencies: F09. Status: `planned`.

- Use dialect-aware parsing and parameter handling for operation, table, column and resource policy; never use regex alone as a SQL parser.
- Reject multi-statement, comment, CTE, encoding and dynamic-SQL bypasses; test real database execution permissions and tenant isolation.

### F06 — Shell command security
Dependencies: F04. Status: `planned`.

- Add parser-backed executable and argument policies; reject ambiguous constructs and shell expansion unless an explicitly supported sandbox handles them.
- Test interpreter flags, command substitution, pipelines, redirection and executable changes without claiming command parsing is process isolation.

### F07 — Process isolation integration
Dependencies: F04, F06. Status: `planned`.

- Provide at least one qualified OS/container sandbox adapter with filesystem, network, resource and process-tree limits; publish a capability matrix for other backends.
- Prove kill escalation, descendant cleanup, timeout enforcement, secret isolation and unavailable-sandbox fail-closed behavior on supported platforms.

### F08 — Credential delegation
Dependencies: F09, F13, F19. Status: `planned`.

- Delegate short-lived, narrowly scoped credentials from an external issuer or vault to authorized tool execution without exposing master secrets.
- Bind credentials to principal, tenant, task, audience and expiry; test revocation and verify secrets never reach prompts, logs or approval displays.

### F09 — Resource ownership enforcement
Dependencies: F11. Status: `in_progress`.

- Resolve ownership through a trusted application/provider interface before resource-specific side effects and bind the resource version where required.
- Fail closed on missing, stale or cross-tenant ownership; cover confused-deputy and check/use races with integration tests.

### F10 — Transaction-aware authorization
Dependencies: F17, F20. Status: `planned`.

- Authorize an explicitly bounded multi-step transaction with allowed resources, amounts, sequence and expiry.
- Test partial execution, replay, cancellation, changed transaction payloads and compensation; do not imply arbitrary external side effects are atomic.

### F11 — Agent identity and trust levels
Dependencies: none. Status: `in_progress`.

- Establish application-verified agent identity, roles, tenant, issuer and trust attributes independently of model-generated arguments.
- Reject forged, missing and stale identity evidence; audit the verified source and keep Dvar separate from an identity provider.

### F12 — Agent-to-agent authorization
Dependencies: F11, F13. Status: `planned`.

- Authorize each inter-agent request against both caller authority and callee policy, preserving the attributable delegation chain.
- Test cross-tenant calls, agent impersonation, cyclic delegation and context loss across process boundaries.

### F13 — Delegated authority limits
Dependencies: F11. Status: `planned`.

- Intersect child capabilities with parent grants, resource scope, tenant, expiry and budgets; children cannot broaden inherited authority.
- Test privilege amplification, detached children, forged ancestors, excessive depth and delegation-chain revocation.

### F14 — Task-scoped permissions
Dependencies: F11, F13. Status: `planned`.

- Issue and enforce task-bound grants with exact resources, capabilities, expiry and revocation reference.
- Reject reuse in another task, principal, tenant or environment and verify task completion closes remaining authority.

### F15 — Agent behavioral baselines
Dependencies: F53. Status: `planned`.

- Maintain tenant-separated baselines for tool sequence, volume, resources and destinations using privacy-safe telemetry.
- Provide cold-start behavior, reviewable thresholds, drift monitoring and adversarial tests for poisoning and false positives.

### F16 — Adaptive risk scoring
Dependencies: F03, F15, F17. Status: `planned`.

- Combine attributable deterministic risk signals into versioned, explainable scores and escalation rules.
- Ensure risk scoring never overrides an explicit denial or expands authority; test missing signals and monitor-to-enforce calibration.

### F17 — Action-chain analysis
Dependencies: F30, F31, F55. Status: `planned`.

- Evaluate stateful sequence policies across a task, including read-export-upload combinations and prohibited transitions.
- Test interleaved agents, concurrent steps, evasion by renaming actions, state loss and TTL expiry without leaking data between tenants.

### F18 — Kill switch
Dependencies: F11, F55. Status: `planned`.

- Revoke permission for new actions by agent, principal, tenant or deployment with bounded propagation and attributed administration.
- Test in-flight versus new-action semantics, disconnected stores and recovery; do not claim already committed external effects can be undone.

### F19 — Agent execution leases
Dependencies: F11, F55. Status: `planned`.

- Require renewable, signed or store-backed execution leases bound to task, identity, resource scope and expiry.
- Test lease expiry, clock skew, stale holders, reconnects and revoked renewals using fencing where external systems support it.

### F20 — Workflow security policies
Dependencies: F13, F14, F55. Status: `planned`.

- Apply policy to workflow entry, transitions, retries and completion with durable workflow identity and step correlation.
- Test resume, replay, cancellation and independent workflow dispatch paths rather than relying only on agent tool hooks.

### F21 — MCP 2026 specification support
Dependencies: none. Status: `planned`.

- Implement the reviewed MCP 2026-07-28 contract with version negotiation/migration boundaries, required routing headers and stateless request validation.
- Run the official supported SDK/conformance scenarios and reject header/body disagreement; document legacy 2025-11-25 behavior explicitly.

### F22 — Multi Round-Trip Request security
Dependencies: F21, F14. Status: `planned`.

- Bind additional input requests and responses to the original MCP action, authority, scope and expiry.
- Re-evaluate changed actions and reject replayed, cross-request or unauthorized continuations, including user-confirmation substitutions.

### F23 — Dynamic tool visibility
Dependencies: F21, F11. Status: `planned`.

- Filter tools/list according to verified caller policy without weakening execution-time authorization.
- Preserve pagination and protocol validity; test tenant-specific caches, stale listings and direct calls to hidden tools.

### F24 — Continuous MCP integrity monitoring
Dependencies: F21, F19. Status: `planned`.

- Revalidate inventories on a configurable schedule and supported change notifications, with reviewable drift and atomic lockfile promotion.
- Test metadata/schema expansion, concurrent scans, revoked trust, outages and propagation before subsequent tool execution.

### F25 — MCP server trust profiles
Dependencies: F03, F24. Status: `planned`.

- Define versioned, attributable profiles for trusted, third-party, unknown and high-risk servers with explicit least-privilege defaults.
- Test profile transitions and unknown servers; a server cannot self-assert trusted status via its descriptions or annotations.

### F26 — MCP OAuth security
Dependencies: F01, F02, F11, F21. Status: `planned`.

- Validate issuer, resource/audience, scope and credential binding per the reviewed protocol and authorization standards.
- Test discovery SSRF, redirect/mix-up attacks, token leakage and downstream audience confusion; never blindly forward a caller token.

### F27 — MCP response streaming guard
Dependencies: F21, F34. Status: `planned`.

- Parse and filter supported streamed MCP responses with correct event framing, request correlation and JSON-RPC error semantics.
- Test fragmented events, malformed frames, cancellation, reconnects and batch isolation; enabling output policy cannot leave an SSE passthrough.

### F28 — MCP tool execution analytics
Dependencies: F21, F53. Status: `planned`.

- Expose per-server/tool usage, denial, cost, latency, error and approval metrics with bounded labels and tenant authorization.
- Test event correlation, duplicated delivery, redaction and missing outcome handling without exporting raw payloads by default.

### F29 — MCP supply-chain verification
Dependencies: F24, F25. Status: `planned`.

- Verify supported publisher identity, package signatures and provenance against explicit trust roots and reviewed artifacts.
- Reject digest/signature mismatch, rollback and untrusted publishers; surface unsupported verification as unknown rather than trusted.

### F30 — Data classification engine
Dependencies: none. Status: `planned`.

- Apply configurable public/internal/confidential/restricted labels from trusted rules or classifiers with evidence and inheritance.
- Test nested data, ambiguity, unknown types and user attempts to lower a label; keep classification separate from model assertions.

### F31 — Sensitive data tracking
Dependencies: F30, F35, F55. Status: `planned`.

- Propagate classification and provenance through declared tool inputs, outputs and workflow steps without retaining raw sensitive content by default.
- Test transformed, combined and cross-agent data as well as concurrency; declare untracked opaque transformations instead of assuming declassification.

### F32 — PII detection and redaction
Dependencies: F30. Status: `planned`.

- Provide configured structured detectors and redactors for common PII, credentials and domain-specific identifiers.
- Test multilingual formats, false positives, nesting, arrays, primitive outputs and encoded content; document detection limits and external DLP integration.

### F33 — Output schema enforcement
Dependencies: none. Status: `planned`.

- Validate output contracts before disclosure and revalidate rewritten output using bounded schema processing.
- Test primitives, arrays, circular/unsupported values and redaction-induced invalidity; external schema references must not trigger uncontrolled fetches.

### F34 — Streaming DLP
Dependencies: F30, F32. Status: `planned`.

- Maintain bounded detector state across byte/UTF-8/chunk boundaries and withhold undecided content before disclosure.
- Test split secrets, incomplete suffixes, buffer exhaustion and cancellation; define bounded lookahead and fail-closed handling for unsupported detectors.

### F35 — Content provenance
Dependencies: F11. Status: `planned`.

- Attach attributable source labels for tools, documents, services and users with separation of trusted control metadata from untrusted text.
- Test spoofed origins, label preservation, document-to-tool propagation and redaction without leaking identifiers across tenants.

### F36 — Prompt-injection risk signals
Dependencies: F03, F35. Status: `planned`.

- Produce reviewable signals for suspicious tool responses and MCP metadata without treating model-based detection as an authorization guarantee.
- Test multilingual/encoded/indirect instruction patterns and false positives; deterministic authority limits remain enforced when detection misses.

### F37 — Data export restrictions
Dependencies: F02, F09, F30, F31. Status: `planned`.

- Evaluate classified data against the destination, resource ownership, approved purpose and applicable export permissions before egress.
- Test read-export-upload chains, redirects, transformed output and cross-tenant destinations; unknown classification cannot silently become public.

### F38 — Custom output processors
Dependencies: F33, F35. Status: `planned`.

- Expose ordered, typed sanitizer/classifier hooks with bounded execution and explicit trust requirements.
- Test processor failure, timeout and mutation; processors cannot override a prior denial or leak raw content to telemetry.

### F39 — Approval dashboard
Dependencies: F11, F44, F53. Status: `planned`.

- Build an authenticated, tenant-isolated reviewer UI that displays exact action, resources, changes, scope, expiry and history.
- Test reviewer authorization, XSS in tool-supplied content, CSRF, concurrency and audit privacy; no approval based only on a free-text summary.

### F40 — Slack and Microsoft Teams approvals
Dependencies: F39, F41. Status: `planned`.

- Implement both workplace approval integrations with verified platform callbacks and mapped authorized reviewers.
- Test forged, replayed and expired interactions, channel/tenant confusion and secret redaction without allowing chat text to grant authority.

### F41 — Multi-person approval
Dependencies: F11, F44, F55. Status: `planned`.

- Support explicit quorum and separation-of-duties rules with distinct authorized reviewers bound to one immutable action.
- Test duplicate approvals, self-approval restrictions, changed actions, concurrent votes and expired/revoked quorums.

### F42 — Approval delegation and escalation
Dependencies: F39, F41. Status: `planned`.

- Route pending approvals to eligible delegates or escalation groups under bounded time and authority rules.
- Preserve quorum and separation of duties; test absence, expiry, re-routing loops and identity changes.

### F43 — Approval fatigue protection
Dependencies: F39, F55. Status: `planned`.

- Deduplicate exact pending requests, rate-limit approval storms and surface scope expansion clearly to reviewers.
- Test grouping without semantic conflation, adversarial flood, broad-grant warnings and preservation of exact action bindings.

### F44 — Emergency revocation
Dependencies: F11, F55. Status: `planned`.

- Revoke approval grants, agent authority and tool access across instances with attributable administrative actions and bounded propagation.
- Test race with execution, cached grants, disconnected instances and recovery; define already-executed action limitations.

### F45 — Python SDK and runtime
Dependencies: none. Status: `planned`.

- Provide a real Python distribution implementing the shared action/policy contract and supported execution boundaries.
- Run cross-language golden vectors for canonical hashes, decisions, grants, quotas and error modes; document deliberately unsupported features.

### F46 — Native Mayura adapter
Dependencies: F13, F20, F33. Status: `planned`.

- Qualify the Dvar-backed Mayura firewall package as a single-install integration with native permissions/budgets preserved.
- Test real Mayura tool, workflow, direct invocation, approval, output and cancellation paths; raw-proposal and validated-input boundaries must not diverge silently.

### F47 — LangChain/LangGraph adapter
Dependencies: F20, F33. Status: `planned`.

- Provide native adapters for both supported LangChain tool execution and LangGraph workflow boundaries with verified context mapping.
- Run real SDK consumer tests for allow/deny/approval/output, sync/async/streaming calls, resume and interruption behavior.

### F48 — Additional framework adapters
Dependencies: F33. Status: `planned`.

- Qualify named integrations for Mastra, LlamaIndex and OpenAI Agents SDK rather than declaring support through structural types alone.
- Maintain pinned compatibility tests, supported-version policy, cancellation and approval/output conformance for every advertised adapter.

### F49 — Policy presets
Dependencies: F03. Status: `planned`.

- Ship reviewed starter policies for support, coding, finance and infrastructure agents with explicit authority and monitor/enforce guidance.
- Include allow/deny/approval fixtures, tenant boundaries and safe secret handling; examples must validate against the actual policy schema.

### F50 — Policy simulator
Dependencies: F17, F20. Status: `planned`.

- Simulate representative workflows, stateful controls and policy differences without invoking real tools or mutating production state.
- Provide deterministic explain traces and counterexamples from actual evaluation; test that dry runs never consume approvals or production quotas.

### F51 — VS Code extension
Dependencies: F49, F52. Status: `planned`.

- Ship a functional editor extension with schema completion, policy diagnostics, rule navigation and deterministic explanations.
- Test extension packaging and trusted-workspace behavior; opening a policy must not execute tools or disclose secrets remotely.

### F52 — Policy migration tools
Dependencies: none. Status: `planned`.

- Provide versioned dry-run migrations with explicit diffs, backup/rollback guidance and unsupported-policy diagnostics.
- Test semantic-preservation fixtures and refusal of lossy migrations without acknowledgment; no silent broadening of permissions.

### F53 — OpenTelemetry integration
Dependencies: none. Status: `in_progress`.

- Emit correlated agent/action/tool/approval/output spans and bounded metrics through standard exporters with privacy-safe defaults.
- Pin the supported semantic-convention version; test Dhal trace correlation, exporter failure isolation, redaction and cardinality limits.

### F54 — Security analytics dashboard
Dependencies: F28, F39, F53. Status: `planned`.

- Build a tenant-authorized dashboard for denials, risky tools, approval latency, runtime limits and policy/inventory drift.
- Test RBAC, privacy, pagination, filter integrity and degraded telemetry; display missing data rather than invented sample statistics.

### F55 — Distributed enforcement hardening
Dependencies: none. Status: `in_progress`.

- Implement atomic multi-control reservations, idempotency, bounded state and recovery for real Redis and Valkey deployments.
- Run concurrency, partition, reconnect, clock-skew, replay and crash tests; document consistency guarantees, no-double-charge behavior and safe degraded modes.

## Cross-cutting architecture constraints

Dvar remains an independent, open-source, local-first action-security runtime. Identity integrates with existing issuers; delegated credentials integrate with vaults rather than turning Dvar into a secrets manager. Sandbox adapters do not pretend JavaScript path checks provide OS isolation. DLP is scoped to protected data flows and interoperates with specialized services. Dashboards are optional operational interfaces, not a prerequisite for offline policy enforcement.

`dvar explain` is included in F50 as an actual deterministic evaluation trace, not an additional 56th feature. Named alternative sandbox backends require an honest support matrix; one real qualified backend must exist before F07 can be verified. F48 explicitly includes Mastra, LlamaIndex and OpenAI Agents consumer tests. F40 requires both Slack and Teams.

## Slice 01 status

Local candidate implements a default-deny, IP-pinned, bounded HTTP(S) transport plus the release hold and this tracker. F01 and F02 remain in progress; no feature has been declared fully verified. This slice does not implement arbitrary TCP/UDP policy, transparent process egress interception, long-lived event-stream filtering, or the other 53 features.

## Standards basis

Protocol and security integration work must use primary specifications pinned in tests. Reviewed planning references:
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- MCP 2026-07-28 release: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Node HTTPS/TLS API: https://nodejs.org/api/https.html
- IANA IPv4 and IPv6 special-purpose registries: https://www.iana.org/assignments/iana-ipv4-special-registry/ and https://www.iana.org/assignments/iana-ipv6-special-registry/


## Slice 02 status

F55 has started with opt-in atomic quota admission and bounded idempotency receipts. See `progress/slice-02-atomic-quotas.md` for the implementation, local verification, and outstanding real-server/runtime qualification. The acceptance criteria above remain unchanged. No feature is verified and publication remains on hold.

## Slice 03 status

F53 has started with opt-in OpenTelemetry API/SDK injection, a runtime observation facade, bounded metrics, explicit W3C context propagation, and privacy-safe decision/approval/output observations. See `progress/slice-03-opentelemetry.md` for local contract-test evidence and outstanding SDK/runtime/exporter qualification. All acceptance criteria remain unchanged; no feature is verified and publication remains on hold.


## Slice 04 status

F11 and F09 have started with an opt-in identity-verifying, resource-ownership boundary around existing Dvar protected tools. Identity claims are provided by a trusted application verifier, not model arguments. The boundary rechecks identity and ownership/version before dispatch; executor-side conditional writes remain required. See `progress/slice-04-identity-ownership.md` for verified local evidence and pending real runtime/provider qualification. All 55 acceptance criteria and release approvals are unchanged. Publication remains on hold.
