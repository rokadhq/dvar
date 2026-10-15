import { createHash, randomUUID } from 'node:crypto';
export const NOW = 1_700_000_000_000;
export const CREDENTIAL = 'opaque-session-evidence-NOT-model-data';
export const clone = value => JSON.parse(JSON.stringify(value));
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function identity(overrides = {}) {
  return {
    issuer: 'app-session-service', audience: 'orders-api',
    principal: { id: 'user-a', type: 'user', roles: ['operator'] },
    agent: { id: 'agent-a', roles: ['reader'], trustLevel: 'restricted', framework: 'mayura' },
    tenantId: 'tenant-a', environment: 'production', sessionId: 'session-a', taskId: 'task-a',
    issuedAtMs: NOW - 1000, expiresAtMs: NOW + 60_000, ...overrides
  };
}
export function resource(overrides = {}) {
  return { type: 'order', id: 'order-1', ownerId: 'user-a', tenantId: 'tenant-a', version: 'revision-1',
    observedAtMs: NOW, validUntilMs: NOW + 5000, ...overrides };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([,v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function actionFrom(definition, args, context) {
  const { approvalGrant: _grant, ...projection } = context;
  return { id: randomUUID(), ...projection, server: definition.server ?? { id: 'local', transport: 'function' },
    tool: { name: definition.name, capabilities: definition.capabilities ?? [],
      ...(definition.namespace === undefined ? {} : { namespace: definition.namespace }),
      ...(definition.inputSchema === undefined ? {} : { schemaHash: hash(definition.inputSchema) }) }, arguments: args };
}
// Same semantic inputs as Dvar's approvalActionHash. This fixture is not an approval signer.
export function approvalHash(action) {
  return hash({ principal: action.principal, agent: action.agent, tenant: action.tenant ?? null,
    session: action.session ?? null, task: action.task ?? null, environment: action.environment,
    server: action.server, tool: action.tool, arguments: action.arguments,
    resources: action.resources ?? null, destination: action.destination ?? null, usage: action.usage ?? null });
}
export function decision(action, effect = 'allow') {
  return { id: randomUUID(), effect, mode: 'enforce', ruleId: 'fixture', reasonCode: 'policy.fixture',
    message: 'Fixture decision', risk: { level: 'low', score: 0, signals: [] }, obligations: [],
    policyVersion: '1', policyHash: 'a'.repeat(64), actionHash: hash(action),
    evaluatedAt: new Date(NOW).toISOString(), durationMs: 0 };
}
/** Explicit contract harness: real Dvar policy/approval/quota/output integration has a separate suite. */
export function fixture(api, config = {}) {
  const state = { verifies: 0, resolves: 0, executions: 0, protects: 0, evaluations: [], actions: [],
    contexts: [], executionContexts: [], args: [], outcomes: [], events: [], time: NOW };
  const runtime = {
    evaluate: async action => { state.evaluations.push(action); return decision(action, config.effect); },
    protectTool: definition => {
      state.protects += 1;
      state.definition = definition;
      return async (args, context) => {
        state.contexts.push(context);
        const action = actionFrom(definition, args, context); state.actions.push(action);
        if (config.policyError) throw config.policyError;
        if (config.effect && config.effect !== 'allow') throw Object.assign(new Error('Fixture policy blocked'), { code: config.effect });
        await config.beforeDispatch?.(state);
        try {
          const result = await definition.execute(args, context);
          state.outcomes.push(true);
          return config.afterOutput ? config.afterOutput(result) : result;
        } catch (error) { state.outcomes.push(false); throw error; }
      };
    }, ...config.runtime
  };
  const options = {
    runtime, audience: 'orders-api', environment: 'production', allowedIssuers: ['app-session-service'],
    clock: () => state.time,
    identityVerifier: { id: 'session-verifier', async verify(credential, ctx) {
      state.verifies += 1;
      return config.verify ? config.verify(credential, ctx, state) : credential === CREDENTIAL ? identity() : null;
    } },
    ownershipProvider: { id: 'orders-db', async resolve(ref, ctx) {
      state.resolves += 1;
      return config.resolve ? config.resolve(ref, ctx, state) : resource({ type: ref.type, id: ref.id });
    } },
    eventSink: event => { state.events.push(event); },
    ...config.options
  };
  const boundary = api.createAuthorityBoundary(options);
  const definition = {
    name: 'orders.read', capabilities: ['data.read'],
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    resources: { mode: 'owner', select: args => [{ type: 'order', id: args.id, operation: 'read' }] },
    execute: async (args, context) => {
      state.executions += 1; state.args.push(args); state.executionContexts.push(context);
      return config.execute ? config.execute(args, context, state) : { id: args.id, ok: true };
    }, ...config.definition
  };
  const tool = boundary.protectTool(definition);
  return { state, runtime, options, definition, boundary, tool,
    call: (args = { id: 'order-1' }, extra = {}) => tool(args, { credential: CREDENTIAL, ...extra }) };
}
