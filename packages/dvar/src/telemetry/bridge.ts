import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { aliases, DVAR_TELEMETRY_SCHEMA_VERSION, enumValue, modeValue, own, parseTraceparent, projectEvent, validSpanContext } from "./privacy.js";
import type { DvarOpenTelemetryBridge, DvarOpenTelemetryOptions, DvarOtelAttributes, DvarOtelSpan, DvarTelemetryDiagnostics, DvarTelemetryMetadata, DvarTelemetryOperation } from "./types.js";

const OPERATIONS = ["agent", "action", "evaluate", "authorize", "resume", "quota", "approval", "tool", "outcome"] as const;
interface Observation<C> { span: DvarOtelSpan; context: C; events: number; finish(result: string): void; ended: boolean }

function bound(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new TypeError("Telemetry limit is outside its supported range.");
  return n;
}
function outcome(operation: DvarTelemetryOperation, result: unknown): string {
  if (["evaluate", "authorize", "resume", "quota"].includes(operation)) {
    return enumValue(own(result, "effect"), ["allow", "deny", "require_approval"], "completed");
  }
  if (operation === "approval") return enumValue(own(result, "status"), ["approved", "rejected", "pending"], "completed");
  // Never inspect a tool/agent payload to guess its outcome.
  return "completed";
}
function failed(error: unknown): string {
  const code = own(error, "code");
  const decision = own(error, "decision");
  if (own(decision, "effect") === "deny") return "blocked";
  if (own(decision, "effect") === "require_approval") return "approval_required";
  if (typeof code === "string" && code.length < 128 && code.startsWith("output.")) return "output_error";
  return "error";
}

