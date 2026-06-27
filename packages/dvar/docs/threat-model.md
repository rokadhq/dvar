# Dvar Threat Model

Dvar treats model output, user content, tool metadata, MCP servers, approval requests, provider responses, and external destinations as potentially hostile.

Version 0.3 adds structured approval requests, semantic action hashing, signed and bounded grants, expiry and use-count enforcement, replay resistance, provider failure separation, strict-mode fail-closed behavior, MCP grant stripping, and privacy-conscious approval events.

Residual approval risks include compromised signing keys or providers, inattentive reviewers, overly broad session or task bindings, and process-local replay tracking in distributed deployments. Approval does not prove correct reasoning or replace IAM, application authorization, sandboxing, or separation of duties.

Tool output filtering, distributed quotas, stdio process containment, and OpenTelemetry exporters remain later controls.
