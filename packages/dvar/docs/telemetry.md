# OpenTelemetry foundation (v1 development)

Dvar's opt-in `@rokadhq/dvar/telemetry` entry point observes existing execution boundaries.
It does not evaluate policy, spend quotas, consume approval grants, or decide whether a tool may run.
It is a Node.js integration; no OpenTelemetry provider, exporter, global context manager, network
connection, or dependency is installed merely by importing Dvar.

**Status:** F53 is in progress. The local contract suite is not SDK or production qualification.
No public package release is authorized before the complete 55-feature v1 scope is verified.

## Application-owned SDK

Configure an OpenTelemetry SDK in the application before constructing the bridge. The application
owns exporters, sampling, resource attributes, collection destinations, flushing, and shutdown.
Pass its real tracer, optional meter, and API objects into Dvar:

```ts
import { context, trace, metrics, ROOT_CONTEXT } from "@opentelemetry/api";
import { createDvar } from "@rokadhq/dvar";
import {
  createOpenTelemetryBridge,
  instrumentDvarRuntime,
} from "@rokadhq/dvar/telemetry";

const telemetry = createOpenTelemetryBridge({
  tracer: trace.getTracer("@rokadhq/dvar", "v1-development"),
  meter: metrics.getMeter("@rokadhq/dvar", "v1-development"),
  context,
  trace,
  rootContext: ROOT_CONTEXT,
  toolAliases: { "crm.lookup-customer": "customer-lookup" },
  maxActiveSpans: 512,
  maxEventsPerSpan: 64,
  maxSpanDurationMs: 300_000,
});

const dvar = instrumentDvarRuntime(
  await createDvar({
    policyPath: "dvar.yaml",
    eventSink: telemetry.eventSink,
  }),
  telemetry,
);
```

Both attachments matter. The facade measures public runtime operations and actual protected-tool
execution. The event sink observes internal decisions, approvals, and output filtering. Omitting
the event sink leaves those internal observations unavailable; omitting the facade leaves only
instantaneous audit observations. Existing audit persistence can be composed separately:

```ts
const eventSink = (event) => {
  telemetry.eventSink(event);
  return existingAuditSink(event);
};
```

The existing sink retains its previous behavior, access controls and privacy responsibilities.
Use the **returned facade**, including when passing a runtime to framework/MCP integrations.
Direct calls to the original runtime bypass facade spans. This does not bypass Dvar enforcement.

## Span semantics

| Boundary | Observation |
| --- | --- |
| `evaluate`, `authorize`, `resume` | A span for the actual method call, with its returned effect. Evaluation does not become authorization. |
| `commitRuntime` | A quota/runtime-commit observation, not an execution permit issued by telemetry. |
| `requestApproval` | The provider call's duration; not the entire asynchronous human-review wait. |
| `recordOutcome` | Outcome-recording duration; not reconstructed historical execution time. |
| `protectTool()` result | An outer action span and a child span only when the existing runtime actually calls the executor. |
| Decision, approval and output audit events | Sanitized span events under the active Dvar observation, or an instantaneous `dvar.audit` span outside it. |

A denied action never generates an invented execution span. Expected policy denials keep the
span's default status and carry `dvar.result=deny`; execution errors have a finite `error.type`
and ERROR status, with no exception message or stack. Output filtering has separate audit
observations so v0.7's reused `dvar.action.*` output-event names do not double-count authorization.
Approval and output events are **not yet dedicated operation spans** on every internal boundary.

For an application-owned agent lifecycle, explicitly wrap the real operation:

```ts
const result = await telemetry.run("agent", { agentName: "support-agent" }, runAgent);
```

Dvar does not infer an agent invocation or token usage from a tool call.

## Context and Dhal correlation

An existing OpenTelemetry active context is used as the parent. A correctly configured asynchronous
context manager preserves parentage across promises and concurrent requests. The bridge retains
an actual SDK span in the context when `trace.setSpan` is available; a minimal API can use
`setSpanContext` as a fallback.

Dhal and Dvar can share an application HTTP-request trace. Dvar does not reparent itself to a
completed Dhal inspection span or copy Dhal's request/URL fields. The Dhal adapter reviewed at
commit `b43b7b2d0ac2431a06f8093087d04ae5cd55141e` emits its own `dhal.inspect` observation; full
Dhal-in-application correlation remains an integration qualification task.

Explicit remote propagation is available after the application establishes its trust boundary:

```ts
await telemetry.withTraceparent(acceptedTraceparent, () => dvar.authorize(action));
```

