/** Stable, minimal structural surface of the OpenTelemetry JS API (1.9).
 * Supply real API/SDK instances. Dvar never owns a provider or exporter.
 */
export type DvarOtelAttributes = Record<string, string | number | boolean>;
export interface DvarOtelSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  isRemote?: boolean;
}
export interface DvarOtelSpan {
  spanContext(): DvarOtelSpanContext;
  setAttributes(attributes: DvarOtelAttributes): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  addEvent(name: string, attributes?: DvarOtelAttributes): unknown;
  end(): unknown;
}
export interface DvarOtelTracer<C, S extends DvarOtelSpan = DvarOtelSpan> {
  startSpan(name: string, options?: {
    kind?: number;
    attributes?: DvarOtelAttributes;
  }, context?: C): S;
}
export interface DvarOtelMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): {
    add(value: number, attributes?: DvarOtelAttributes): void;
  };
  createHistogram(name: string, options?: { description?: string; unit?: string }): {
    record(value: number, attributes?: DvarOtelAttributes): void;
  };
}
export interface DvarOtelContextApi<C> {
  active(): C;
  with<T>(context: C, callback: () => T): T;
}
export interface DvarOtelTraceApi<C, S extends DvarOtelSpan = DvarOtelSpan> {
  setSpanContext(context: C, spanContext: DvarOtelSpanContext): C;
  setSpan?(context: C, span: S): C;
}
export type DvarTelemetryOperation =
  | "agent" | "action" | "evaluate" | "authorize" | "resume"
  | "quota" | "approval" | "tool" | "outcome";
export interface DvarTelemetryMetadata {
  toolName?: string;
  agentName?: string;
  mode?: string;
}
/** Audit input is only projected through explicit finite enums below. Never spread it. */
export interface DvarTelemetryEvent {
  type: string;
  effect?: string;
  observedEffect?: string;
  reasonCode?: string;
  outputStatus?: string;
  outputContentType?: string;
  outputBytes?: number;
  outputRedactionCount?: number;
  approvalScope?: string;
}
export interface DvarTelemetryDiagnostics {
  activeSpans: number;
  startedSpans: number;
  endedSpans: number;
  droppedSpans: number;
  droppedEvents: number;
  ignoredEvents: number;
  adapterErrors: number;
  expiredSpans: number;
  closed: boolean;
}
export interface DvarOpenTelemetryOptions<C, S extends DvarOtelSpan = DvarOtelSpan> {
  tracer: DvarOtelTracer<C, S>;
  meter?: DvarOtelMeter;
  context: DvarOtelContextApi<C>;
  trace: DvarOtelTraceApi<C, S>;
  rootContext: C;
  /** Application-reviewed public aliases. No raw name is exported without a mapping. */
  toolAliases?: Readonly<Record<string, string>>;
  agentAliases?: Readonly<Record<string, string>>;
  maxActiveSpans?: number;
  maxEventsPerSpan?: number;
  /** End observation, NOT execution, after this interval. */
  maxSpanDurationMs?: number;
  /** Explicit opt-in to the pinned DEVELOPMENT GenAI conventions, never "latest". */
  genAiConvention?: "1.37.0";
}
export interface DvarOpenTelemetryBridge {
  run<T>(operation: DvarTelemetryOperation, metadata: DvarTelemetryMetadata,
    callback: () => T | Promise<T>): Promise<T>;
  eventSink(event: DvarTelemetryEvent): void;
  /** Explicit trust boundary. Only W3C version 00; no baggage/tracestate forwarding. */
  withTraceparent<T>(value: string, callback: () => T | Promise<T>): Promise<T>;
  diagnostics(): DvarTelemetryDiagnostics;
  /** Ends owned observations; does not close SDK providers/exporters or abort tools. */
  close(): void;
}
