import assert from 'node:assert/strict';
import { fakeOtel, deferred, pause } from './fixtures.mjs';

export function telemetryCases(test, { createOpenTelemetryBridge: create, instrumentDvarRuntime: instrument, parseTraceparent, DVAR_GENAI_SEMCONV_VERSION }) {
  const fixture = extra => { const otel = fakeOtel(); return { ...otel, bridge: create({ ...otel, ...extra }) }; };
  const dec = (extra = {}) => ({ type: 'dvar.action.allowed', effect: 'allow', reasonCode: 'policy.allow', ...extra });
  const count = (f, name) => f.measurements.filter(m => m.name === name).reduce((sum, m) => sum + m.value, 0);

  test('nests explicit agent, action and execution spans without fabricating inference', async () => {
    const f = fixture({ genAiConvention: '1.37.0', toolAliases: { privateTool: 'lookup' }, agentAliases: { internalAgent: 'support' } });
    await f.bridge.run('agent', { agentName: 'internalAgent' }, () => f.bridge.run('action', { toolName: 'privateTool' }, () =>
      f.bridge.run('tool', { toolName: 'privateTool' }, () => 42)));
    assert.deepEqual(f.spans.map(s => s.name), ['invoke_agent support', 'dvar.action', 'execute_tool lookup']);
    assert.equal(f.spans[2].parent.spanId, f.spans[1].context.spanId);
    assert.equal(f.spans[1].parent.spanId, f.spans[0].context.spanId);
    assert.equal(new Set(f.spans.map(s => s.context.traceId)).size, 1);
    assert.ok(f.spans.every(s => s.ended === 1));
    assert.equal(DVAR_GENAI_SEMCONV_VERSION, '1.37.0');
    assert.equal(f.spans[2].attributes['gen_ai.operation.name'], 'execute_tool');
    f.bridge.close();
  });

  test('uses an existing HTTP/Dhal-compatible parent context without forwarding baggage as attributes', async () => {
    const f = fixture();
    const parent = { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 };
    await f.context.with({ span: parent, baggage: 'secret' }, () => f.bridge.run('authorize', {}, () => ({ effect: 'deny' })));
    assert.equal(f.spans[0].parent.spanId, parent.spanId);
    assert.equal(f.spans[0].context.traceId, parent.traceId);
    assert.equal(f.spans[0].status.code, 0);
    assert.equal(f.spans[0].attributes['dvar.result'], 'deny');
    assert.ok(!JSON.stringify(f.spans).includes('secret'));
    f.bridge.close();
  });

  test('explicit version-00 parent preserves trace ids and sampled bit', async () => {
    const f = fixture();
    await f.bridge.withTraceparent(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-03`, () => f.bridge.run('tool', {}, () => true));
    assert.equal(f.spans[0].context.traceId, 'a'.repeat(32));
    assert.equal(f.spans[0].parent.spanId, 'b'.repeat(16));
    assert.equal(f.spans[0].parent.traceFlags, 1);
    assert.equal(f.spans[0].parent.isRemote, true);
    f.bridge.close();
  });

  const invalidParents = ['', 'x', `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`, `00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`,
    `ff-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, `01-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    `00-${'A'.repeat(32)}-${'b'.repeat(16)}-01`, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-gg`,
    `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01\n`, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01-extra`, null, 1];
  invalidParents.forEach((parent, i) => test(`rejects malformed or unsupported traceparent ${i}`, async () => {
    const f = fixture(); let called = false;
    assert.equal(parseTraceparent(parent), undefined);
    await assert.rejects(f.bridge.withTraceparent(parent, () => { called = true; }));
    assert.equal(called, false); f.bridge.close();
  }));

  test('does not read credentials, URLs, identity or content into spans/metrics', async () => {
    const f = fixture(); const secret = 'NEVER_EXPORT_THIS_PAYLOAD';
    await f.bridge.run('action', { toolName: secret, agentName: secret, mode: secret }, () => {
      f.bridge.eventSink(dec({ actionId: secret, principalId: secret, tenantId: secret, toolName: secret,
        message: secret, approvalGrantId: secret, reasonCode: secret, metadata: { secret } }));
      return { secret };
    });
    assert.ok(!JSON.stringify([f.spans, f.measurements]).includes(secret)); f.bridge.close();
  });

  test('allows only reviewed aliases and never puts them in metric dimensions', async () => {
    const f = fixture({ toolAliases: { dynamicSecret: 'reviewed' } });
    await f.bridge.run('tool', { toolName: 'dynamicSecret' }, () => 'done');
    assert.equal(f.spans[0].attributes['dvar.tool.alias'], 'reviewed');
    assert.ok(!JSON.stringify(f.measurements).includes('reviewed')); f.bridge.close();
  });

  for (const [key, bad] of [['maxActiveSpans', 0], ['maxActiveSpans', 10001], ['maxEventsPerSpan', 257],
    ['maxEventsPerSpan', 1.1], ['maxSpanDurationMs', Infinity], ['maxSpanDurationMs', -1],
    ['genAiConvention', 'latest'], ['toolAliases', { x: 'https://secret/path' }],
    ['agentAliases', Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), 'a']))]]) {
    test(`rejects invalid ${key}: ${String(bad).slice(0,12)}`, () => assert.throws(() => fixture({ [key]: bad })));
  }

  test('classifies output audit events once, not as a second authorization', async () => {
    const f = fixture(); await f.bridge.run('action', {}, () => {
      f.bridge.eventSink(dec());
      f.bridge.eventSink(dec({ outputStatus: 'redacted', outputContentType: 'json', outputBytes: 42, outputRedactionCount: 2 }));
      f.bridge.eventSink({ type: 'dvar.integrity.mismatch', effect: 'deny' });
      f.bridge.eventSink({ type: 'dvar.action.proposed' });
    });
    assert.equal(count(f, 'dvar.decision.count'), 1); assert.equal(count(f, 'dvar.output.count'), 1);
    assert.equal(count(f, 'dvar.output.redactions'), 2); assert.equal(count(f, 'dvar.output.size'), 42);
    assert.deepEqual(f.spans[0].events.map(e => e.name), ['dvar.decision', 'dvar.output']);
    assert.equal(f.bridge.diagnostics().ignoredEvents, 2); f.bridge.close();
  });

  test('preserves monitor-mode observed effects independently of allow', async () => {
    const f = fixture(); await f.bridge.run('authorize', { mode: 'monitor' }, () => {
      f.bridge.eventSink(dec({ observedEffect: 'would_deny' })); return { effect: 'allow', observedEffect: 'would_deny' };
    });
    const event = f.spans[0].events[0].attributes;
    assert.equal(event['dvar.effect'], 'allow'); assert.equal(event['dvar.observed_effect'], 'would_deny');
    assert.equal(f.spans[0].attributes['dvar.result'], 'allow'); f.bridge.close();
  });

  const approvalTypes = ['dvar.approval.requested', 'dvar.approval.pending', 'dvar.action.approved', 'dvar.action.rejected',
    'dvar.approval.provider_error', 'dvar.approval.consumed', 'dvar.approval.replay_detected'];
  for (const type of approvalTypes) test(`records bounded approval observation ${type}`, () => {
    const f = fixture(); f.bridge.eventSink({ type, approvalScope: 'once', approvalGrantId: 'sensitive' });
    assert.equal(count(f, 'dvar.approval.count'), 1); assert.equal(f.spans[0].name, 'dvar.audit');
    assert.ok(!JSON.stringify(f.spans).includes('sensitive')); f.bridge.close();
  });

  for (const bad of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '42']) test(`ignores invalid output measurements ${bad}`, () => {
    const f = fixture(); f.bridge.eventSink(dec({ outputStatus: 'allowed', outputBytes: bad, outputRedactionCount: bad }));
    assert.equal(count(f, 'dvar.output.redactions'), 0); assert.equal(count(f, 'dvar.output.size'), 0); f.bridge.close();
  });

  test('limits span events while keeping bounded metric counters', async () => {
    const f = fixture({ maxEventsPerSpan: 2 }); await f.bridge.run('action', {}, () => {
      for (let i = 0; i < 10; i++) f.bridge.eventSink(dec());
    });
    assert.equal(f.spans[0].events.length, 2); assert.equal(f.bridge.diagnostics().droppedEvents, 8);
    assert.equal(count(f, 'dvar.decision.count'), 10); f.bridge.close();
  });

  test('allocates instruments once and folds unbounded labels into finite enums', () => {
    const f = fixture(); for (let i = 0; i < 1000; i++) f.bridge.eventSink(dec({ effect: `user-${i}`, reasonCode: `user-${i}.x` }));
    assert.equal(f.instruments.length, 7);
    assert.equal(new Set(f.measurements.filter(m => m.name === 'dvar.decision.count').map(m => JSON.stringify(m.attributes))).size, 1);
    f.bridge.close();
  });

  test('isolates 200 concurrent operation contexts even with identical external call ids', async () => {
    const f = fixture(); await Promise.all(Array.from({ length: 200 }, (_, i) => f.bridge.withTraceparent(
      `00-${(i + 1).toString(16).padStart(32, '0')}-${'f'.repeat(16)}-01`, () => f.bridge.run('action', {}, async () => {
        await pause(i % 3); f.bridge.eventSink(dec()); await f.bridge.run('tool', {}, () => i);
      }))));
    assert.equal(f.spans.length, 400); assert.equal(new Set(f.spans.map(s => s.context.traceId)).size, 200);
    assert.equal(f.bridge.diagnostics().activeSpans, 0);
    assert.ok(f.spans.filter(s => s.name === 'dvar.action').every(s => s.events.length === 1)); f.bridge.close();
  });

  test('drops observation at capacity without blocking execution', async () => {
    const f = fixture({ maxActiveSpans: 1 }); const hold = deferred();
    const first = f.bridge.run('tool', {}, () => hold.promise); await pause(1);
    assert.equal(await f.bridge.run('tool', {}, () => 7), 7); assert.equal(f.bridge.diagnostics().droppedSpans, 1);
    hold.resolve(8); assert.equal(await first, 8); f.bridge.close();
  });

  test('expires observation without aborting or duplicating a long-running operation', async () => {
    const f = fixture({ maxSpanDurationMs: 10 }); let executions = 0;
    const result = await f.bridge.run('tool', {}, async () => { executions++; await pause(30); f.bridge.eventSink(dec()); return 9; });
    assert.equal(result, 9); assert.equal(executions, 1); assert.equal(f.spans[0].ended, 1);
    assert.equal(f.spans[0].attributes['dvar.result'], 'observation_timeout');
    assert.equal(f.bridge.diagnostics().expiredSpans, 1); f.bridge.close();
  });

  test('shutdown closes owned spans but never the exporter or application operation', async () => {
    const f = fixture(); const hold = deferred(); const work = f.bridge.run('tool', {}, () => hold.promise);
    await pause(1); f.bridge.close(); f.bridge.close(); hold.resolve(10); assert.equal(await work, 10);
    assert.equal(f.spans[0].ended, 1); assert.equal(await f.bridge.run('tool', {}, () => 11), 11);
    f.bridge.eventSink(dec()); assert.equal(f.bridge.diagnostics().droppedEvents, 1);
  });

  for (const hook of ['startSpan', 'active', 'setSpan', 'createCounter', 'createHistogram']) {
    test(`isolates ${hook} exception`, async () => {
      const otel = fakeOtel(); for (const obj of [otel.tracer, otel.context, otel.trace, otel.meter]) {
        if (hook in obj) obj[hook] = () => { throw new Error('never export api secrets'); };
      }
      const b = create(otel); let executions = 0;
      assert.equal(await b.run('tool', {}, () => ++executions), 1);
      assert.ok(b.diagnostics().adapterErrors > 0); b.close();
    });
  }

  for (const hook of ['spanContext', 'setAttributes', 'setStatus', 'addEvent', 'end']) {
    test(`isolates span.${hook} exception and preserves thrown application error`, async () => {
      const otel = fakeOtel(); const start = otel.tracer.startSpan; otel.tracer.startSpan = (...args) => {
        const s = start(...args); s[hook] = () => { throw new Error('telemetry secret'); }; return s;
      };
      const b = create(otel), originalError = new Error('application secret');
      await assert.rejects(b.run('tool', {}, () => { b.eventSink(dec()); throw originalError; }), e => e === originalError);
      assert.equal(b.diagnostics().activeSpans, 0); assert.ok(b.diagnostics().adapterErrors > 0);
      assert.ok(!JSON.stringify(otel.spans).includes('application secret')); b.close();
    });
  }

  for (const behavior of ['before', 'after', 'twice', 'never', 'rejected-return']) {
    test(`context manager ${behavior} cannot cause an extra side effect`, async () => {
      const otel = fakeOtel(); const old = otel.context.with;
      otel.context.with = (ctx, fn) => {
        if (behavior === 'before') throw new Error('context failed');
        if (behavior === 'never') return undefined;
        const value = old(ctx, fn);
        if (behavior === 'after') throw new Error('after callback');
        if (behavior === 'twice') old(ctx, fn);
        if (behavior === 'rejected-return') return Promise.reject(new Error('telemetry result'));
        return value;
      };
      const b = create(otel); let executions = 0;
      assert.equal(await b.run('tool', {}, () => ++executions), 1); assert.equal(executions, 1); b.close();
    });
  }

  test('application rejection is not misreported as an adapter error', async () => {
    const f = fixture(); const error = new Error('original');
    await assert.rejects(f.bridge.run('tool', {}, () => Promise.reject(error)), e => e === error);
    assert.equal(f.bridge.diagnostics().adapterErrors, 0); f.bridge.close();
  });

  test('does not invoke getters on returned tool payloads or audit fields', async () => {
    const f = fixture(); const output = {}; let invoked = 0;
    Object.defineProperty(output, 'effect', { get() { invoked++; throw new Error(); } });
    assert.equal(await f.bridge.run('tool', {}, () => output), output);
    const event = dec(); Object.defineProperty(event, 'reasonCode', { get() { invoked++; throw new Error(); } });
    f.bridge.eventSink(event); assert.equal(invoked, 0); f.bridge.close();
  });

  test('retains the actual active SDK span for application manual events', async () => {
    const f = fixture(); await f.bridge.run('tool', {}, () => {
      f.context.active().activeSpan.addEvent('app.manual', { ok: true });
    });
    assert.equal(f.spans[0].events[0].name, 'app.manual'); f.bridge.close();
  });

  test('supports the minimal SpanContext-only trace API', async () => {
    const otel = fakeOtel(); delete otel.trace.setSpan; const b = create(otel);
    await b.run('action', {}, () => b.run('tool', {}, () => 1));
    assert.equal(otel.spans[1].parent.spanId, otel.spans[0].context.spanId); b.close();
  });

  test('isolates metric record/add failures without affecting execution', async () => {
    const otel = fakeOtel();
    otel.meter.createCounter = () => ({ add() { throw new Error('metrics down'); } });
    otel.meter.createHistogram = () => ({ record() { throw new Error('metrics down'); } });
    const b = create(otel); assert.equal(await b.run('tool', {}, () => { b.eventSink(dec()); return 1; }), 1);
    assert.ok(b.diagnostics().adapterErrors >= 3); b.close();
  });

  test('finishes observation even when a malformed decision proxy traps inspection', async () => {
    const f = fixture(); const value = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
    assert.equal(await f.bridge.run('authorize', {}, () => value), value);
    assert.equal(f.bridge.diagnostics().activeSpans, 0); f.bridge.close();
  });

  function forwardingRuntime(bridge, effect = 'allow') {
    const calls = [], executions = [];
    const r = { policy: { mode: 'enforce' }, marker: 123, diagnostics() { return this.marker; },
      async evaluate(...args) { calls.push(['evaluate', args]); bridge.eventSink(dec({ effect })); return { effect }; },
      async authorize(...args) { calls.push(['authorize', args]); bridge.eventSink(dec({ effect })); return { effect }; },
      async resume(...args) { calls.push(['resume', args]); return { effect }; },
      async commitRuntime(...args) { calls.push(['commitRuntime', args]); return { effect }; },
      async requestApproval(...args) { calls.push(['requestApproval', args]); bridge.eventSink({ type: 'dvar.approval.requested' }); return { status: 'pending' }; },
      async recordOutcome(...args) { calls.push(['recordOutcome', args]); },
      protectTool(definition) { return async (args, ctx) => {
        const decision = await r.authorize({ tool: { name: definition.name } });
        if (decision.effect !== 'allow') throw Object.assign(new Error('blocked'), { decision });
        executions.push(args); const result = await definition.execute(args, ctx);
        bridge.eventSink(dec({ outputStatus: 'allowed', outputContentType: 'json' })); return result;
      }; }
    };
    return { r, calls, executions };
  }

  test('runtime facade preserves arguments, grants, return values and unobserved members', async () => {
    const f = fixture(); const { r, calls } = forwardingRuntime(f.bridge);
    const wrapped = instrument(Object.freeze(r), f.bridge); const action = { tool: { name: 'secret' } }, grant = { approvalGrant: 'sensitive' };
    await wrapped.authorize(action, grant); assert.equal(calls[0][1][0], action); assert.equal(calls[0][1][1], grant);
    assert.equal(wrapped.authorize, wrapped.authorize); assert.equal(wrapped.policy, r.policy);
    assert.equal(wrapped.diagnostics(), 123); assert.deepEqual(Object.keys(wrapped), Object.keys(r));
    assert.ok(!JSON.stringify(f.spans).includes('sensitive')); f.bridge.close();
  });

  test('runtime facade never executes a tool when the underlying runtime denies', async () => {
    const f = fixture(); const { r, executions } = forwardingRuntime(f.bridge, 'deny');
    const wrapped = instrument(r, f.bridge); const tool = wrapped.protectTool({ name: 'x', execute() { throw new Error('must not run'); } });
    await assert.rejects(tool({}, {})); assert.equal(executions.length, 0);
    assert.equal(f.spans.filter(s => s.name === 'dvar.tool').length, 0);
    assert.equal(f.spans[0].attributes['dvar.result'], 'blocked'); f.bridge.close();
  });

  test('runtime facade only traces actual executor calls and retains definition this', async () => {
    const f = fixture(); const { r, executions } = forwardingRuntime(f.bridge);
    const wrapped = instrument(r, f.bridge); const output = { exact: true };
    const definition = { name: 'x', marker: output, execute(args, ctx) { assert.equal(ctx.secret, 'not logged'); assert.equal(args.a, 1); return this.marker; } };
    const tool = wrapped.protectTool(definition); assert.equal(await tool({ a: 1 }, { secret: 'not logged' }), output);
    assert.equal(executions.length, 1); assert.deepEqual(f.spans.map(s => s.name), ['dvar.action', 'dvar.tool']);
    assert.deepEqual(f.spans[0].events.map(e => e.name), ['dvar.decision', 'dvar.output']);
    assert.ok(!JSON.stringify(f.spans).includes('not logged')); f.bridge.close();
  });

  for (const [method, op] of [['evaluate','evaluate'], ['authorize','authorize'], ['resume','resume'],
    ['commitRuntime','quota'], ['requestApproval','approval'], ['recordOutcome','outcome']]) {
    test(`runtime forwards ${method} without assuming tool execution`, async () => {
      const f = fixture(); const { r, calls } = forwardingRuntime(f.bridge); const wrapped = instrument(r, f.bridge);
      const args = [{ agent: { id: 'a' } }, { sensitive: true }]; await wrapped[method](...args);
      assert.equal(calls[0][0], method); assert.equal(calls[0][1][1], args[1]); assert.equal(f.spans[0].name, `dvar.${op}`);
      assert.equal(f.spans.filter(s => s.name === 'dvar.tool').length, 0); f.bridge.close();
    });
  }
}
