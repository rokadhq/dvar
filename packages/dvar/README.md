# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates tool actions before side effects occur and returns a deterministic `allow`, `deny`, or `require_approval` decision.

> **Status:** `0.3.0-alpha.0`. Public contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## Version 0.3

Dvar 0.3 adds:

- structured approval requests;
- signed, expiring approval grants;
- bounded `once`, `session`, and `task` scopes;
- replay detection and configurable use limits;
- provider interfaces and a webhook reference provider;
- runtime interruption and resume APIs;
- approval-aware MCP proxying;
- OpenAI Agents interruption helpers;
- approval lifecycle audit events.

```yaml
rules:
  - id: approve-refund
    effect: require_approval
    when:
      tool.name: billing.refund
    approval:
      provider: webhook
      scope: once
      expiresInSeconds: 300
      maxUses: 1
      bind:
        - principal.id
        - agent.id
        - tenant.id
        - environment
        - server.id
        - tool.name
        - arguments
```

Use `@rokadhq/dvar/approvals` for signers, providers, and approval-use stores. Use `runtime.resume(action, grant)` to continue a delayed action after verification.

Use `@rokadhq/dvar/adapters/openai-agents` for structurally typed interruption helpers without an additional runtime dependency.

The MCP proxy accepts delayed approval grants through `X-Dvar-Approval-Grant`; Dvar consumes this header locally and does not forward it to the upstream tool server.

## Deployment note

`InMemoryApprovalUseStore` is intended for development and single-process deployments. Distributed enforcement requires an atomic shared implementation of `DvarApprovalUseStore`.

See `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
