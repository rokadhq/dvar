import { describe, test, expect } from 'vitest';
import { createDvar, DvarDeniedError, DvarApprovalRequiredError, DvarOutputPolicyError } from '../src/index.js';
import { createOpenTelemetryBridge, instrumentDvarRuntime } from '../src/telemetry/index.ts';
import { fakeOtel } from './fixtures.mjs';

async function setup(policy = {}, outputGuard) {
  const otel = fakeOtel(), bridge = createOpenTelemetryBridge(otel);
  const raw = await createDvar({ policy: { schemaVersion: '1', mode: 'enforce', defaultEffect: 'allow', ...policy },
    eventSink: bridge.eventSink, ...(outputGuard === undefined ? {} : { outputGuard }) });
  return { ...otel, bridge, raw, runtime: instrumentDvarRuntime(raw, bridge) };
}
const context = { principal: { id: 'private-user', type: 'user' }, agent: { id: 'private-agent' },
  environment: 'production', task: { id: 'private-task' } };

describe('telemetry on the actual Dvar runtime', () => {
  test('records one execution and prevents the second after quota denial', async () => {
    const f = await setup({ runtime: { maxToolCallsPerTask: 1 } }); let executions = 0;
    try {
      const tool = f.runtime.protectTool({ name: 'lookup', execute: () => ({ count: ++executions }) });
      await expect(tool({}, context)).resolves.toEqual({ count: 1 });
      await expect(tool({}, context)).rejects.toBeInstanceOf(DvarDeniedError);
      expect(executions).toBe(1); expect(f.spans.filter(s => s.name === 'dvar.tool')).toHaveLength(1);
      expect(JSON.stringify(f.spans)).not.toContain('private-user');
    } finally { f.bridge.close(); }
  });
  test('leaves approval-gated execution blocked', async () => {
    const f = await setup({ defaultEffect: 'require_approval' }); let executions = 0;
    try {
      const tool = f.runtime.protectTool({ name: 'payment', execute: () => ++executions });
      await expect(tool({}, context)).rejects.toBeInstanceOf(DvarApprovalRequiredError);
      expect(executions).toBe(0); expect(f.spans.filter(s => s.name === 'dvar.tool')).toHaveLength(0);
    } finally { f.bridge.close(); }
  });
  test('keeps output redaction and logs only bounded observations', async () => {
    const f = await setup({}, { policy: { redact: [{ id: 'secret', field: 'secret' }] } });
    try {
      const tool = f.runtime.protectTool({ name: 'read', execute: () => ({ secret: 'DO_NOT_LOG' }) });
      await expect(tool({}, context)).resolves.toEqual({ secret: '[REDACTED]' });
      expect(JSON.stringify([f.spans, f.measurements])).not.toContain('DO_NOT_LOG');
      expect(f.spans[0].events.some(e => e.name === 'dvar.output')).toBe(true);
    } finally { f.bridge.close(); }
  });
  test('denied output does not cause another executor invocation', async () => {
    const f = await setup({}, { policy: { maxBytes: 1 } }); let executions = 0;
    try {
      const tool = f.runtime.protectTool({ name: 'read', execute: () => { executions++; return { large: 'data' }; } });
      await expect(tool({}, context)).rejects.toBeInstanceOf(DvarOutputPolicyError); expect(executions).toBe(1);
      expect(f.spans.filter(s => s.name === 'dvar.tool')).toHaveLength(1);
    } finally { f.bridge.close(); }
  });
  test('preserves executor error identity', async () => {
    const f = await setup(); const error = new Error('private-failure');
    try {
      const tool = f.runtime.protectTool({ name: 'read', execute: () => { throw error; } });
      await expect(tool({}, context)).rejects.toBe(error); expect(JSON.stringify(f.spans)).not.toContain('private-failure');
    } finally { f.bridge.close(); }
  });
});
