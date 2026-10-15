import { AsyncLocalStorage } from 'node:async_hooks';

/** Protocol-contract harness, not the real OpenTelemetry SDK. */
export function fakeOtel() {
  const als = new AsyncLocalStorage();
  const rootContext = Object.freeze({});
  const spans = [], measurements = [], instruments = [];
  let serial = 0;
  const trace = { setSpanContext: (parent, span) => ({ ...parent, span }),
    setSpan: (parent, activeSpan) => ({ ...parent, span: activeSpan.spanContext(), activeSpan }) };
  const context = { active: () => als.getStore() ?? rootContext, with: (ctx, fn) => als.run(ctx, fn) };
  const tracer = { startSpan(name, options = {}, parent = context.active()) {
    const id = ++serial;
    const sc = { traceId: parent.span?.traceId ?? id.toString(16).padStart(32, '0'),
      spanId: id.toString(16).padStart(16, '0'), traceFlags: parent.span?.traceFlags ?? 1 };
    const record = { name, attributes: { ...options.attributes }, events: [], status: { code: 0 },
      parent: parent.span, context: sc, ended: 0 };
    const span = {
      spanContext: () => sc,
      setAttributes: attrs => Object.assign(record.attributes, attrs),
      setStatus: status => { record.status = { ...status }; },
      addEvent: (event, attrs) => { record.events.push({ name: event, attributes: { ...attrs } }); },
      end: () => { record.ended++; }
    };
    record.api = span;
    spans.push(record);
    return span;
  } };
  const make = (kind, name, options) => {
    instruments.push({ kind, name, ...options });
    return (value, attrs) => { measurements.push({ kind, name, value, attributes: { ...attrs } }); };
  };
  const meter = { createCounter: (name, options) => ({ add: make('counter', name, options) }),
    createHistogram: (name, options) => ({ record: make('histogram', name, options) }) };
  return { tracer, meter, context, trace, rootContext, spans, measurements, instruments };
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
