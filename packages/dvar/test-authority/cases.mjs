import assert from 'node:assert/strict';
import { CREDENTIAL, NOW, clone, fixture, identity, resource, pause, approvalHash } from './fixtures.mjs';

export function registerAuthorityTests(test, api) {
  const rejects = (promise, code) => assert.rejects(promise, error => {
    assert.equal(error.code, code); return true;
  });
  test('verified identity and owned resources reach the existing protected-tool boundary', async () => {
    const f = fixture(api); assert.deepEqual(await f.call(), { id: 'order-1', ok: true });
    assert.equal(f.state.verifies, 2); assert.equal(f.state.resolves, 2); assert.equal(f.state.protects, 1);
    assert.equal(f.state.executions, 1); assert.deepEqual(f.state.outcomes, [true]);
    const action = f.state.actions[0];
    assert.equal(action.tenant.id, 'tenant-a'); assert.equal(action.principal.id, 'user-a');
    assert.equal(action.principal.claims.dvarAuthority.source, 'session-verifier');
    assert.equal(action.principal.claims.dvarAuthority.agentTrustLevel, 'restricted');
    assert.deepEqual(action.resources[0], { type: 'order', id: 'order-1', ownerId: 'user-a', tenantId: 'tenant-a', version: 'revision-1', operation: 'read' });
    assert.equal(f.state.executionContexts[0].resources[0].version, 'revision-1');
  });
  test('preview is non-executing and does not construct a protected invocation', async () => {
    const f = fixture(api); const result = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    assert.equal(result.decision.effect, 'allow'); assert.equal(f.state.evaluations.length, 1);
    assert.equal(f.state.protects, 0); assert.equal(f.state.executions, 0); assert.equal(f.state.verifies, 1);
    assert(Object.isFrozen(result.action)); assert(Object.isFrozen(result.action.principal));
  });
  test('preview rejects approval grants rather than consuming them', async () => {
    const f = fixture(api);
    await rejects(f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL, approvalGrant: 'secret-grant' }), 'authority.context_invalid');
    assert.equal(f.state.evaluations.length, 0);
  });
  test('preview and execution produce identical semantic approval bindings', async () => {
    const f = fixture(api); const preview = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    await f.call(); assert.equal(approvalHash(preview.action), approvalHash(f.state.actions[0]));
  });
  for (const [label, change] of [
    ['version', { version: 'revision-2' }], ['classification', { classification: 'restricted' }],
    ['owner', { ownerId: 'user-b' }]
  ]) test(`approval hash binds resource ${label}`, async () => {
    let current = resource();
    const f = fixture(api, { definition: { resources: { mode: 'tenant', select: args => [{ type: 'order', id: args.id, operation: 'read' }] } }, resolve: () => clone(current) });
    const first = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    current = resource(change);
    const second = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    assert.notEqual(approvalHash(first.action), approvalHash(second.action));
  });
  for (const [label, change] of [
    ['issuer', { issuer: 'second-trusted-issuer' }], ['agent role', { agent: { ...identity().agent, roles: ['administrator'] } }],
    ['trust', { agent: { ...identity().agent, trustLevel: 'trusted' } }], ['expiry', { expiresAtMs: NOW + 120000 }]
  ]) test(`approval hash binds verified ${label}`, async () => {
    let current = identity();
    const f = fixture(api, { options: { allowedIssuers: ['app-session-service', 'second-trusted-issuer'] }, verify: () => clone(current) });
    const first = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL }); current = identity(change);
    const second = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    assert.notEqual(approvalHash(first.action), approvalHash(second.action));
  });
  test('a fresh lookup timestamp does not invalidate unchanged reviewed resources', async () => {
    const f = fixture(api, { resolve: (_r, _c, s) => resource({ observedAtMs: NOW - 100 + s.resolves }) });
    const first = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL });
    await f.call(); assert.equal(approvalHash(first.action), approvalHash(f.state.actions[0]));
  });
  test('untrusted arguments cannot supply principal, tenant, trust or ownership', async () => {
    const f = fixture(api);
    await f.call({ id: 'order-1', principal: { id: 'root', roles: ['admin'] }, tenantId: 'evil', resources: [{ ownerId: 'root' }], trustLevel: 'trusted' });
    assert.equal(f.state.actions[0].principal.id, 'user-a'); assert.equal(f.state.actions[0].tenant.id, 'tenant-a');
    assert.equal(f.state.actions[0].resources[0].ownerId, 'user-a');
  });
  for (const extra of [{ principal: { id: 'root' } }, { tenant: { id: 'evil' } }, { metadata: { trusted: true } }, { issuer: 'evil' }]) {
    test(`call context rejects a supplied ${Object.keys(extra)[0]}`, async () => {
      const f = fixture(api); await rejects(f.call(undefined, extra), 'authority.context_invalid');
      assert.equal(f.state.verifies, 0); assert.equal(f.state.executions, 0);
    });
  }
  const invalidIdentities = [
    ['null', () => null, 'identity.invalid'], ['missing tenant', () => { const i = identity(); delete i.tenantId; return i; }, 'identity.invalid'],
    ['empty principal', () => identity({ principal: { id: '', type: 'user', roles: [] } }), 'identity.invalid'],
    ['unknown principal type', () => identity({ principal: { ...identity().principal, type: 'root' } }), 'identity.invalid'],
    ['unrecognized trust', () => identity({ agent: { ...identity().agent, trustLevel: 'superuser' } }), 'identity.invalid'],
    ['untrusted issuer', () => identity({ issuer: 'attacker' }), 'identity.issuer_denied'],
    ['wrong audience', () => identity({ audience: 'other-api' }), 'identity.audience_denied'],
    ['wrong environment', () => identity({ environment: 'development' }), 'identity.environment_denied'],
    ['expired', () => identity({ expiresAtMs: NOW }), 'identity.expired'],
    ['future issue', () => identity({ issuedAtMs: NOW + 1 }), 'identity.not_yet_valid'],
    ['future activation', () => identity({ notBeforeMs: NOW + 1 }), 'identity.not_yet_valid'],
    ['stale assertion', () => identity({ issuedAtMs: NOW - 300001 }), 'identity.stale'],
    ['invalid chronology', () => identity({ expiresAtMs: NOW - 2000 }), 'identity.invalid'],
    ['fractional time', () => identity({ issuedAtMs: NOW - .5 }), 'identity.invalid'],
    ['unrecognized extra claim', () => identity({ credential: CREDENTIAL }), 'identity.invalid'],
    ['duplicate roles', () => identity({ principal: { ...identity().principal, roles: ['admin','admin'] } }), 'identity.invalid'],
    ['missing roles', () => identity({ principal: { id: 'user-a', type: 'user' } }), 'identity.invalid'],
    ['overlong id', () => identity({ tenantId: 'x'.repeat(257) }), 'identity.invalid'],
    ['whitespace id', () => identity({ tenantId: ' tenant-a' }), 'identity.invalid'],
    ['missing agent', () => identity({ agent: null }), 'identity.invalid'],
    ['NaN expiry', () => identity({ expiresAtMs: NaN }), 'identity.invalid'],
    ['role list instead of record', () => identity({ principal: [] }), 'identity.invalid']
  ];
  for (const [label, make, code] of invalidIdentities) test(`deny ${label} before Dvar accounting or side effects`, async () => {
    const f = fixture(api, { verify: make }); await rejects(f.call(), code);
    assert.equal(f.state.protects, 0); assert.equal(f.state.executions, 0); assert.equal(f.state.resolves, 0);
  });
  for (const type of ['user', 'service', 'workload', 'agent']) test(`preserve verified ${type} principal`, async () => {
    const f = fixture(api, { verify: () => identity({ principal: { ...identity().principal, type } }) });
    await f.call(); assert.equal(f.state.actions[0].principal.type, type);
  });
  test('deny missing credential without calling the identity provider', async () => {
    const f = fixture(api); await rejects(f.tool({}, {}), 'identity.missing'); assert.equal(f.state.verifies, 0);
  });
  test('deny empty/oversized credential without leaking it', async () => {
    const f = fixture(api); await rejects(f.call(undefined, { credential: '' }), 'identity.missing');
    await rejects(f.call(undefined, { credential: 'x'.repeat(16385) }), 'identity.invalid');
  });
  test('deny revoked/unknown opaque evidence', async () => {
    const f = fixture(api); await rejects(f.call(undefined, { credential: 'unknown-token' }), 'identity.invalid');
    assert.equal(f.state.executions, 0);
  });
  test('authenticate again on every invocation instead of caching an assertion', async () => {
    const f = fixture(api); await f.call(); await f.call(); assert.equal(f.state.verifies, 4);
  });
  for (const [label, options, code] of [
    ['roles', { requiredRoles: ['admin'] }, 'identity.roles_denied'],
    ['trust', { allowedTrustLevels: ['trusted'] }, 'identity.trust_denied']
  ]) test(`enforce required ${label}`, async () => {
    const f = fixture(api, { definition: options }); await rejects(f.call(), code); assert.equal(f.state.executions, 0);
  });
  test('snapshots policy lists and tool metadata at registration', async () => {
    const f = fixture(api, { definition: { requiredRoles: ['admin'] } });
    f.definition.requiredRoles.length = 0; f.options.allowedIssuers.push('attacker'); f.definition.name = 'safe.read';
    await rejects(f.call(), 'identity.roles_denied');
  });
  test('explicit resource-free tool still verifies identity and retains Dvar enforcement', async () => {
    const f = fixture(api, { options: { ownershipProvider: undefined }, definition: { resources: { mode: 'none' } } });
    await f.call(); assert.equal(f.state.resolves, 0); assert.equal(f.state.verifies, 2); assert.equal(f.state.actions[0].resources, undefined);
  });
  const badResources = [
    ['missing record', () => null, 'ownership.denied'], ['other owner', () => resource({ ownerId: 'other' }), 'ownership.denied'],
    ['other tenant', () => resource({ tenantId: 'other' }), 'ownership.denied'], ['wrong id', () => resource({ id: 'order-2' }), 'ownership.denied'],
    ['wrong type', () => resource({ type: 'invoice' }), 'ownership.denied'], ['missing version', () => { const r = resource(); delete r.version; return r; }, 'ownership.invalid'],
    ['expired observation', () => resource({ observedAtMs: NOW - 1, validUntilMs: NOW }), 'ownership.stale'],
    ['future observation', () => resource({ observedAtMs: NOW + 1 }), 'ownership.stale'],
    ['stale observation', () => resource({ observedAtMs: NOW - 5001 }), 'ownership.stale'],
    ['extra attestation field', () => resource({ trusted: true }), 'ownership.invalid'],
    ['invalid validity window', () => resource({ validUntilMs: NOW - 1 }), 'ownership.invalid']
  ];
  for (const [label, resolve, code] of badResources) test(`deny resource ${label}`, async () => {
    const f = fixture(api, { resolve }); await rejects(f.call(), code);
    assert.equal(f.state.protects, 0); assert.equal(f.state.executions, 0);
  });
  test('tenant mode is explicit and does not imply cross-tenant permission', async () => {
    const def = { resources: { mode: 'tenant', select: a => [{ type: 'order', id: a.id, operation: 'read' }] } };
    const sameTenant = fixture(api, { definition: def, resolve: () => resource({ ownerId: 'other' }) });
    await sameTenant.call(); assert.equal(sameTenant.state.executions, 1);
    const wrongTenant = fixture(api, { definition: def, resolve: () => resource({ tenantId: 'other' }) });
    await rejects(wrongTenant.call(), 'ownership.denied');
  });
  const badSelections = [
    ['empty', () => []], ['duplicate', a => [{ type: 'order', id: a.id, operation: 'read' }, { type: 'order', id: a.id, operation: 'write' }]],
    ['too many', () => Array.from({ length: 17 }, (_, i) => ({ type: 'order', id: String(i), operation: 'read' }))],
    ['caller owner', a => [{ type: 'order', id: a.id, operation: 'read', ownerId: 'user-a' }]],
    ['unknown operation', a => [{ type: 'order', id: a.id, operation: 'transfer' }]],
    ['throwing selector', () => { throw Error('sensitive detail'); }], ['async selector', async () => []], ['rejecting async selector', async () => { throw Error('private selector error'); }]
  ];
  for (const [label, select] of badSelections) test(`deny ${label} resource selection`, async () => {
    const f = fixture(api, { definition: { resources: { mode: 'owner', select } } });
    await rejects(f.call(), 'ownership.references_invalid'); assert.equal(f.state.resolves, 0); assert.equal(f.state.executions, 0);
  });
  test('all selected resources must pass before accounting', async () => {
    const f = fixture(api, { definition: { resources: { mode: 'owner', select: () => [
      { type: 'order', id: 'one', operation: 'read' }, { type: 'order', id: 'two', operation: 'write' }] } },
      resolve: ref => resource({ id: ref.id, ownerId: ref.id === 'two' ? 'other' : 'user-a' }) });
    await rejects(f.call(), 'ownership.denied'); assert.equal(f.state.protects, 0);
  });
  test('resource order is canonical and observations are not reused across calls', async () => {
    let order = false;
    const f = fixture(api, { definition: { resources: { mode: 'owner', select: () => {
      order = !order; const refs = ['one','two'].map(id => ({ type: 'order', id, operation: 'read' })); return order ? refs : refs.reverse();
    } } } });
    const p = await f.tool.evaluate({ id: 'order-1' }, { credential: CREDENTIAL }); await f.call();
    assert.equal(approvalHash(p.action), approvalHash(f.state.actions[0])); assert.equal(f.state.resolves, 6);
  });
  for (const [label, verify, resolve, code] of [
    ['identity revoked', (_t, _c, s) => s.verifies > 1 ? null : identity(), undefined, 'identity.invalid'],
    ['identity roles changed', (_t, _c, s) => identity({ principal: { ...identity().principal, roles: s.verifies > 1 ? ['admin'] : ['operator'] } }), undefined, 'identity.changed'],
    ['session changed', (_t, _c, s) => identity({ sessionId: s.verifies > 1 ? 'session-b' : 'session-a' }), undefined, 'identity.changed'],
    ['record revision changed', undefined, (_r, _c, s) => resource({ version: s.resolves > 1 ? 'revision-2' : 'revision-1' }), 'ownership.changed'],
    ['ownership revoked', undefined, (_r, _c, s) => resource({ ownerId: s.resolves > 1 ? 'other' : 'user-a' }), 'ownership.denied'],
    ['resource deleted', undefined, (_r, _c, s) => s.resolves > 1 ? null : resource(), 'ownership.denied']
  ]) test(`recheck stops ${label} after policy/approval delay`, async () => {
    const f = fixture(api, { verify, resolve }); await rejects(f.call(), code);
    assert.equal(f.state.protects, 1); assert.equal(f.state.executions, 0); assert.equal(f.state.verifies, 2);
  });
  test('expiry during an approval wait stops dispatch without a second policy reservation', async () => {
    const f = fixture(api, { beforeDispatch: s => { s.time = NOW + 60000; } });
    await rejects(f.call(), 'identity.expired'); assert.equal(f.state.protects, 1); assert.equal(f.state.executions, 0);
  });
  test('expiry while the final resource check runs also stops dispatch', async () => {
    const f = fixture(api, { resolve: (_r, _c, s) => {
      if (s.resolves > 1) s.time = NOW + 60000;
      return resource({ observedAtMs: s.time, validUntilMs: s.time + 5000 });
    } });
    await rejects(f.call(), 'identity.expired'); assert.equal(f.state.executions, 0);
  });
  for (const effect of ['deny','require_approval']) test(`Dvar ${effect} never enters the executor`, async () => {
    const f = fixture(api, { effect }); await rejects(f.call(), effect);
    assert.equal(f.state.executions, 0); assert.equal(f.state.verifies, 1); assert.equal(f.state.resolves, 1);
  });
  test('original Dvar rejection is preserved', async () => {
    const original = new Error('policy error'); const f = fixture(api, { policyError: original });
    await assert.rejects(f.call(), e => e === original); assert.equal(f.state.executions, 0);
  });
  test('original tool failure is preserved and downstream output processing is retained', async () => {
    const original = new Error('executor error'); const f = fixture(api, { execute: () => { throw original; } });
    await assert.rejects(f.call(), e => e === original); assert.deepEqual(f.state.outcomes, [false]);
    const g = fixture(api, { afterOutput: () => ({ safe: true }) }); assert.deepEqual(await g.call(), { safe: true });
  });
  test('approval grant reaches Dvar but not the executor or authority events', async () => {
    const f = fixture(api); await f.call(undefined, { approvalGrant: 'private-grant' });
    assert.equal(f.state.contexts[0].approvalGrant, 'private-grant');
    assert(!JSON.stringify(f.state.executionContexts).includes('private-grant')); assert(!JSON.stringify(f.state.events).includes('private-grant'));
    assert(!JSON.stringify(f.state.actions).includes(CREDENTIAL)); assert(!JSON.stringify(f.state.executionContexts).includes(CREDENTIAL));
  });
  test('snapshots arguments before awaiting identity and freezes executor inputs', async () => {
    let unblock; const wait = new Promise(r => { unblock = r; });
    const f = fixture(api, { verify: async () => { await wait; return identity(); }, execute: (args, ctx) => {
      assert(Object.isFrozen(args)); assert(Object.isFrozen(ctx.identity)); assert(Object.isFrozen(ctx.resources[0]));
      assert.throws(() => { args.id = 'order-3'; }, TypeError); return args.id;
    } });
    const args = { id: 'order-1' }; const result = f.call(args); args.id = 'order-2'; unblock();
    assert.equal(await result, 'order-1'); assert.equal(f.state.actions[0].arguments.id, 'order-1');
  });
  const hostileArgs = [
    ['undefined', () => undefined], ['function', () => (() => 1)], ['date', () => new Date()],
    ['bigint', () => 1n], ['NaN', () => ({ value: NaN })], ['sparse array', () => new Array(2)],
    ['symbol', () => ({ [Symbol('x')]: 'hidden' })], ['circular', () => { const x = {}; x.self = x; return x; }],
    ['deep nesting', () => { let x = {}; for (let i = 0; i < 34; i++) x = { x }; return x; }],
    ['oversized input', () => ({ large: 'x'.repeat(65537) })], ['prototype key', () => JSON.parse('{"__proto__":{"admin":true}}')],
    ['huge node set', () => Array.from({ length: 4097 }, () => null)]
  ];
  for (const [label, make] of hostileArgs) test(`reject ${label} without authorizing`, async () => {
    const f = fixture(api); await rejects(f.tool(make(), { credential: CREDENTIAL }), 'authority.arguments_invalid');
    assert.equal(f.state.protects, 0); assert.equal(f.state.verifies, 0);
  });
  test('argument getters and toJSON are never invoked', async () => {
    let calls = 0; const x = {}; Object.defineProperty(x, 'id', { enumerable: true, get() { calls++; return 'order-1'; } });
    const f = fixture(api); await rejects(f.call(x), 'authority.arguments_invalid');
    await rejects(f.call({ toJSON() { calls++; return {}; } }), 'authority.arguments_invalid'); assert.equal(calls, 0);
  });
  test('argument and call-context proxy errors are sanitized', async () => {
    const f = fixture(api);
    const value = new Proxy({}, { ownKeys() { throw Error(CREDENTIAL); } });
    await rejects(f.call(value), 'authority.arguments_invalid');
    await rejects(f.tool({}, value), 'authority.context_invalid');
  });
  test('identity provider getters do not execute and cannot supply claims', async () => {
    let calls = 0; const value = identity(); Object.defineProperty(value, 'principal', { enumerable: true, get() { calls++; return identity().principal; } });
    const f = fixture(api, { verify: () => value }); await rejects(f.call(), 'identity.invalid'); assert.equal(calls, 0);
  });
  for (const provider of ['verify','resolve']) test(`${provider} failure is privacy-safe`, async () => {
    const f = fixture(api, { [provider]: () => { throw Error(`${CREDENTIAL} private-resource private-url`); } });
    await assert.rejects(f.call(), error => {
      assert.equal(error.code, 'authority.provider_unavailable'); assert.equal(error.cause, undefined);
      assert(!String(error).includes(CREDENTIAL)); return true;
    });
    await pause(0); assert(!JSON.stringify(f.state.events).includes(CREDENTIAL)); assert(!JSON.stringify(f.state.events).includes('user-a'));
  });
  test('abort before authentication makes zero provider calls', async () => {
    const f = fixture(api); const controller = new AbortController(); controller.abort('private reason');
    await rejects(f.call(undefined, { signal: controller.signal }), 'authority.aborted'); assert.equal(f.state.verifies, 0);
  });
  test('abort a pending provider and ignore its late result', async () => {
    const controller = new AbortController(); let release; let received;
    const f = fixture(api, { verify: (_token, { signal }) => { received = signal; return new Promise(r => { release = r; }); } });
    const pending = f.call(undefined, { signal: controller.signal }); await pause(0); controller.abort('private reason');
    await rejects(pending, 'authority.aborted'); assert(received.aborted); release(identity()); await pause(0);
    assert.equal(f.state.executions, 0); assert.equal(f.boundary.diagnostics().pendingChecks, 0);
  });
  test('timeout retains capacity until an ignoring provider actually settles', async () => {
    let release; let received;
    const f = fixture(api, { options: { providerTimeoutMs: 10, maxPendingChecks: 1 },
      verify: (_t, { signal }) => { received = signal; return new Promise(r => { release = r; }); } });
    await rejects(f.call(), 'authority.timeout'); assert(received.aborted); assert.equal(f.boundary.diagnostics().pendingChecks, 1);
    await rejects(f.call(), 'authority.capacity'); assert.equal(f.state.verifies, 1);
    release(identity()); await pause(0); assert.equal(f.boundary.diagnostics().pendingChecks, 0); assert.equal(f.state.executions, 0);
  });
  test('timeout followed by late provider rejection is handled', async () => {
    let reject; const f = fixture(api, { options: { providerTimeoutMs: 5 }, verify: () => new Promise((_r, j) => { reject = j; }) });
    await rejects(f.call(), 'authority.timeout'); reject(Error('late private provider error')); await pause(0);
    assert.equal(f.boundary.diagnostics().pendingChecks, 0);
  });
  test('phase deadline bounds many individually responsive resource lookups', async () => {
    const f = fixture(api, { options: { providerTimeoutMs: 100, phaseTimeoutMs: 20 },
      definition: { resources: { mode: 'owner', select: () => ['a','b','c'].map(id => ({ type: 'order', id, operation: 'read' })) } },
      resolve: async ref => { await pause(12); return resource({ id: ref.id }); } });
    await rejects(f.call(), 'authority.timeout'); assert.equal(f.state.executions, 0); await pause(20);
  });
  test('clock rollback denies instead of extending authority', async () => {
    const f = fixture(api); await f.call(); f.state.time = NOW - 1;
    await rejects(f.call(), 'authority.clock_invalid'); assert.equal(f.state.executions, 1);
  });
  test('invalid or throwing clocks fail closed', async () => {
    for (const clock of [() => NaN, () => { throw Error('private'); }]) {
      const f = fixture(api, { options: { clock } }); await rejects(f.call(), 'authority.clock_invalid');
    }
  });
  test('concurrent tenants never share verified identity or execution state', async () => {
    const f = fixture(api, {
      definition: { resources: { mode: 'none' } },
      verify: async credential => { await pause(0); return identity({ principal: { id: credential, type: 'user', roles: [] }, tenantId: `tenant-${credential}` }); },
      execute: (args, context) => ({ requested: args.id, actual: context.identity.principal.id, tenant: context.identity.tenantId })
    });
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => f.tool({ id: `user-${i}` }, { credential: `user-${i}` })));
    for (let i = 0; i < results.length; i++) assert.deepEqual(results[i], { requested: `user-${i}`, actual: `user-${i}`, tenant: `tenant-user-${i}` });
    assert.equal(f.state.executions, 100); assert.equal(f.boundary.diagnostics().pendingChecks, 0);
  });
  test('non-settling event sink is bounded and cannot delay tool execution', async () => {
    let release; const wait = new Promise(r => { release = r; });
    const f = fixture(api, { definition: { resources: { mode: 'none' } }, options: { eventSink: () => wait } });
    for (let i = 0; i < 20; i++) await f.call();
    assert.equal(f.state.executions, 20); assert.equal(f.boundary.diagnostics().pendingEvents, 16);
    assert(f.boundary.diagnostics().droppedEvents > 0); release(); await pause(0); assert.equal(f.boundary.diagnostics().pendingEvents, 0);
  });
  test('throwing observer is isolated from authority and result', async () => {
    const f = fixture(api, { options: { eventSink: () => { throw Error('observer failed'); } } });
    await f.call(); await pause(0); assert.equal(f.state.executions, 1); assert(f.boundary.diagnostics().droppedEvents > 0);
  });
  test('single invocation remains single even if a faulty runtime repeats its executor', async () => {
    const f = fixture(api, { runtime: { protectTool: definition => async (args, context) => {
      const first = await definition.execute(args, context);
      await rejects(definition.execute(args, context), 'authority.execution_replayed'); return first;
    } } });
    await f.call(); assert.equal(f.state.executions, 1);
  });
  for (const [field, value] of [
    ['audience', ''], ['environment', ''], ['allowedIssuers', []], ['allowedIssuers', ['a','a']],
    ['maxPendingChecks', 0], ['providerTimeoutMs', Infinity], ['phaseTimeoutMs', -1],
    ['maxArgumentBytes', 10], ['maxIdentityAgeMs', 0], ['maxOwnershipAgeMs', 0], ['clock', 'clock']
  ]) test(`reject invalid configuration ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(() => fixture(api, { options: { [field]: value } }), { code: 'authority.configuration_invalid' });
  });
  for (const [label, definition] of [
    ['missing resource policy', { resources: undefined }], ['unknown resource mode', { resources: { mode: 'allow' } }],
    ['none with selector', { resources: { mode: 'none', select: () => [] } }], ['missing selector', { resources: { mode: 'owner' } }],
    ['empty trust policy', { allowedTrustLevels: [] }], ['unknown trust policy', { allowedTrustLevels: ['admin'] }],
    ['duplicate required roles', { requiredRoles: ['a','a'] }], ['empty name', { name: '' }]
  ]) test(`reject ${label} at tool registration`, () => {
    assert.throws(() => fixture(api, { definition }), { code: 'authority.configuration_invalid' });
  });
  test('resource enforcement cannot be selected without a provider', () => {
    assert.throws(() => fixture(api, { options: { ownershipProvider: undefined } }), { code: 'authority.configuration_invalid' });
  });
  test('private source aliases with URLs are refused', () => {
    assert.throws(() => fixture(api, { options: { identityVerifier: { id: 'https://secret.example/key', verify: async () => identity() } } }), { code: 'authority.configuration_invalid' });
  });
  test('public authority errors cannot introduce a private arbitrary reason code', () => {
    const error = new api.DvarAuthorityError(CREDENTIAL);
    assert.equal(error.code, 'authority.provider_unavailable');
    assert(!String(error).includes(CREDENTIAL));
    assert.throws(() => { error.code = CREDENTIAL; }, TypeError);
  });
  test('authority errors use the public error type and finite codes', async () => {
    const f = fixture(api); await assert.rejects(f.call(undefined, { credential: 'revoked' }), error => error instanceof api.DvarAuthorityError);
  });
}
