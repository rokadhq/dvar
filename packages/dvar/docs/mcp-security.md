# MCP Security in Dvar v0.2

Dvar v0.2 introduces a review-and-enforce workflow for remote MCP servers using Streamable HTTP.

## Workflow

1. `dvar scan` initializes a server and retrieves all pages of `tools/list`.
2. Dvar canonicalizes tool definitions, schemas, annotations, inferred capabilities, and contextual risk.
3. `dvar diff` compares the observed inventory with `dvar.lock.json`.
4. A human reviews the changes.
5. `dvar lock` explicitly replaces the approved lockfile.
6. `dvar proxy` evaluates `tools/call` requests before forwarding them upstream.

Scanning never modifies the lockfile automatically.

## What the lockfile proves

The lockfile proves that the currently observed server inventory matches a reviewed inventory. It does not prove that the server implementation is benign or that its runtime behavior matches its description.

Dvar records both reviewable definition fields and canonical hashes. This enables meaningful pull-request diffs and deterministic runtime checks.

## Diff risk classes

Dvar classifies changes including:

- server addition, removal, endpoint change, or manifest change;
- tool addition or removal;
- description and annotation changes;
- input-schema widening, narrowing, or unclassified change;
- output-schema change;
- capability expansion or reduction;
- contextual risk change.

Schema relation analysis is conservative and currently focuses on object-property, required-field, and `additionalProperties` changes. Unclassified structural changes are treated as changed rather than assumed safe.

## Proxy identity

The proxy does not infer a real user from an MCP session. The host application should provide attributable identity headers. An omitted principal becomes the explicit `anonymous` principal, which policy may deny.

Do not expose the default proxy listener to untrusted networks without an authenticated front door. The default CLI listener is loopback-only.

## Credentials

Dvar does not relay the caller's `Authorization` header by default. This prevents the proxy from becoming an implicit token relay. Configure a narrowly scoped upstream credential using `--upstream-header`, or explicitly enable caller-token forwarding only when the trust model requires it.

Dvar never writes configured header values into inventory or lockfile output.

## Transport behavior

The scanner performs the MCP initialization handshake, handles `MCP-Session-Id`, sends the negotiated `MCP-Protocol-Version`, paginates `tools/list`, accepts JSON and SSE-framed JSON-RPC responses, and attempts session termination after scanning.

The proxy forwards Streamable HTTP GET, POST, and DELETE traffic, preserves MCP and trace headers, supports JSON-RPC batches, and emits local JSON-RPC errors for denied or approval-gated tool calls.

## Plain HTTP

Plain HTTP is permitted automatically only for loopback development endpoints. Non-loopback plaintext endpoints require an explicit unsafe override. Production MCP servers should use HTTPS.
