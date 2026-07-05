# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It enforces policy, approvals, integrity, runtime safety, local-tool hardening, and output protection around side effects.

> **Status:** `0.6.0-alpha.0`. Public contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## Version 0.6

Dvar 0.6 adds `@rokadhq/dvar/output-guard` and integrated output filtering for protected tools and MCP responses:

- maximum output size;
- JSON/text/binary content classification;
- binary denial by default;
- field, path, pattern, and built-in secret redaction;
- configured deny-pattern blocking;
- bounded audit metadata.

```ts
const dvar = await createDvar({
  policyPath: "dvar.yaml",
  outputGuard: {
    policy: {
      maxBytes: 64_000,
      redact: [{ id: "token", pattern: "token=[A-Za-z0-9._~+/=-]+" }],
      deny: [{ id: "prompt-injection", pattern: "ignore previous instructions" }]
    }
  }
});
```

Output filtering is not summarization. Raw sensitive output is filtered before any model-based transformation.

See `docs/output-guard.md`, `docs/stdio-hardening.md`, `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
