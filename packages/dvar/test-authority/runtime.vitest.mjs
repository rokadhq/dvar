/** Actual Dvar runtime integration. Requires repository dependencies; do not substitute the contract harness. */
import { test, expect } from 'vitest';
import { createDvar, createHmacApprovalSigner, InMemoryApprovalUseStore, DvarDeniedError, DvarOutputPolicyError } from '../src/index.ts';
import * as api from '../src/authority/index.ts';
import { fixture, CREDENTIAL, resource } from './fixtures.mjs';

const policy = { schemaVersion: '1', mode: 'enforce', defaultEffect: 'allow' };
const secret = '0123456789abcdef0123456789abcdef';
const approvalPolicy = { ...policy, defaultEffect: 'require_approval' };

// Default require_approval creates a request using the default once scope and action hash.
test('real runtime: identity boundary retains task quota enforcement and no double reservation', async () => {
  const runtime = await createDvar({ policy: { ...policy, runtime: { maxToolCallsPerTask: 1 } } });
  const f = fixture(api, { runtime });
  await expect(f.call()).resolves.toEqual({ id: 'order-1', ok: true });
  await expect(f.call()).rejects.toBeInstanceOf(DvarDeniedError);
  expect(f.state.executions).toBe(1);
});

test('real runtime: output guard still redacts after the authority-protected executor', async () => {
  const runtime = await createDvar({ policy, outputGuard: { policy: { redact: [{ id: 'secret', field: 'secret' }] } } });
  const f = fixture(api, { runtime, execute: () => ({ secret: 'private', ok: true }) });
  await expect(f.call()).resolves.toEqual({ secret: '[REDACTED]', ok: true });
});

test('real runtime: denied output remains a DvarOutputPolicyError', async () => {
  const runtime = await createDvar({ policy, outputGuard: { policy: { maxBytes: 4 } } });
  const f = fixture(api, { runtime });
  await expect(f.call()).rejects.toBeInstanceOf(DvarOutputPolicyError);
});

test('real runtime: matching preview approval resumes exactly one wrapped invocation', async () => {
  const signer = createHmacApprovalSigner({ issuer: 'test', secret });
  const runtime = await createDvar({ policy: approvalPolicy, approval: { signer, useStore: new InMemoryApprovalUseStore() } });
  const f = fixture(api, { runtime });
  const preview = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
  const grant = await signer.issue(preview.decision.approvalRequest, { approver: { id: 'reviewer' } });
  await expect(f.call(undefined, { approvalGrant: grant.token })).resolves.toMatchObject({ ok: true });
  await expect(f.call(undefined, { approvalGrant: grant.token })).rejects.toMatchObject({ code: 'approval.grant_replayed' });
  expect(f.state.executions).toBe(1);
});

test('real runtime: a changed resource version invalidates a once approval from preview', async () => {
  const signer = createHmacApprovalSigner({ issuer: 'test', secret });
  const runtime = await createDvar({ policy: approvalPolicy, approval: { signer, useStore: new InMemoryApprovalUseStore() } });
  let version = 'one'; const f = fixture(api, { runtime, resolve: () => resource({ version }) });
  const preview = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
  const grant = await signer.issue(preview.decision.approvalRequest, { approver: { id: 'reviewer' } });
  version = 'two';
  await expect(f.call(undefined, { approvalGrant: grant.token })).rejects.toMatchObject({ code: 'approval.binding_mismatch' });
  expect(f.state.executions).toBe(0);
});

test('real runtime: owner/version change during immediate provider approval is blocked at dispatch', async () => {
  const signer = createHmacApprovalSigner({ issuer: 'test', secret }); let version = 'one';
  const runtime = await createDvar({ policy: approvalPolicy, approval: { signer, provider: {
    name: 'manual', request: async request => {
      const grant = await signer.issue(request, { approver: { id: 'reviewer' } });
      version = 'two'; return { status: 'approved', requestId: request.id, grant: grant.token };
    }
  } } });
  const f = fixture(api, { runtime, resolve: () => resource({ version }) });
  await expect(f.call()).rejects.toMatchObject({ code: 'ownership.changed' });
  expect(f.state.executions).toBe(0);
});

for (const mode of ['off', 'monitor', 'enforce', 'strict']) {
  test(`real runtime: ${mode} does not disable authenticated ownership`, async () => {
    const runtime = await createDvar({ policy: { ...policy, mode, runtime: { onEvaluationError: 'allow' } } });
    const f = fixture(api, { runtime, resolve: () => resource({ tenantId: 'other' }) });
    await expect(f.call()).rejects.toMatchObject({ code: 'ownership.denied' });
    expect(f.state.executions).toBe(0);
  });
}
