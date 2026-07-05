# Dvar Approval Lifecycle

Dvar approvals are deterministic and bounded.

The lifecycle is: policy interruption, structured request, provider review, signed grant, re-evaluation, use-count consumption, then execution.

Supported scopes are `once`, `session`, and `task`. One-time grants bind the semantic action hash and allow one use. Session and task grants require their context identifier and remain bounded by expiry and use count.

The reference signer uses canonical claims and constant-time verification. Material action values are represented through bindings rather than copied into the grant.

`InMemoryApprovalUseStore` is for one-process deployments. Distributed enforcement requires a shared atomic implementation of `DvarApprovalUseStore`.

Provider failure is fail-closed unless explicitly configured otherwise; strict mode always fails closed. Approval values should remain outside prompts, tool arguments, ordinary logs, and downstream headers.