/** Pass actual SDK tracer/meter and API context/trace objects. No provider globals are changed. */
export function createOpenTelemetryBridge<C, S extends DvarOtelSpan>(options: DvarOpenTelemetryOptions<C, S>): DvarOpenTelemetryBridge {
  if (typeof options?.tracer?.startSpan !== "function" || typeof options.context?.active !== "function" ||
    typeof options.context?.with !== "function" || typeof options.trace?.setSpanContext !== "function") {
    throw new TypeError("Telemetry requires OpenTelemetry tracer, context and trace APIs.");
  }
  if (options.genAiConvention !== undefined && options.genAiConvention !== "1.37.0") throw new TypeError("Unsupported GenAI convention version.");
  const maxActive = bound(options.maxActiveSpans, 512, 10_000);
  const maxEvents = bound(options.maxEventsPerSpan, 64, 256);
  const maxDuration = bound(options.maxSpanDurationMs, 300_000, 3_600_000);
  const toolAliases = aliases(options.toolAliases), agentAliases = aliases(options.agentAliases);
  const active = new Set<Observation<C>>();
  const local = new AsyncLocalStorage<Observation<C>>();
  const stats: DvarTelemetryDiagnostics = { activeSpans: 0, startedSpans: 0, endedSpans: 0, droppedSpans: 0,
    droppedEvents: 0, ignoredEvents: 0, adapterErrors: 0, expiredSpans: 0, closed: false };
  const add = (key: keyof Omit<DvarTelemetryDiagnostics, "closed">) => { stats[key] = Math.min(stats[key] + 1, Number.MAX_SAFE_INTEGER); };
  const safely = <T>(f: () => T): T | undefined => { try { return f(); } catch { add("adapterErrors"); return undefined; } };
  const counter = (name: string, unit = "{operation}") => safely(() => options.meter?.createCounter(name, { unit }));
  const histogram = (name: string, unit: string) => safely(() => options.meter?.createHistogram(name, { unit }));
  // Fixed instrument inventory: never create instruments in response to event/tool names.
  const operations = counter("dvar.operation.completed");
  const durations = histogram("dvar.operation.duration", "s");
  const decisions = counter("dvar.decision.count", "{decision}");
  const approvals = counter("dvar.approval.count", "{approval}");
  const outputs = counter("dvar.output.count", "{output}");
  const outputSizes = histogram("dvar.output.size", "By");
  const redactions = counter("dvar.output.redactions", "{redaction}");

  function begin(operation: string, metadata: DvarTelemetryMetadata): Observation<C> | undefined {
    if (stats.closed || active.size >= maxActive) { add("droppedSpans"); return undefined; }
    const mode = modeValue(metadata.mode);
    const attrs: DvarOtelAttributes = { "dvar.operation": operation, "dvar.mode": mode, "dvar.telemetry.schema_version": DVAR_TELEMETRY_SCHEMA_VERSION };
    const tool = metadata.toolName === undefined ? undefined : toolAliases.get(metadata.toolName);
    const agent = metadata.agentName === undefined ? undefined : agentAliases.get(metadata.agentName);
    if (tool !== undefined) attrs["dvar.tool.alias"] = tool;
    if (agent !== undefined) attrs["dvar.agent.alias"] = agent;
    let name = `dvar.${operation}`;
    if (options.genAiConvention && (operation === "tool" || operation === "agent")) {
      const genOperation = operation === "tool" ? "execute_tool" : "invoke_agent";
      const alias = operation === "tool" ? tool : agent;
      name = `${genOperation}${alias ? ` ${alias}` : ""}`;
      attrs["gen_ai.operation.name"] = genOperation;
      attrs["dvar.gen_ai.semconv_version"] = options.genAiConvention;
      if (alias) attrs[operation === "tool" ? "gen_ai.tool.name" : "gen_ai.agent.name"] = alias;
    }
    const parent = safely(() => options.context.active()) ?? options.rootContext;
    const span = safely(() => options.tracer.startSpan(name, { kind: 0, attributes: attrs }, parent));
    if (!span) { add("droppedSpans"); return undefined; }
    let child = parent;
    const sc = safely(() => span.spanContext());
    if (sc && safely(() => validSpanContext(sc))) {
      // Preserve the actual SDK span when available, so downstream manual
      // instrumentation can call getActiveSpan().addEvent() normally.
      child = safely(() => options.trace.setSpan !== undefined
        ? options.trace.setSpan(parent, span)
        : options.trace.setSpanContext(parent, {
            traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags & 1
          })) ?? parent;
    }
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const scope: Observation<C> = { span, context: child, events: 0, ended: false, finish(result) {
      if (scope.ended) return;
      scope.ended = true;
      clearTimeout(timer);
      active.delete(scope);
      stats.activeSpans = active.size;
      add("endedSpans");
      const elapsed = Math.max(0, Math.min((performance.now() - started) / 1000, maxDuration / 1000));
      safely(() => span.setAttributes({ "dvar.result": result }));
      if (["error", "output_error", "observation_timeout"].includes(result)) {
        safely(() => span.setAttributes({ "error.type": result }));
        safely(() => span.setStatus({ code: 2 }));
      }
      // A policy deny is an expected decision, not a fabricated execution failure.
      safely(() => span.end());
      const labels = { "dvar.operation": operation, "dvar.mode": mode, "dvar.result": result };
      safely(() => operations?.add(1, labels));
      safely(() => durations?.record(elapsed, labels));
    } };
    active.add(scope);
    stats.activeSpans = active.size;
    add("startedSpans");
    timer = setTimeout(() => { add("expiredSpans"); scope.finish("observation_timeout"); }, maxDuration);
    timer.unref();
    return scope;
  }

  async function run<T>(operation: DvarTelemetryOperation, metadata: DvarTelemetryMetadata, callback: () => T | Promise<T>): Promise<T> {
    if (!OPERATIONS.includes(operation)) throw new TypeError("Unknown telemetry operation.");
    const scope = safely(() => begin(operation, metadata));
    let pending: Promise<T> | undefined;
    const once = (): Promise<T> => {
      pending ??= Promise.resolve().then(callback);
      return pending;
    };
    if (scope) {
      // A broken context manager may invoke then throw, invoke twice, or never invoke.
      // Observe only the one application promise; never retry its side effect.
      const returned = safely(() => local.run(scope, () => options.context.with(scope.context, once)));
      if (returned !== undefined && returned !== pending) void Promise.resolve(returned).catch(() => { add("adapterErrors"); });
    }
    try {
      const result = await (pending ?? once());
      const disposition = safely(() => outcome(operation, result)) ?? "completed";
      safely(() => scope?.finish(disposition));
      return result;
    } catch (error) {
      const disposition = safely(() => failed(error)) ?? "error";
      safely(() => scope?.finish(disposition));
      throw error;
    }
  }

  return {
    run,
    eventSink(event) {
      if (stats.closed) { add("droppedEvents"); return; }
      safely(() => {
        const projected = projectEvent(event);
        if (!projected) { add("ignoredEvents"); return; }
        const { name, attributes } = projected;
        const instrument = name === "dvar.decision" ? decisions : name === "dvar.approval" ? approvals : outputs;
        safely(() => instrument?.add(1, attributes));
        if (projected.bytes !== undefined) safely(() => outputSizes?.record(projected.bytes!, {
          "dvar.output.content_type": attributes["dvar.output.content_type"]!
        }));
        if (projected.redactions !== undefined) safely(() => redactions?.add(projected.redactions!, {
          "dvar.output.content_type": attributes["dvar.output.content_type"]!
        }));
        const scope = local.getStore();
        if (scope) {
          if (scope.ended || scope.events >= maxEvents) { add("droppedEvents"); return; }
          scope.events += 1;
          safely(() => scope.span.addEvent(name, { ...attributes,
            ...(projected.bytes === undefined ? {} : { "dvar.output.bytes": projected.bytes }),
            ...(projected.redactions === undefined ? {} : { "dvar.output.redactions": projected.redactions })
          }));
        } else {
          // A standalone audit observation is instantaneous, not a tool execution span.
          const observation = begin("audit", {});
          if (!observation) { add("droppedEvents"); return; }
          safely(() => observation.span.addEvent(name, attributes));
          observation.finish("observed");
        }
      });
    },
    async withTraceparent<T>(value: string, callback: () => T | Promise<T>): Promise<T> {
      const parsed = parseTraceparent(value);
      if (!parsed) throw new TypeError("Invalid version-00 traceparent.");
      const remote = safely(() => options.trace.setSpanContext(options.rootContext, parsed));
      let pending: Promise<T> | undefined;
      const once = () => pending ??= Promise.resolve().then(callback);
      if (remote !== undefined) {
        const returned = safely(() => options.context.with(remote, once));
        if (returned !== undefined && returned !== pending) void Promise.resolve(returned).catch(() => { add("adapterErrors"); });
      }
      return pending ?? once();
    },
    diagnostics: () => ({ ...stats }),
    close() {
      if (stats.closed) return;
      stats.closed = true;
      for (const scope of active) scope.finish("shutdown");
      // No local.disable(): in-flight application continuations must still run.
    }
  };
}