Only exact W3C **version 00** headers are accepted. Zero ids, uppercase encodings, malformed
lengths and unsupported versions are rejected. Reserved flag bits are ignored; the sampled bit
is preserved. This helper starts from the supplied root context and does not import baggage or
tracestate. It does not read arbitrary request headers, `action.trace`, tenant ids, or model input.
A trace identifier is correlation data, not identity or authorization evidence. Reject or replace
untrusted remote contexts at ingress. SDK processors and other instrumentation remain responsible
for any data they independently add to traces.

## Privacy and cardinality

The bridge uses a fixed projection, not broad serialization or regex scrubbing. By default it
exports no raw tool/agent/principal/tenant/task/session/action ids, arguments, output values,
URLs, headers, credentials, policy hashes, approval tokens, reviewer ids, messages or stacks.
Only explicitly mapped tool/agent **public aliases** are exported on spans. Maps are snapshotted,
limited to 128 entries each, and alias values to 64 ASCII identifier characters.

Metric dimensions contain finite enums only; aliases and arbitrary policy/rule ids never become
metric dimensions. Unknown values fold into `unknown` or `other`. Instruments are allocated once:

| Instrument | Unit | Dimensions |
| --- | --- | --- |
| `dvar.operation.completed` | `{operation}` | Operation, mode, finite result |
| `dvar.operation.duration` | `s` | Operation, mode, finite result |
| `dvar.decision.count` | `{decision}` | Effect, observed effect, finite reason family |
| `dvar.approval.count` | `{approval}` | Lifecycle status and scope |
| `dvar.output.count` | `{output}` | Status, content type, effect and observed effect |
| `dvar.output.size` | `By` | Content type only |
| `dvar.output.redactions` | `{redaction}` | Content type only |

Monitor-mode `allow` and `would_deny` remain distinct observations. Byte/redaction counts must be
non-negative safe integers. Numeric measurements are not labels. Counts are observations, not a
uniquely delivered audit ledger; duplicate delivery from an external caller is not deduplicated.

## Isolation and resource limits

Synchronous tracer, span, context and metric API failures are isolated from application results.
A context API that throws before/after invoking a callback cannot trigger a second invocation.
Application errors propagate unchanged. The bridge never waits for an exporter flush.

No same-process JavaScript library can preempt an exporter or custom callback that synchronously
blocks the event loop. SDK-owned asynchronous exporter failures, queueing and retries must follow
the SDK contract and are separately qualified. Custom telemetry code is trusted application code,
not a sandbox.

Limits bound concurrent observations and retained span events. At capacity, observations are dropped,
not application calls. A span-duration deadline ends **observation only**, never cancels the tool or
claims it finished. `diagnostics()` reports local counters, drops, API errors and expired spans;
it does not prove delivery to a collector. `close()` ends active observations and rejects no
application execution. The application must separately flush/shut down its SDK.

## Versioned conventions

Dvar custom telemetry schema is version `1`. GenAI names/attributes are disabled by default.
`genAiConvention: "1.37.0"` explicitly enables the pinned, **development-status** subset for actual
`invoke_agent` and `execute_tool` spans. Public aliases can stand in for names as an intentional
privacy choice. No claim of current/latest or complete GenAI semantic-convention support is made.
Constants include `DVAR_GENAI_SEMCONV_VERSION` and `DVAR_GENAI_SCHEMA_URL` for applications that
scope their own tracer accordingly. Changes to this mapping require reviewed migration notes.

Primary references reviewed for this slice:
- OpenTelemetry libraries: https://opentelemetry.io/docs/concepts/instrumentation/libraries/
- OpenTelemetry JS propagation: https://opentelemetry.io/docs/languages/js/propagation/
- Pinned GenAI convention: https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-spans.md
- W3C Trace Context: https://www.w3.org/TR/trace-context/

## Verification commands

After the normal build, `npm run test:telemetry` exercises ESM and CommonJS package entry points.
The same contract cases and separate real-Dvar integration cases are included in Vitest.

Real-SDK tests are **mandatory future qualification**, not silently skipped when dependencies
are unavailable. The separate private fixture pins API 1.9.0 and JS SDK 2.2.0. It is not included
as a runtime dependency or as an advertised supported-version matrix yet:

```bash
npm --prefix packages/dvar/test-telemetry/sdk install --ignore-scripts
npm --prefix packages/dvar/test-telemetry/sdk run typecheck
npm run test:telemetry:sdk
```

Resolve and review the fixture's transitive lockfile before reproducible release qualification.
The SDK tests cover real exported spans, metrics, async correlation, and a failing exporter.
Full MCP/stdio integration, collector delivery/recovery, sampling/load benchmarks and independent
privacy/security review remain required before F53 can be verified.
