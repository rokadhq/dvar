import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context, trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, MetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
const { createOpenTelemetryBridge } = await import(process.env.DVAR_TELEMETRY_ENTRY ?? '../../dist/telemetry.js');

class Reader extends MetricReader {
  constructor() { super({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE }); }
  async onForceFlush() {}
  async onShutdown() {}
}
function fixture(exporter = new InMemorySpanExporter()) {
  const cm = new AsyncLocalStorageContextManager().enable(); context.setGlobalContextManager(cm);
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const reader = new Reader(), meterProvider = new MeterProvider({ readers: [reader] });
  const tracer = provider.getTracer('dvar.sdk.test');
  const bridge = createOpenTelemetryBridge({ tracer, meter: meterProvider.getMeter('dvar.sdk.test'),
    context, trace, rootContext: ROOT_CONTEXT });
  return { bridge, provider, reader, tracer, exporter, async close() {
    bridge.close(); await provider.shutdown(); await meterProvider.shutdown(); cm.disable(); context.disable();
  } };
}

test('real SDK: active parent, real active span, output event and bounded metrics', async () => {
  const f = fixture();
  try {
    const parent = f.tracer.startSpan('http.request');
    await context.with(trace.setSpan(ROOT_CONTEXT, parent), () => f.bridge.run('action', { toolName: 'secret' }, () =>
      f.bridge.run('tool', {}, () => {
        trace.getActiveSpan().addEvent('application.event');
        f.bridge.eventSink({ type: 'dvar.action.allowed', outputStatus: 'redacted', outputContentType: 'json',
          outputBytes: 10, outputRedactionCount: 2, actionId: 'sensitive' });
        return 1;
      })));
    parent.end(); await f.provider.forceFlush();
    const spans = f.exporter.getFinishedSpans(), tool = spans.find(s => s.name === 'dvar.tool');
    assert.equal(tool.spanContext().traceId, parent.spanContext().traceId);
    assert.equal(tool.events[0].name, 'application.event');
    assert.equal(tool.events[1].name, 'dvar.output');
    assert.ok(!JSON.stringify(spans.map(s => [s.name, s.attributes, s.events])).includes('sensitive'));
    const collection = await f.reader.collect();
    const metrics = collection.resourceMetrics.scopeMetrics.flatMap(s => s.metrics);
    const redactions = metrics.find(m => m.descriptor.name === 'dvar.output.redactions');
    assert.equal(redactions.dataPoints.reduce((n, p) => n + p.value, 0), 2);
  } finally { await f.close(); }
});

test('real SDK: 100 simultaneous remote parents remain isolated', async () => {
  const f = fixture();
  try {
    await Promise.all(Array.from({ length: 100 }, (_, i) => f.bridge.withTraceparent(
      `00-${(i + 1).toString(16).padStart(32, '0')}-${'a'.repeat(16)}-01`, () =>
      f.bridge.run('tool', {}, async () => { await Promise.resolve(); return i; }))));
    await f.provider.forceFlush();
    const spans = f.exporter.getFinishedSpans(); assert.equal(spans.length, 100);
    assert.equal(new Set(spans.map(s => s.spanContext().traceId)).size, 100);
  } finally { await f.close(); }
});

test('real SDK: exporter failure does not replay or fail application execution', async () => {
  let exported = 0;
  const f = fixture({ export(spans, callback) { exported += spans.length; callback({ code: 1, error: new Error('export failed') }); },
    async shutdown() {} });
  try {
    let effects = 0;
    assert.equal(await f.bridge.run('tool', {}, () => ++effects), 1);
    await f.provider.forceFlush().catch(() => {});
    assert.equal(effects, 1); assert.ok(exported > 0);
  } finally { await f.close(); }
});
