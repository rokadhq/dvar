# Dvar Output Guard

Dvar v0.6 introduces post-execution output protection. It filters or denies tool output before the output is returned to the application, agent, or model context.

## Why output protection exists

Tool output can contain credentials, personal data, adversarial instructions, oversized content, binary payloads, tenant-crossing data, or content that induces unsafe follow-on actions.

Argument policy controls what may be executed. Output policy controls what may come back.

## Execution model

For protected function tools, Dvar executes the tool, records the tool execution outcome, filters the result, and returns either the filtered value or a `DvarOutputPolicyError`.

For MCP Streamable HTTP proxying, Dvar filters JSON/text upstream responses before forwarding them to the client. Streaming event responses are not semantically transformed in v0.6.

## Controls

Output guard supports:

- output size limits;
- JSON/text/binary classification;
- binary denial by default;
- allowed content type lists;
- configured field redaction;
- configured dotted-path redaction;
- configured regex redaction;
- built-in secret redaction for common token shapes;
- configured deny patterns;
- bounded summaries for audit metadata;
- optional untrusted-source marking.

## Built-in secret redaction

Built-in patterns cover common shapes such as API-key assignments, bearer tokens, and AWS access-key IDs. These are convenience guardrails, not complete DLP.

High-assurance deployments should add explicit redaction rules for domain-specific secrets and regulated identifiers.

## Denial versus redaction

Redaction preserves the response shape where possible. Denial blocks the raw response entirely.

Use redaction for expected sensitive fields. Use denial for outputs that should never enter model context, such as binary payloads, oversized content, cross-tenant data, or prompt-injection markers.

## Summarization is not a boundary

A model-generated summary is not a security boundary. Sensitive raw output must be filtered before it reaches any model-based summarizer or transformer.

## Residual risks

- Built-in secret patterns are not exhaustive.
- Regex rules can miss encoded or transformed secrets.
- Field and path redaction require predictable response shape.
- MCP event streams are not semantically transformed in v0.6.
- Output guard cannot protect outputs that bypass Dvar.
- Redaction can change application semantics and must be tested.
